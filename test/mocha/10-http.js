/*!
 * Copyright (c) 2019-2025 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import * as helpers from './helpers.js';
import {agent} from '@bedrock/https-agent';
import {CapabilityAgent} from '@digitalbazaar/webkms-client';
import {documentStores} from '@bedrock/service-agent';
import {httpClient} from '@digitalbazaar/http-client';
import {mockData} from './mock.data.js';

const {baseUrl} = mockData;

describe('HTTP API', () => {
  describe('service objects', () => {
    let capabilityAgent;
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
    });
    describe('create config', () => {
      it('throws error on missing zcaps', async () => {
        let err;
        let result;
        try {
          result = await helpers.createConfig({capabilityAgent});
        } catch(e) {
          err = e;
        }
        should.exist(err);
        should.not.exist(result);
        err.data.details.errors.should.have.length(1);
        const [error] = err.data.details.errors;
        error.name.should.equal('ValidationError');
        error.message.should.contain(`should have required property 'zcaps'`);
      });
      it('creates a config', async () => {
        let err;
        let result;
        try {
          result = await helpers.createConfig({capabilityAgent, zcaps});
        } catch(e) {
          err = e;
        }
        assertNoError(err);
        should.exist(result);
        result.should.have.keys([
          'controller', 'id', 'sequence', 'meterId', 'zcaps'
        ]);
        result.sequence.should.equal(0);
        const {id: capabilityAgentId} = capabilityAgent;
        result.controller.should.equal(capabilityAgentId);
      });
      it('creates a config including proper ipAllowList', async () => {
        const ipAllowList = ['127.0.0.1/32', '::1/128'];

        let err;
        let result;
        try {
          result = await helpers.createConfig(
            {capabilityAgent, ipAllowList, zcaps});
        } catch(e) {
          err = e;
        }
        assertNoError(err);
        should.exist(result);
        result.should.have.keys([
          'controller', 'id', 'ipAllowList', 'sequence', 'meterId', 'zcaps'
        ]);
        result.sequence.should.equal(0);
        const {id: capabilityAgentId} = capabilityAgent;
        result.controller.should.equal(capabilityAgentId);
        result.ipAllowList.should.eql(ipAllowList);
      });
      it('throws error on invalid ipAllowList', async () => {
        // this is not a valid CIDR
        const ipAllowList = ['127.0.0.1/33'];

        let err;
        let result;
        try {
          result = await helpers.createConfig(
            {capabilityAgent, ipAllowList, zcaps});
        } catch(e) {
          err = e;
        }
        should.exist(err);
        should.not.exist(result);
        err.data.details.errors.should.have.length(1);
        const [error] = err.data.details.errors;
        error.name.should.equal('ValidationError');
        error.message.should.contain('should match pattern');
        error.details.path.should.equal('.ipAllowList[0]');
      });
      it('throws error on invalid ipAllowList', async () => {
        // an empty allow list is invalid
        const ipAllowList = [];

        let err;
        let result;
        try {
          result = await helpers.createConfig(
            {capabilityAgent, ipAllowList, zcaps});
        } catch(e) {
          err = e;
        }
        should.exist(err);
        should.not.exist(result);
        err.data.details.errors.should.have.length(1);
        const [error] = err.data.details.errors;
        error.name.should.equal('ValidationError');
        error.message.should.contain('should NOT have fewer than 1 items');
        error.details.path.should.equal('.ipAllowList');
      });
      it('throws error on no "sequence"', async () => {
        const url = `${bedrock.config.server.baseUri}/examples`;
        const config = {
          controller: capabilityAgent.id
        };

        let err;
        let result;
        try {
          result = await httpClient.post(url, {agent, json: config});
        } catch(e) {
          err = e;
        }
        should.exist(err);
        should.not.exist(result);
        err.data.type.should.equal('ValidationError');
        err.data.message.should.equal(
          'A validation error occurred in the \'createConfigBody\' validator.');
      });
    });

    describe('get config', () => {
      it('gets a config', async () => {
        const config = await helpers.createConfig(
          {capabilityAgent, zcaps});
        let err;
        let result;
        try {
          result = await helpers.getConfig({id: config.id, capabilityAgent});
        } catch(e) {
          err = e;
        }
        assertNoError(err);
        should.exist(result);
        result.should.have.keys([
          'controller', 'id', 'sequence', 'meterId', 'zcaps'
        ]);
        result.id.should.equal(config.id);
      });
      it('gets a config with ipAllowList', async () => {
        const ipAllowList = ['127.0.0.1/32', '::1/128'];

        const config = await helpers.createConfig(
          {capabilityAgent, ipAllowList, zcaps});
        let err;
        let result;
        try {
          result = await helpers.getConfig({id: config.id, capabilityAgent});
        } catch(e) {
          err = e;
        }
        assertNoError(err);
        should.exist(result);
        result.should.have.keys([
          'controller', 'id', 'ipAllowList', 'sequence', 'meterId', 'zcaps'
        ]);
        result.should.have.property('id');
        result.id.should.equal(config.id);
        result.ipAllowList.should.eql(ipAllowList);
      });
      it('returns NotAllowedError for invalid source IP', async () => {
        const ipAllowList = ['8.8.8.8/32'];

        const config = await helpers.createConfig(
          {capabilityAgent, ipAllowList, zcaps});
        let err;
        let result;
        try {
          result = await helpers.getConfig({id: config.id, capabilityAgent});
        } catch(e) {
          err = e;
        }
        should.not.exist(result);
        should.exist(err);
        err.status.should.equal(403);
        err.data.type.should.equal('NotAllowedError');
      });
    }); // get config

    describe('update config', () => {
      it('updates a config', async () => {
        // create new capability agent to change config `controller` to
        const capabilityAgent2 = await CapabilityAgent.fromSecret(
          {secret: 's2', handle: 'h2'});

        let err;
        let result;
        let existingConfig;
        try {
          existingConfig = result = await helpers.createConfig(
            {capabilityAgent, zcaps});
        } catch(e) {
          err = e;
        }
        assertNoError(err);
        should.exist(result);
        result.should.have.property('id');
        result.should.have.property('sequence');
        result.sequence.should.equal(0);
        const {id: capabilityAgentId} = capabilityAgent;
        result.should.have.property('controller');
        result.controller.should.equal(capabilityAgentId);

        // this update does not change the `meterId`
        const {id: url} = result;
        const newConfig = {
          controller: capabilityAgent2.id,
          id: url,
          meterId: existingConfig.meterId,
          sequence: 1,
          zcaps
        };

        err = null;
        result = null;
        try {
          const zcapClient = helpers.createZcapClient({capabilityAgent});
          result = await zcapClient.write({url, json: newConfig});
        } catch(e) {
          err = e;
        }
        assertNoError(err);
        should.exist(result.data);
        result.status.should.equal(200);
        result.data.should.have.keys([
          'id', 'controller', 'sequence', 'meterId', 'zcaps'
        ]);
        const expectedConfig = {
          ...existingConfig,
          ...newConfig
        };
        result.data.should.eql(expectedConfig);

        // should fail to retrieve the config now that controller
        // has changed
        err = null;
        result = null;
        try {
          result = await helpers.getConfig(
            {id: newConfig.id, capabilityAgent});
        } catch(e) {
          err = e;
        }
        should.exist(err);
        should.not.exist(result);
        err.status.should.equal(403);
        err.data.type.should.equal('NotAllowedError');

        // retrieve the config to confirm update was effective
        err = null;
        result = null;
        try {
          result = await helpers.getConfig(
            {id: newConfig.id, capabilityAgent: capabilityAgent2});
        } catch(e) {
          err = e;
        }
        assertNoError(err);
        should.exist(result);
        result.should.eql(expectedConfig);
      });
      it('rejects config update for an invalid zcap', async () => {
        const capabilityAgent2 = await CapabilityAgent.fromSecret(
          {secret: 's2', handle: 'h2'});

        let err;
        let result;
        try {
          result = await helpers.createConfig(
            {capabilityAgent, zcaps});
        } catch(e) {
          err = e;
        }
        assertNoError(err);
        should.exist(result);
        result.should.have.property('id');
        result.should.have.property('sequence');
        result.sequence.should.equal(0);
        const {id: capabilityAgentId} = capabilityAgent;
        result.should.have.property('controller');
        result.controller.should.equal(capabilityAgentId);

        const {id: url} = result;
        const newConfig = {
          controller: capabilityAgent2.id,
          id: url,
          meterId: result.meterId,
          sequence: 1,
          zcaps
        };

        err = null;
        result = null;
        try {
          // the capability invocation here is signed by `capabilityAgent2`
          // which is not the `controller` of the config
          const zcapClient = helpers.createZcapClient({
            capabilityAgent: capabilityAgent2
          });
          result = await zcapClient.write({url, json: newConfig});
        } catch(e) {
          err = e;
        }
        should.exist(err);
        should.not.exist(result);
        err.status.should.equal(403);
        err.data.type.should.equal('NotAllowedError');
        err.data.cause.message.should.contain(
          'The capability controller does not match the verification method ' +
          '(or its controller) used to invoke.');
      });
      it('rejects config update with an invalid sequence', async () => {
        const capabilityAgent2 = await CapabilityAgent.fromSecret(
          {secret: 's2', handle: 'h2'});

        let err;
        let result;
        try {
          result = await helpers.createConfig(
            {capabilityAgent, zcaps});
        } catch(e) {
          err = e;
        }
        assertNoError(err);
        should.exist(result);
        result.should.have.property('id');
        result.should.have.property('sequence');
        result.sequence.should.equal(0);
        const {id: capabilityAgentId} = capabilityAgent;
        result.should.have.property('controller');
        result.controller.should.equal(capabilityAgentId);

        const {id: url} = result;
        const newConfig = {
          controller: capabilityAgent2.id,
          id: url,
          meterId: result.meterId,
          // the proper sequence would be 1
          sequence: 10,
          zcaps
        };

        err = null;
        result = null;
        try {
          const zcapClient = helpers.createZcapClient({capabilityAgent});
          result = await zcapClient.write({url, json: newConfig});
        } catch(e) {
          err = e;
        }
        should.exist(err);
        should.not.exist(result);
        err.status.should.equal(409);
        err.data.type.should.equal('InvalidStateError');
      });
      describe('updates with ipAllowList', () => {
        it('updates a config with ipAllowList', async () => {
          const capabilityAgent2 = await CapabilityAgent.fromSecret(
            {secret: 's2', handle: 'h2'});

          const ipAllowList = ['127.0.0.1/32', '::1/128'];

          let err;
          let result;
          let existingConfig;
          try {
            existingConfig = result = await helpers.createConfig(
              {capabilityAgent, ipAllowList, zcaps});
          } catch(e) {
            err = e;
          }
          assertNoError(err);
          should.exist(result);
          result.should.have.property('id');
          result.should.have.property('sequence');
          result.sequence.should.equal(0);
          const {id: capabilityAgentId} = capabilityAgent;
          result.should.have.property('controller');
          result.controller.should.equal(capabilityAgentId);

          const {id: url} = result;
          const newConfig = {
            controller: capabilityAgent2.id,
            id: url,
            ipAllowList,
            meterId: existingConfig.meterId,
            sequence: 1,
            zcaps
          };

          err = null;
          result = null;
          try {
            const zcapClient = helpers.createZcapClient({capabilityAgent});
            result = await zcapClient.write({url, json: newConfig});
          } catch(e) {
            err = e;
          }
          assertNoError(err);
          should.exist(result.data);
          result.status.should.equal(200);
          result.data.should.have.keys([
            'id', 'controller', 'sequence', 'meterId', 'ipAllowList', 'zcaps'
          ]);
          const expectedConfig = {
            ...existingConfig,
            ...newConfig
          };
          result.data.should.eql(expectedConfig);

          // should fail to retrieve the config now that controller
          // has changed
          err = null;
          result = null;
          try {
            result = await helpers.getConfig(
              {id: newConfig.id, capabilityAgent});
          } catch(e) {
            err = e;
          }
          should.exist(err);
          should.not.exist(result);
          err.status.should.equal(403);
          err.data.type.should.equal('NotAllowedError');

          // retrieve the config to confirm update was effective
          err = null;
          result = null;
          try {
            result = await helpers.getConfig(
              {id: newConfig.id, capabilityAgent: capabilityAgent2});
          } catch(e) {
            err = e;
          }
          assertNoError(err);
          should.exist(result);
          result.should.eql(expectedConfig);
        });
        it('returns NotAllowedError for invalid source IP', async () => {
          const capabilityAgent2 = await CapabilityAgent.fromSecret(
            {secret: 's2', handle: 'h2'});

          const ipAllowList = ['8.8.8.8/32'];

          let err;
          let result;
          try {
            result = await helpers.createConfig(
              {capabilityAgent, ipAllowList, zcaps});
          } catch(e) {
            err = e;
          }
          assertNoError(err);
          should.exist(result);
          result.should.have.property('id');
          result.should.have.property('sequence');
          result.sequence.should.equal(0);
          const {id: capabilityAgentId} = capabilityAgent;
          result.should.have.property('controller');
          result.controller.should.equal(capabilityAgentId);

          const {id: url} = result;
          const newConfig = {
            controller: capabilityAgent2.id,
            id: url,
            ipAllowList,
            meterId: result.meterId,
            sequence: 1,
            zcaps
          };

          err = null;
          result = null;
          try {
            const zcapClient = helpers.createZcapClient({capabilityAgent});
            result = await zcapClient.write({url, json: newConfig});
          } catch(e) {
            err = e;
          }
          should.not.exist(result);
          should.exist(err);
          err.status.should.equal(403);
          err.data.type.should.equal('NotAllowedError');
        });
      }); // updates with ipAllowList
    }); // end update config

    describe('revocations', () => {
      it('throws error with invalid zcap when revoking', async () => {
        const config = await helpers.createConfig({capabilityAgent, zcaps});
        const zcap = {
          '@context': ['https://w3id.org/zcap/v1'],
          id: 'urn:uuid:895d985c-8e20-11ec-b82f-10bf48838a41',
          proof: {}
        };

        const url =
          `${config.id}/zcaps/revocations/${encodeURIComponent(zcap.id)}`;

        let err;
        let result;
        try {
          result = await httpClient.post(url, {agent, json: zcap});
        } catch(e) {
          err = e;
        }
        should.exist(err);
        should.not.exist(result);
        err.data.type.should.equal('ValidationError');
        err.data.message.should.equal(
          'A validation error occurred in the \'Delegated ZCAP\' validator.');
      });
      it('revokes a zcap', async () => {
        const config = await helpers.createConfig({capabilityAgent, zcaps});

        const capabilityAgent2 = await CapabilityAgent.fromSecret(
          {secret: 's2', handle: 'h2'});

        const zcap = await helpers.delegate({
          controller: capabilityAgent2.id,
          invocationTarget: config.id,
          delegator: capabilityAgent
        });

        // zcap should work to get config
        const zcapClient = helpers.createZcapClient(
          {capabilityAgent: capabilityAgent2});
        const {data} = await zcapClient.read({capability: zcap});
        data.should.have.keys([
          'controller', 'id', 'sequence', 'meterId', 'zcaps'
        ]);
        data.id.should.equal(config.id);

        // revoke zcap
        await helpers.revokeDelegatedCapability({
          serviceObjectId: config.id,
          capabilityToRevoke: zcap,
          invocationSigner: capabilityAgent.getSigner()
        });

        // now getting config should fail
        let err;
        try {
          await zcapClient.read({capability: zcap});
        } catch(e) {
          err = e;
        }
        should.exist(err);
        err.data.type.should.equal('NotAllowedError');
      });
    }); // end revocations

    describe('document storage', async () => {
      it('inserts a document', async () => {
        const config = await helpers.createConfig({capabilityAgent, zcaps});
        const rootZcap = `urn:zcap:root:${encodeURIComponent(config.id)}`;

        const id = `urn:uuid:${crypto.randomUUID()}`;
        const data = {foo: 'bar'};
        const client = helpers.createZcapClient({capabilityAgent});
        const url = `${config.id}/example-docs`;

        let err;
        let response;
        try {
          response = await client.write({
            url, json: {id, data},
            capability: rootZcap
          });
        } catch(e) {
          err = e;
        }
        assertNoError(err);
        should.exist(response);
        should.exist(response.data);
        response.data.should.deep.equal({
          id,
          data,
          sequence: 0
        });
        const expectedLocation = `${url}/${encodeURIComponent(id)}`;
        response.headers.get('location').should.equal(expectedLocation);
      });
      it('fails to insert a duplicate document', async () => {
        const config = await helpers.createConfig({capabilityAgent, zcaps});
        const rootZcap = `urn:zcap:root:${encodeURIComponent(config.id)}`;

        // insert doc
        const id = `urn:uuid:${crypto.randomUUID()}`;
        const data = {foo: 'bar'};
        const client = helpers.createZcapClient({capabilityAgent});
        const url = `${config.id}/example-docs`;

        {
          let err;
          let response;
          try {
            response = await client.write({
              url, json: {id, data},
              capability: rootZcap
            });
          } catch(e) {
            err = e;
          }
          assertNoError(err);
          should.exist(response);
          should.exist(response.data);
          response.data.should.deep.equal({
            id,
            data,
            sequence: 0
          });
          const expectedLocation = `${url}/${encodeURIComponent(id)}`;
          response.headers.get('location').should.equal(expectedLocation);
        }

        // should fail to insert doc with the same ID
        {
          let err;
          let response;
          try {
            response = await client.write({
              url, json: {id, data},
              capability: rootZcap
            });
          } catch(e) {
            err = e;
          }
          should.exist(err);
          should.not.exist(response);
          err.data.name.should.equal('DuplicateError');
        }
      });
      it('updates a document', async () => {
        const config = await helpers.createConfig({capabilityAgent, zcaps});
        const rootZcap = `urn:zcap:root:${encodeURIComponent(config.id)}`;

        // insert example doc
        const id = `urn:uuid:${crypto.randomUUID()}`;
        const data = {foo: 'bar'};
        const client = helpers.createZcapClient({capabilityAgent});
        let url = `${config.id}/example-docs`;
        await client.write({
          url, json: {id, data},
          capability: rootZcap
        });

        // update `data`
        data.baz = 'thing';
        url = `${url}/${encodeURIComponent(id)}`;
        let err;
        let response;
        try {
          response = await client.write({
            url, json: {id, data, sequence: 1},
            capability: rootZcap
          });
        } catch(e) {
          err = e;
        }
        assertNoError(err);
        should.exist(response);
        should.exist(response.data);
        response.data.should.deep.equal({
          id,
          data,
          sequence: 1
        });
      });
      it('gets a document', async () => {
        const config = await helpers.createConfig({capabilityAgent, zcaps});
        const rootZcap = `urn:zcap:root:${encodeURIComponent(config.id)}`;

        // insert example document
        const id = `urn:uuid:${crypto.randomUUID()}`;
        const data = {foo: 'bar'};
        const client = helpers.createZcapClient({capabilityAgent});
        let url = `${config.id}/example-docs`;
        await client.write({
          url, json: {id, data},
          capability: rootZcap
        });

        url = `${url}/${encodeURIComponent(id)}`;
        let err;
        let response;
        try {
          response = await client.read({
            url, capability: rootZcap
          });
        } catch(e) {
          err = e;
        }
        assertNoError(err);
        should.exist(response);
        should.exist(response.data);
        response.data.should.deep.equal({
          id,
          data,
          sequence: 0
        });
      });
      it('fails to get a document with wrong meta type', async () => {
        const config = await helpers.createConfig({capabilityAgent, zcaps});
        const rootZcap = `urn:zcap:root:${encodeURIComponent(config.id)}`;

        // insert document
        const id = `urn:uuid:${crypto.randomUUID()}`;
        const data = {foo: 'bar'};
        const client = helpers.createZcapClient({capabilityAgent});
        let url = `${config.id}/example-docs`;
        await client.write({
          url, json: {id, data},
          capability: rootZcap
        });
        // update URL to doc URL
        url = `${url}/${encodeURIComponent(id)}`;

        // get document successfully
        {
          let err;
          let response;
          try {
            response = await client.read({
              url, capability: rootZcap
            });
          } catch(e) {
            err = e;
          }
          assertNoError(err);
          should.exist(response);
          should.exist(response.data);
          response.data.should.deep.equal({
            id,
            data,
            sequence: 0
          });
        }

        // now erroneously update context to new meta type
        const {documentStore} = await documentStores.get({
          config, serviceType: 'example'
        });
        await documentStore.upsert({
          content: {id, data},
          meta: {type: 'different'}
        });

        {
          let err;
          let response;
          try {
            response = await client.read({
              url, capability: rootZcap
            });
          } catch(e) {
            err = e;
          }
          should.exist(err);
          should.not.exist(response);
          err.data.name.should.equal('NotFoundError');
        }
      });
    });
  });
});
