/*!
 * Copyright (c) 2022-2023 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import * as database from '@bedrock/mongodb';
import {
  AsymmetricKey, CapabilityAgent, Hmac, KeystoreAgent, KmsClient
} from '@digitalbazaar/webkms-client';
import {createCapabilityAgent, delegate} from './helpers.js';
import assert from 'assert-plus';
import {getAppIdentity} from '@bedrock/app-identity';
import {httpsAgent} from '@bedrock/https-agent';
import {LruCache} from '@digitalbazaar/lru-memoize';
import {logger} from './logger.js';


const {util: {BedrockError}} = bedrock;

const COLLECTION_NAME = 'service-agent-serviceAgent';
const ONE_MINUTE = 1000 * 60;
const FIVE_MINUTES = ONE_MINUTE * 5;
const TEN_MINUTES = FIVE_MINUTES * 2;

let EPHEMERAL_AGENT_CACHE_TTL = FIVE_MINUTES;
let EPHEMERAL_AGENT_CACHE;
let SERVICE_AGENT_CACHE;

bedrock.events.on('bedrock.init', async () => {
  const cfg = bedrock.config['service-agent'];

  SERVICE_AGENT_CACHE = new LruCache(cfg.caches.serviceAgent);
  _createEphemeralAgentCache();
});

bedrock.events.on('bedrock-mongodb.ready', async () => {
  await database.openCollections([COLLECTION_NAME]);

  await database.createIndexes([{
    // cover queries by service agent ID
    collection: COLLECTION_NAME,
    fields: {'serviceAgent.id': 1},
    options: {unique: true, background: false}
  }, {
    // cover queries by service type
    collection: COLLECTION_NAME,
    fields: {'serviceAgent.serviceType': 1},
    options: {unique: true, background: false}
  }]);
});

/**
 * Generates a new service agent.
 *
 * @param {object} options - The options to use.
 * @param {object} options.serviceType - The service type to generate the
 *   service agent for.
 *
 * @returns {Promise<object>} Resolves to the service agent information.
 */
export async function generate({serviceType} = {}) {
  // app identity is the controller of the service agent
  const {id, keys: {capabilityInvocationKey}} = getAppIdentity();
  const appIdentitySigner = capabilityInvocationKey.signer();
  logger.info('======DEBUG', {id, capabilityInvocationKey});
  // create IP-restricted keystore; only the local application will be able
  // to access keys in this keystore
  const {kms: kmsCfg} = bedrock.config['service-agent'];
  logger.info('======DEBUG', {kmsCfg});
  const config = {
    controller: id,
    ipAllowList: kmsCfg.ipAllowList,
    kmsModule: kmsCfg.kmsModule,
    meterId: kmsCfg.meterId,
    sequence: 0
  };
  logger.info('======DEBUG', {config});
  const keystore = await KmsClient.createKeystore({
    url: `${kmsCfg.baseUrl}/keystores`,
    config,
    invocationSigner: appIdentitySigner,
    httpsAgent
  });
  logger.info('======DEBUG', {keystore});

  // create keystore agent for the service agent
  const {id: keystoreId} = keystore;
  const kmsClient = new KmsClient({keystoreId, httpsAgent});
  const capabilityAgent = new CapabilityAgent({signer: appIdentitySigner});
  const keystoreAgent = new KeystoreAgent(
    {keystoreId, capabilityAgent, kmsClient});

  // create a zcap invocation key and an hmac key for the service agent to
  // enable the agent to invoke zcaps, symmetrically sign service-related data,
  // and receive encrypted messages

  // note: consider supporting other did methods (e.g., did:v1) in the future
  const publicAliasTemplate = _getPublicAliasTemplate({didMethod: 'key'});
  const [zcapKey, hmac] = await Promise.all([
    keystoreAgent.generateKey({
      type: 'asymmetric',
      publicAliasTemplate
    }),
    keystoreAgent.generateKey({type: 'hmac'})
  ]);

  // get service agent ID from zcap key
  const serviceAgentId = zcapKey.id.slice(0, zcapKey.id.indexOf('#'));

  // build service agent info
  return {
    id: serviceAgentId,
    keystore: keystoreId,
    serviceType,
    sequence: 0,
    zcapInvocationKey: {
      id: zcapKey.id,
      kmsId: zcapKey.kmsId,
      type: zcapKey.type
    },
    hmac: {
      id: hmac.id,
      type: hmac.type
    }
  };
}

