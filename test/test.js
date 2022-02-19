/*!
 * Copyright (c) 2022 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const bedrock = require('bedrock');
const {getServiceIdentities} = require('bedrock-app-identity');
require('bedrock-edv-storage');
require('bedrock-https-agent');
require('bedrock-kms');
require('bedrock-kms-http');
require('bedrock-meter');
require('bedrock-meter-usage-reporter');
const {handlers} = require('bedrock-meter-http');
require('bedrock-server');
const {initializeServiceAgent} = require('bedrock-service-agent');
require('bedrock-ssm-mongodb');
require('bedrock-test');
const {createService} = require('bedrock-service-core');

const mockData = require('./mocha/mock.data');

bedrock.events.on('bedrock.init', async () => {
  /* Handlers need to be added before `bedrock.start` is called. These are
  no-op handlers to enable meter usage without restriction */
  handlers.setCreateHandler({
    handler({meter} = {}) {
      // use configured meter usage reporter as service ID for tests
      const clientName = mockData.productIdMap.get(meter.product.id);
      const serviceIdentites = getServiceIdentities();
      const serviceIdentity = serviceIdentites.get(clientName);
      if(!serviceIdentity) {
        throw new Error(`Could not find identity "${clientName}".`);
      }
      meter.serviceId = serviceIdentity.id;
      return {meter};
    }
  });
  handlers.setUpdateHandler({handler: ({meter} = {}) => ({meter})});
  handlers.setRemoveHandler({handler: ({meter} = {}) => ({meter})});
  handlers.setUseHandler({handler: ({meter} = {}) => ({meter})});

  // create `example` service
  /*const service =*/await createService({
    serviceType: 'example',
    routePrefix: '/examples',
    storageCost: {
      config: 1,
      revocation: 1
    },
    validation: {
      // require these zcaps (by reference ID)
      zcapReferenceIds: [{
        referenceId: 'edv',
        required: true
      }, {
        referenceId: 'hmac',
        required: true
      }, {
        referenceId: 'keyAgreementKey',
        required: true
      }]
    }
  });
});

// normally a service agent should be created on `bedrock-mongodb.ready`,
// however, since the KMS system used is local, we have to wait for it to
// be ready; so only do this on `bedrock.ready`
bedrock.events.on('bedrock.ready', async () => {
  // initialize service agent
  await initializeServiceAgent({serviceType: 'example'});
});

bedrock.start();
