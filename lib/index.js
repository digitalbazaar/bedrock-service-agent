/*!
 * Copyright (c) 2021-2025 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import * as documentStores from './documentStores.js';
import * as serviceAgents from './serviceAgents.js';
import {addDocumentRoutes} from './http.js';
import {refreshZcaps} from './refresh.js';

const {util: {BedrockError}} = bedrock;

// load config defaults
import './config.js';

export {addDocumentRoutes, documentStores, serviceAgents, refreshZcaps};

/**
 * Initializes the service agent for the given service type. If it has not
 * been created yet, it will be created. This should be called on the
 * `bedrock-mongodb.ready` event once per service type that is running in an
 * application. If that application is using its own WebKMS system, then it
 * will need to be called on `bedrock.ready` instead (once the WebKMS system
 * is ready).
 *
 * @param {object} options - The options to use.
 * @param {object} options.serviceType - The service type to initialize the
 *   service agent for.
 *
 * @returns {Promise<object>} Resolves to the service agent information.
 */
export async function initializeServiceAgent({serviceType} = {}) {
  /* Note: When the service agent is first created, it is possible that more
  than one process in a partitioned, asychronous system may attempt to perform
  the provisioning. This can result in extra unused artifacts (e.g., keystores)
  that should be cleaned up. However, all disparate processes should eventually
  agree upon a single service agent instance. */

  // five minutes at most to complete
  const signal = AbortSignal.timeout(5 * 60 * 1000);
  // loop trying to get or create the service agent
  while(true) {
    try {
      // try to get service agent
      const record = await serviceAgents.get({serviceType});
      if(record) {
        return record.serviceAgent;
      }
    } catch(e) {
      if(e.name !== 'NotFoundError') {
        // some non-recoverable failure, bail
        throw e;
      }
    }

    let serviceAgent;
    try {
      // service agent not found, try to create it
      serviceAgent = await serviceAgents.generate({serviceType});
    } catch(e) {
      if(e.name !== 'InvalidStateError') {
        // some non-recoverable failure, bail
        throw e;
      }
      if(signal.aborted) {
        throw new BedrockError(
          'Timed out generating service agent.',
          'TimeoutError', {
            public: true,
            httpStatusCode: 503
          }, e);
      }
      // invalid state error, retry
      continue;
    }

    try {
      const record = await serviceAgents.insert({serviceAgent});
      return record.serviceAgent;
    } catch(e) {
      if(e.name !== 'DuplicateError') {
        // some non-recoverable failure, bail
        throw e;
      }
    }

    // loop to try again...
  }
}