/**
 * Gets an ephemeral agent that has been delegated all of the zcaps in
 * the given config. This agent can more efficiently sign capability
 * invocations but only lives for a limited period of time.
 *
 * Whenever this function is called, the returned ephemeral agent will include
 * an `expires` date indicating how long it can last. Note that it will need
 * to be used prior to expiration or else any calls that invoke its zcaps will
 * fail. In a properly operation application, care should be taken to ensure
 * that a service agent's zcaps will always last longer than the maximum TTL
 * for an ephemeral agent.
 *
 * @param {object} options - The options to use.
 * @param {object} options.config - The service object config.
 * @param {object} options.serviceAgent - The service agent.
 *
 * @returns {Promise<{object}>} Resolves to an ephemeral agent and the zcaps
 *   delegated to it from service agent.
 */
export async function getEphemeralAgent({config, serviceAgent} = {}) {
  const key = JSON.stringify([
    config.id, config.sequence, serviceAgent.id, serviceAgent.sequence
  ]);
  const fn = () => _getUncachedEphemeralAgent({config, serviceAgent, key});
  // memoize but fetch promise directly to compare below whilst avoiding race
  // condition where the cache could be updated during `await`
  await EPHEMERAL_AGENT_CACHE.memoize({key, fn});
  const promise = EPHEMERAL_AGENT_CACHE.cache.get(key);
  const record = await promise;

  // clear expired record from cache (if it hasn't already changed) and retry
  const now = new Date();
  if(record.expires < now) {
    const current = EPHEMERAL_AGENT_CACHE.cache.get(key);
    if(current === promise) {
      EPHEMERAL_AGENT_CACHE.delete(key);
    }
    return getEphemeralAgent({config, serviceAgent});
  }

  // return `_next` for testing purposes only
  const {capabilityAgent, expires, zcaps, next: _next} = record;
  return {capabilityAgent, expires, zcaps, _next};
}

/**
 * Gets the zcap invocation signer for the given `serviceAgent`.
 *
 * @param {object} options - The options to use.
 * @param {object} options.serviceAgent - The service agent.
 *
 * @returns {Promise<object>} Resolves to the service agent's zcap invocation
 *   signer.
 */
export async function getInvocationSigner({serviceAgent} = {}) {
  // get invocation signer for using the service agent's zcap key
  // note: this is NOT the invocation signer to be returned, it will be used
  // to invoke a zcap invocation key -- which is the signer that is returned
  const {keys: {capabilityInvocationKey}} = getAppIdentity();
  const zcapKeyInvocationSigner = capabilityInvocationKey.signer();

  // get the zcap invocation key for the service agent
  const {keystore: keystoreId} = serviceAgent;
  const kmsClient = new KmsClient({keystoreId, httpsAgent});
  const key = new AsymmetricKey({
    ...serviceAgent.zcapInvocationKey,
    invocationSigner: zcapKeyInvocationSigner,
    kmsClient
  });
  return key;
}

/**
 * Gets the HMAC key for the given `serviceAgent`.
 *
 * @param {object} options - The options to use.
 * @param {object} options.serviceAgent - The service agent.
 *
 * @returns {Promise<object>} Resolves to the service agent's HMAC key.
 */
export async function getHmac({serviceAgent} = {}) {
  // get invocation signer for using the service agent's hmac key
  const {keys: {capabilityInvocationKey}} = getAppIdentity();
  const hmacKeyInvocationSigner = capabilityInvocationKey.signer();

  // get the hmac key for the service agent
  const {keystore: keystoreId} = serviceAgent;
  const kmsClient = new KmsClient({keystoreId, httpsAgent});
  const key = new Hmac({
    ...serviceAgent.hmac,
    invocationSigner: hmacKeyInvocationSigner,
    kmsClient
  });
  return key;
}

