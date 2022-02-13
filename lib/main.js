/*!
 * Copyright (c) 2021-2022 Digital Bazaar, Inc. All rights reserved.
 */
import * as documentStores from './storage/documentStores.js';
import * as serviceAgents from './storage/serviceAgents.js';

// load config defaults
import './config.js';

export {documentStores, serviceAgents};

/**
 * Initializes the service agent for the given service type. If it has not
 * been created yet, it will be created.
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

    // service agent not found, try to create it
    const serviceAgent = await serviceAgents.generate({serviceType});
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
