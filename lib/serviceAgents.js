/*!
 * Copyright (c) 2022 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import * as database from '@bedrock/mongodb';
import assert from 'assert-plus';
import {createRequire} from 'module';
import {getAppIdentity} from '@bedrock/app-identity';
import {httpsAgent} from '@bedrock/https-agent';
const require = createRequire(import.meta.url);
const {
  AsymmetricKey, CapabilityAgent, Hmac, KeystoreAgent, KmsClient
} = require('@digitalbazaar/webkms-client');
const {LruCache} = require('@digitalbazaar/lru-memoize');

const {util: {BedrockError}} = bedrock;

const COLLECTION_NAME = 'service-agent-serviceAgent';
const FIVE_MINUTES = 1000 * 60 * 5;
const FIFTEEN_MINUTES = FIVE_MINUTES * 3;

let EPHEMERAL_AGENT_CACHE;
let SERVICE_AGENT_CACHE;

bedrock.events.on('bedrock.init', async () => {
  const cfg = bedrock.config['service-agent'];
  SERVICE_AGENT_CACHE = new LruCache(cfg.caches.serviceAgent);
  // this cache is intentionally not configurable at this time; allowing a
  // max age to be configured on it would disturb the implementation
  EPHEMERAL_AGENT_CACHE = new LruCache({
    // ephemeral agents include delegated zcaps and ephemeral keys; a cache
    // size of X means ~X different popular configurations will have increased
    // efficiency
    maxSize: 1000,
    maxAge: FIFTEEN_MINUTES
  });
});

bedrock.events.on('bedrock-mongodb.ready', async () => {
  await database.openCollections([COLLECTION_NAME]);

  await database.createIndexes([{
    // cover queries service agent by ID
    collection: COLLECTION_NAME,
    fields: {'serviceAgent.id': 1},
    options: {unique: true, background: false}
  }, {
    // cover config queries by service type
    collection: COLLECTION_NAME,
    fields: {'serviceAgent.serviceType': 1},
    options: {unique: true, background: false}
  }]);
});

/**
 * An object containing information on the query plan.
 *
 * @typedef {object} ExplainObject
 */

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

  // create IP-restricted keystore; only the local application will be able
  // to access keys in this keystore
  const {kms: kmsCfg} = bedrock.config['service-agent'];
  const config = {
    controller: id,
    ipAllowList: kmsCfg.ipAllowList,
    kmsModule: kmsCfg.kmsModule,
    meterId: kmsCfg.meterId,
    sequence: 0
  };
  const keystore = await KmsClient.createKeystore({
    url: `${kmsCfg.baseUrl}/keystores`,
    config,
    invocationSigner: appIdentitySigner,
    httpsAgent
  });

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
 * invocations but only lives for a limited period of time. Whenever this
 * function is called, the returned ephemeral agent will live for at least
 * five minutes.
 *
 * @param {object} options - The options to use.
 * @param {object} options.config - The service object config.
 * @param {object} options.serviceAgent - The service agent.
 *
 * @returns {Promise<object>} Resolves to the service agent's zcap invocation
 *   signer.
 */
export async function getEphemeralAgent({config, serviceAgent} = {}) {
  // FIXME: get ephemeral signer instead to optimize; make zcap last at least
  // as long as the cached document store ... add a max-age to the LRU cache
  // only if necessary

  // FIXME: service-agent API should expose an API that takes a service agent
  // and a full config and returns an ephemeral signer (if not already one in
  // memory) and delegates all zcaps to it and returns the signer and the zcaps
  // ... the signer and zcaps should be put in an LRU cache that is key'd off
  // of service agent ID, service agent sequence, config, and config sequence
  // (unless changes to service agent can be documented to require restarts)
  // such that if the service agent or the config changes a new signer will be
  // created -- and so that ephemeral signers are bound to the configs they
  // are associated with; zcaps should be delegated in parallel using signer
  // `serviceAgents.getInvocationSigner`; max age for the LRU cache entry
  // should be the max zcap expiration

  const fn = () => _getUncachedEphemeralAgent({config, serviceAgent});
  const key = JSON.stringify([
    config.id, config.sequence, serviceAgent.id, serviceAgent.sequence
  ]);
  const record = EPHEMERAL_AGENT_CACHE.memoize({key, fn});
  const ttl = record.expires - Date.now();
  if(ttl < FIVE_MINUTES && !record.next) {
    // kick off creating another uncached ephemeral agent and once it is
    // created, use it to replace the expiring one in the LRU cache; it is
    // safe to ignore errors -- errors will behave like the case where the
    // record simply expired because of disinterest (or another attempt can
    // be made if not yet expired)
    record.next = _getUncachedEphemeralAgent({config, serviceAgent});
    Promise.resolve(record.next)
      .then(() => EPHEMERAL_AGENT_CACHE.cache.set(key, record.next))
      .finally(() => delete record.next);
  }

  return record;
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

async function _getUncachedEphemeralAgent({config, serviceAgent} = {}) {
  // ephemeral agents must last at least 2x long as document store entries
  // for a minimum for 15 minutes to allow for rotation whereby new ephemeral
  // agents are created every ~10 minutes (rotation time is TTL - 5 minutes)
  const ttl = Math.min(FIFTEEN_MINUTES, cfg.caches.documentStore.maxAge * 2);
  const expires = Date.now() + ttl;

  // FIXME: create capability agent, CA

  // FIXME: delegate all zcaps in `config` to CA in parallel

  // // create invocation signer from service agent
  // const invocationSigner = await serviceAgents.getInvocationSigner(
  //   {serviceAgent});
  // const {zcaps} = config;

  return {capabilityAgent, expires};
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
