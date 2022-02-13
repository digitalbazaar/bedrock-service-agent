/*!
 * Copyright (c) 2022 Digital Bazaar, Inc. All rights reserved.
 */
import assert from 'assert-plus';
import bedrock from 'bedrock';
import database from 'bedrock-mongodb';
//import {LruCache} from '@digitalbazaar/lru-memoize';

const {util: {BedrockError}} = bedrock;

const COLLECTION_NAME = 'service-agent-serviceAgent';

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
 * Inserts a new service agent record into storage.
 *
 * @param {object} options - The options to use.
 * @param {object} options.serviceAgent - The service agent information.
 *
 * @returns {Promise<object>} Resolves to the database record.
 */
export async function insert({serviceAgent} = {}) {
  assert.object(serviceAgent, 'serviceAgent');
  assert.string(serviceAgent.id, 'serviceAgent.id');
  assert.string(serviceAgent.keystore, 'serviceAgent.keystore');
  assert.string(serviceAgent.serviceType, 'serviceAgent.serviceType');

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
  assert.object(serviceAgent, 'serviceAgent');
  assert.string(serviceAgent.id, 'serviceAgent.id');
  assert.string(serviceAgent.keystore, 'serviceAgent.keystore');
  assert.number(serviceAgent.sequence, serviceAgent.sequence);

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