/**
 * Inserts a new service agent record into storage.
 *
 * @param {object} options - The options to use.
 * @param {object} options.serviceAgent - The service agent information.
 *
 * @returns {Promise<object>} Resolves to the database record.
 */
export async function insert({serviceAgent} = {}) {
  _assertServiceAgent({serviceAgent});

  // require starting sequence to be 0
  if(serviceAgent.sequence !== 0) {
    throw new BedrockError(
      'Service agent record sequence must be "0".',
      'ConstraintError', {
        public: true,
        httpStatusCode: 400
      });
  }

  // insert and get updated record
  const now = Date.now();
  const meta = {created: now, updated: now};
  const record = {
    meta,
    serviceAgent
  };
  try {
    const collection = database.collections[COLLECTION_NAME];
    const result = await collection.insertOne(record);
    return result.ops[0];
  } catch(e) {
    if(!database.isDuplicateError(e)) {
      throw e;
    }
    throw new BedrockError(
      'Duplicate service agent record.',
      'DuplicateError', {
        public: true,
        httpStatusCode: 409
      }, e);
  }
}

/**
 * Retrieves all service agent records matching the given query.
 *
 * @param {object} options - The options to use.
 * @param {object} [options.query={}] - The optional query to use.
 * @param {object} [options.options={}] - The options (eg: 'sort', 'limit').
 * @param {boolean} [options.explain=false] - An optional explain
 *   boolean.
 *
 * @returns {Promise<Array | ExplainObject>} Resolves with the records that
 *   matched the query or an ExplainObject if `explain=true`.
 */
export async function find({query = {}, options = {}, explain = false} = {}) {
  const collection = database.collections[COLLECTION_NAME];
  const cursor = await collection.find(query, options);

  if(explain) {
    return cursor.explain('executionStats');
  }

  return cursor.toArray();
}

/**
 * Updates a service agent record if its sequence number is next.
 *
 * @param {object} options - The options to use.
 * @param {object} options.serviceAgent - The service agent.
 * @param {boolean} [options.explain=false] - An optional explain boolean.
 *
 * @returns {Promise<boolean | ExplainObject>} Resolves with `true` on update
 *   success or an ExplainObject if `explain=true`.
 */
export async function update({serviceAgent, explain = false} = {}) {
  _assertServiceAgent({serviceAgent});

  const now = Date.now();
  const collection = database.collections[COLLECTION_NAME];
  const query = {
    'serviceAgent.id': serviceAgent.id,
    'serviceAgent.sequence': serviceAgent.sequence - 1
  };

  if(explain) {
    // 'find().limit(1)' is used here because 'updateOne()' doesn't return a
    // cursor which allows the use of the explain function
    const cursor = await collection.find(query).limit(1);
    return cursor.explain('executionStats');
  }

  const result = await collection.updateOne(
    query, {$set: {serviceAgent, 'meta.updated': now}});

  if(result.result.n === 0) {
    // no records changed...
    throw new BedrockError(
      'Could not update service agent record. ' +
      'Record sequence does not match or record does not exist.',
      'InvalidStateError', {httpStatusCode: 409, public: true});
  }

  // delete record from cache
  SERVICE_AGENT_CACHE.delete(serviceAgent.id);
  SERVICE_AGENT_CACHE.delete(serviceAgent.serviceType);

  return true;
}

/**
 * Gets a service agent record.
 *
 * @param {object} options - The options to use.
 * @param {string} [options.id] - The ID of the service agent.
 * @param {string} [options.serviceType] - The service type the agent is for.
 * @param {boolean} [options.explain=false] - An optional explain boolean.
 *
 * @returns {Promise<object | ExplainObject>} Resolves with the record that
 *   matches the query or an ExplainObject if `explain=true`.
 */
