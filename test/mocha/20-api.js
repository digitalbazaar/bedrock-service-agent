/*!
 * Copyright (c) 2019-2022 Digital Bazaar, Inc. All rights reserved.
 */
import * as helpers from './helpers.js';
import {agent} from '@bedrock/https-agent';
import {documentStores} from '@bedrock/service-agent';
import {httpClient} from '@digitalbazaar/http-client';
import {mockData} from './mock.data.js';
import {CapabilityAgent} from '@digitalbazaar/webkms-client';

const {baseUrl} = mockData;

describe('API', () => {
  describe('document stores', () => {
    let capabilityAgent;
    let config;
    const zcaps = {};
    before(async () => {
      const secret = '53ad64ce-8e1d-11ec-bb12-10bf48838a41';
      const handle = 'test';
      capabilityAgent = await CapabilityAgent.fromSecret({secret, handle});

      // create keystore for capability agent
      const keystoreAgent = await helpers.createKeystoreAgent(
        {capabilityAgent});

      // create EDV for storage (creating hmac and kak in the process)
      const {
        edvConfig,
        hmac,
        keyAgreementKey
      } = await helpers.createEdv({capabilityAgent, keystoreAgent});

      // get service agent to delegate to
      const serviceType = 'example';
      const serviceAgentUrl =
        `${baseUrl}/service-agents/${encodeURIComponent(serviceType)}`;
      const {data: serviceAgent} = await httpClient.get(serviceAgentUrl, {
        agent
      });

      // delegate edv, hmac, and key agreement key zcaps to service agent
      const {id: edvId} = edvConfig;
      zcaps.edv = await helpers.delegate({
        controller: serviceAgent.id,
        delegator: capabilityAgent,
        invocationTarget: edvId
      });
      const {keystoreId} = keystoreAgent;
      zcaps.hmac = await helpers.delegate({
        capability: `urn:zcap:root:${encodeURIComponent(keystoreId)}`,
        controller: serviceAgent.id,
        invocationTarget: hmac.id,
        delegator: capabilityAgent
      });
      zcaps.keyAgreementKey = await helpers.delegate({
        capability: `urn:zcap:root:${encodeURIComponent(keystoreId)}`,
        controller: serviceAgent.id,
        invocationTarget: keyAgreementKey.kmsId,
        delegator: capabilityAgent
      });

      config = await helpers.createConfig({capabilityAgent, zcaps});
    });

    describe('get', () => {
      it('passes', async () => {
        const documentStore = await documentStores.get(
          {config, serviceType: 'example'});
        should.exist(documentStore);
        documentStore.should.be.an('object');
      });
    });
  });
});
