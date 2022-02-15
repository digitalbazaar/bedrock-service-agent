/*!
 * Copyright (c) 2022 Digital Bazaar, Inc. All rights reserved.
 */
import assert from 'assert-plus';
import bedrock from 'bedrock';
import database from 'bedrock-mongodb';
import {getAppIdentity} from 'bedrock-app-identity';
import {httpsAgent} from 'bedrock-https-agent';
import {
  AsymmetricKey, CapabilityAgent, KeystoreAgent, KmsClient
} from '@digitalbazaar/webkms-client';
import {LruCache} from '@digitalbazaar/lru-memoize';

const {util: {BedrockError}} = bedrock;

const COLLECTION_NAME = 'service-agent-serviceAgent';
let SERVICE_AGENT_CACHE;

bedrock.events.on('bedrock.init', async () => {
  const cfg = bedrock.config['service-agent'];
  SERVICE_AGENT_CACHE = new LruCache(cfg.caches.serviceAgent);
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

  // create the zcap invocation key for the service agent
  const {id: keystoreId} = keystore;
  const kmsClient = new KmsClient({keystoreId, httpsAgent});
  const capabilityAgent = new CapabilityAgent({signer: appIdentitySigner});
  const keystoreAgent = new KeystoreAgent(
    {keystoreId, capabilityAgent, kmsClient});
  // note: consider supporting other did methods (e.g., did:v1) in the future
  const publicAliasTemplate = _getPublicAliasTemplate({didMethod: 'key'});
  const key = await keystoreAgent.generateKey({
    type: 'asymmetric',
    publicAliasTemplate
  });

  // get service agent ID from key
  const serviceAgentId = key.id.slice(0, key.id.indexOf('#'));

  // build service agent info
  return {
    id: serviceAgentId,
    keystore: keystoreId,
    serviceType,
    sequence: 0,
    zcapInvocationKey: {
      id: key.id,
      kmsId: key.kmsId,
      type: key.type
    }
  };
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
    ...serviceAgent.zcapKeyInvocationKey,
    invocationSigner: zcapKeyInvocationSigner,
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
