/*!
 * Copyright (c) 2022 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import '@bedrock/ssm-mongodb';
import {getServiceIdentities} from '@bedrock/app-identity';
import '@bedrock/https-agent';
import '@bedrock/meter';
import '@bedrock/meter-usage-reporter';
import {handlers} from '@bedrock/meter-usage-reporter';
import '@bedrock/server';
import {createService} from '@bedrock/service-core';
import {initializeServiceAgent} from '@bedrock/service-agent';
import '@bedrock/kms';
import '@bedrock/kms-http';
import '@bedrock/edv-storage';
import {mockData} from './mocha/mock.data.js';

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

import '@bedrock/test';
bedrock.start();