export async function get({id, serviceType, explain = false} = {}) {
  assert.optionalString(id, 'id');
  assert.optionalString(serviceType, 'serviceType');
  if(!(id || serviceType)) {
    throw new Error('At least one of "id" or "serviceType" must be given.');
  }

  if(explain) {
    return _getUncachedRecord({id, serviceType, explain});
  }

  // use cache
  const fn = () => _getUncachedRecord({id, serviceType});
  // note: `serviceType` and `id` do not share any common values so they
  // can share the same key; though it can result in duplicates in the cache;
  // this is not deemed a concern
  return SERVICE_AGENT_CACHE.memoize({key: id || serviceType, fn});
}

// exposed for testing purposes only
export function _resetEphemeralAgentCache({
  ttl = EPHEMERAL_AGENT_CACHE_TTL
} = {}) {
  // set new TTL and reset cache
  EPHEMERAL_AGENT_CACHE_TTL = ttl;
  _createEphemeralAgentCache();
}

function _createEphemeralAgentCache() {
  // this cache is intentionally not configurable at this time; allowing a
  // max age to be configured on it would disturb the implementation
  EPHEMERAL_AGENT_CACHE = new LruCache({
    // ephemeral agents include delegated zcaps and ephemeral keys; a cache
    // size of X means ~X different popular configurations will have increased
    // efficiency
    maxSize: 1000,
    // TTL for ephemeral agents *in the cache*; this is expected to be less
    // than the max TTL for ephemeral agents themselves so that if they are
    // retrieved from the cache they are still useful for a short period
    maxAge: EPHEMERAL_AGENT_CACHE_TTL,
    // every time an ephemeral agent is retrieved, its lifetime is extended
    // to `maxAge` (this does not impact its `expires` tracking, once expired
    // it will always be removed from the cache)
    updateAgeOnGet: true
  });
}

async function _getUncachedEphemeralAgent({config, serviceAgent, key} = {}) {
  /* Note: The following expiration and rotation approach presumes that this
  code will be run on a server that will not be made idle in a way that
  prevents rotation. Rotation involves making network requests to sign
  delegated zcaps, so the service must be able to receive responses before
  going idle for rotation to work properly.

  Ephemeral agents should be short-lived to increase the security posture, but
  not so short-lived that there is no advantage to using them. An attempt is
  made to make ephemeral agents last up to 10 minutes, but they cannot last
  longer than the expiration date on the zcaps they use.

  A timer will be set to run a rotation operation after half of that time has
  passed (which is the max TTL *in the cache*), provided that the agent will
  not expire by then.

  The rotation operation will only rotate the agent (creating a new one, with
  newly delegated zcaps) if the agent is still in the cache when the rotation
  operation executes. To prevent agents from being rotated indefinitely when
  they are not used, the cache will use a TTL that is half of the maximum TTL,
  but whenever an agent is accessed, its cache TTL will be refreshed. It will
  still be removed from the cache if it becomes older than its expiration date.

  If the rotation executes, then the new agent will become active once it
  completes and another possible rotation will be scheduled. */

  // max expiration date for any delegated zcap
  const maxExpires = new Date(Date.now() + TEN_MINUTES);

  // get zcap delegation signer and create new ephemeral capability agent
  const [delegationSigner, {capabilityAgent}] = await Promise.all([
    getInvocationSigner({serviceAgent}),
    createCapabilityAgent()
  ]);

  // delegate all zcaps in `config` to capability agent in parallel and
  // calculate the earliest expiration date for any of the zcaps (some zcaps
  // may already be expiring sooner than the max agent expiration)
  let earliestExpires = maxExpires;
  const zcapEntries = [...Object.entries(config.zcaps)];
  const zcaps = {};
  await Promise.all(zcapEntries.map(async ([name, capability]) => {
    const zcap = await delegate({
      capability, controller: capabilityAgent.id, delegationSigner, maxExpires
    });
    const expires = new Date(zcap.expires);
    if(expires < earliestExpires) {
      earliestExpires = expires;
    }
    zcaps[name] = zcap;
  }));

  // ensure agent will be usable
  const now = new Date();
  if(earliestExpires < now) {
    throw new BedrockError(
      'Service agent zcaps have expired.',
      'InvalidStateError', {httpStatusCode: 500, public: true});
  }
  const record = {capabilityAgent, zcaps, next: null, expires: earliestExpires};

  // compute rotation time; if agent will expire prior to then, do not schedule
  // a rotation as the zcaps will not last
  const rotationTime = Date.now() + EPHEMERAL_AGENT_CACHE_TTL;
  if(earliestExpires.getTime() < rotationTime) {
    return record;
  }

  // schedule potential cache record rotation
  record.next = new Promise(resolve => setTimeout(() => {
    // only continue if key is still in cache
    const current = EPHEMERAL_AGENT_CACHE.cache.get(key);
    if(!current) {
      return resolve(null);
    }
    current.then(currentRecord => {
      // only start rotation if same record is still present in the cache
      if(!(currentRecord === record &&
        current === EPHEMERAL_AGENT_CACHE.cache.get(key))) {
        return resolve(null);
      }

      // start rotation process
      const promise = _getUncachedEphemeralAgent({config, serviceAgent, key});
      promise.then(() => {
        if(current === EPHEMERAL_AGENT_CACHE.cache.get(key)) {
          EPHEMERAL_AGENT_CACHE.cache.set(key, promise);
        }
      }).catch(() => {});

      // `next` always stores `null` or a promise that resolves
      // to a record or error, but does not reject
      resolve(promise.catch(e => e));
    }).catch(() => resolve(null));
  }, EPHEMERAL_AGENT_CACHE_TTL));

  return record;
}

