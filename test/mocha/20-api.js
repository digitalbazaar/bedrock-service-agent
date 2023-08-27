/*!
 * Copyright (c) 2019-2023 Digital Bazaar, Inc. All rights reserved.
 */
import * as helpers from './helpers.js';
import {documentStores, serviceAgents} from '@bedrock/service-agent';
import {agent} from '@bedrock/https-agent';
import {CapabilityAgent} from '@digitalbazaar/webkms-client';
import {httpClient} from '@digitalbazaar/http-client';
import {mockData} from './mock.data.js';

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

      it('document store rotation', async () => {
        // forcibly clear the document store cache and set new short TTL
        const ttl = 500;
        documentStores._resetDocumentStoreCache({ttl});

        // get initial doc store
        const docStore1 = await documentStores.get(
          {config, serviceType: 'example'});

        // get again; should be same cached value
        await new Promise(r => setTimeout(r, 100));
        const docStore2 = await documentStores.get(
          {config, serviceType: 'example'});
        docStore2.should.equal(docStore1);

        // get again; should be a new rotated doc store
        await new Promise(r => setTimeout(r, 400));
        const docStore3 = await documentStores.get(
          {config, serviceType: 'example'});
        docStore3.should.not.equal(docStore1);

        // get again; should be a brand new doc store
        await new Promise(r => setTimeout(r, 600));
        const docStore4 = await documentStores.get(
          {config, serviceType: 'example'});
        docStore4.should.not.equal(docStore3);

        // reset cache again
        documentStores._resetDocumentStoreCache();
      });
    });
  });

  describe('ephemeral agent rotation', () => {
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
      // use long base expiration date for the rotation tests
      const expires = new Date(Date.now() + 60 * 60 * 1000)
        .toISOString().slice(0, -5) + 'Z';
      zcaps.edv = await helpers.delegate({
        controller: serviceAgent.id,
        delegator: capabilityAgent,
        invocationTarget: edvId,
        expires
      });
      const {keystoreId} = keystoreAgent;
      zcaps.hmac = await helpers.delegate({
        capability: `urn:zcap:root:${encodeURIComponent(keystoreId)}`,
        controller: serviceAgent.id,
        invocationTarget: hmac.id,
        delegator: capabilityAgent,
        expires
      });
      zcaps.keyAgreementKey = await helpers.delegate({
        capability: `urn:zcap:root:${encodeURIComponent(keystoreId)}`,
        controller: serviceAgent.id,
        invocationTarget: keyAgreementKey.kmsId,
        delegator: capabilityAgent,
        expires
      });

      config = await helpers.createConfig({capabilityAgent, zcaps});
    });

    it('rotates an ephemeral agent', async () => {
      const serviceType = 'example';
      const {serviceAgent} = await serviceAgents.get({serviceType});

      // forcibly clear the ephemeral agent cache and set new short TTL
      const ttl = 250;
      serviceAgents._resetEphemeralAgentCache({ttl});

      // get ephemeral agent
      const {
        capabilityAgent: agent1, expires
      } = await serviceAgents.getEphemeralAgent({config, serviceAgent});
      should.exist(expires);
      expires.should.be.a('Date');
      expires.should.be.greaterThan(new Date());

      // get ephemeral agent again and ensure it's the same one
      const {capabilityAgent: agent2} = await serviceAgents.getEphemeralAgent(
        {config, serviceAgent});
      agent2.id.should.equal(agent1.id);

      // wait for a quarter TTL and ensure the same agent is cached
      await new Promise(r => setTimeout(r, ttl / 4));
      const {
        capabilityAgent: agent3, _next: _next3
      } = await serviceAgents.getEphemeralAgent({config, serviceAgent});
      agent3.id.should.equal(agent1.id);

      // wait a TTL period to ensure the agent has been rotated
      await new Promise(r => setTimeout(r, ttl));
      const {
        capabilityAgent: agent4, _next: _next4
      } = await serviceAgents.getEphemeralAgent(
        {config, serviceAgent});
      agent4.id.should.not.equal(agent1.id);
      // rotation from 3rd agent should be the 4th agent
      const next3Rotation = await _next3;
      should.exist(next3Rotation);
      next3Rotation.capabilityAgent.id.should.equal(agent4.id);

      // wait for full TTL to expire the record so the rotation isn't used
      await new Promise(r => setTimeout(r, ttl));
      const {
        capabilityAgent: agent5
      } = await serviceAgents.getEphemeralAgent(
        {config, serviceAgent});
      agent4.id.should.not.equal(agent1.id);
      // rotation from the 4th agent should NOT be the 5th agent because the
      // rotation should have been dropped due to 4th expiring from the cache
      const next4Rotation = await _next4;
      should.exist(next4Rotation);
      next4Rotation.capabilityAgent.id.should.not.equal(agent5.id);

      // reset cache again
      serviceAgents._resetEphemeralAgentCache();
    });
  });
});