async function _getUncachedRecord({id, serviceType, explain}) {
  const collection = database.collections[COLLECTION_NAME];
  const query = {};
  if(id) {
    query['serviceAgent.id'] = id;
  }
  if(serviceType) {
    query['serviceAgent.serviceType'] = serviceType;
  }
  const projection = {_id: 0, serviceAgent: 1, meta: 1};

  if(explain) {
    // 'find().limit(1)' is used here because 'updateOne()' doesn't return a
    // cursor which allows the use of the explain function
    const cursor = await collection.find(query, {projection}).limit(1);
    return cursor.explain('executionStats');
  }

  const record = await collection.findOne(query, {projection});
  if(!record) {
    throw new BedrockError(
      'Service agent record not found.',
      'NotFoundError',
      {edv: id, httpStatusCode: 404, public: true});
  }

  return record;
}

function _getPublicAliasTemplate({didMethod = 'key', didOptions = {}}) {
  if(didMethod === 'key') {
    return 'did:key:{publicKeyMultibase}#{publicKeyMultibase}';
  }
  if(didMethod === 'v1') {
    const prefix = (didOptions.mode === 'test') ? 'did:v1:test:' : 'did:v1:';
    return prefix + 'nym:{publicKeyMultibase}#{publicKeyMultibase}';
  }

  throw new Error(`DID Method not supported: "${didMethod}".`);
}

// does not assert `sequence` as it is not required
function _assertServiceAgent({serviceAgent}) {
  assert.object(serviceAgent, 'serviceAgent');
  assert.string(serviceAgent.id, 'serviceAgent.id');
  assert.string(serviceAgent.keystore, 'serviceAgent.keystore');
  assert.number(serviceAgent.sequence, 'serviceAgent.sequence');
  assert.object(
    serviceAgent.zcapInvocationKey,
    'serviceAgent.zcapInvocationKey');
  assert.string(
    serviceAgent.zcapInvocationKey.id,
    'serviceAgent.zcapInvocationKey.id');
  assert.string(
    serviceAgent.zcapInvocationKey.kmsId,
    'serviceAgent.zcapInvocationKey.kmsId');
  assert.string(
    serviceAgent.zcapInvocationKey.type,
    'serviceAgent.zcapInvocationKey.type');
  assert.string(serviceAgent.serviceType, 'serviceAgent.serviceType');
}

/**
 * An object containing information on the query plan.
 *
 * @typedef {object} ExplainObject
 */
