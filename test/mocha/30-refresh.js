/*!
 * Copyright (c) 2025 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import * as helpers from './helpers.js';
import {agent} from '@bedrock/https-agent';
import {CapabilityAgent} from '@digitalbazaar/webkms-client';
import {httpClient} from '@digitalbazaar/http-client';
import {mockData} from './mock.data.js';
import {refreshZcaps} from '@bedrock/service-agent';

const {util: {BedrockError}} = bedrock;

describe('Refresh zcaps', () => {
  it('should find a config to refresh', async () => {
    const secret = crypto.randomUUID();
    const handle = 'test';
    const capabilityAgent = await CapabilityAgent.fromSecret({secret, handle});

    // function to be called when refreshing the created config
    const configId = `${mockData.baseUrl}/refreshables/${crypto.randomUUID()}`;
    const configRefreshPromise = new Promise(resolve =>
      mockData.refreshHandlerListeners.set(
        configId, ({record}) => resolve(record)));

    const expectedAfter = Date.now() + bedrock.config['service-core']
      .configStorage.refresh.isolateTimeout;

    let err;
    let result;
    try {
      const {id: meterId} = await helpers.createMeter({
        capabilityAgent, serviceType: 'refreshing'
      });
      result = await helpers.createConfig({
        capabilityAgent, meterId, servicePath: '/refreshables',
        options: {id: configId}
      });
    } catch(e) {
      err = e;
    }
    assertNoError(err);
    should.exist(result);
    result.should.have.keys([
      'controller', 'id', 'sequence', 'meterId'
    ]);
    result.sequence.should.equal(0);
    const {id: capabilityAgentId} = capabilityAgent;
    result.controller.should.equal(capabilityAgentId);

    // wait for refresh promise to resolve
    const record = await configRefreshPromise;
    record.config.id.should.equal(configId);
    record.config.sequence.should.equal(0);
    record.meta.refresh.enabled.should.equal(true);
    record.meta.refresh.after.should.be.gte(expectedAfter);
  });
  it('should find no refresh zcap in a config w/no zcaps', async () => {
    const secret = crypto.randomUUID();
    const handle = 'test';
    const capabilityAgent = await CapabilityAgent.fromSecret({secret, handle});

    // function to be called when refreshing the created config
    const expectedAfter = Date.now() + 987654321;
    const configId = `${mockData.baseUrl}/refreshables/${crypto.randomUUID()}`;
    const configRefreshPromise = new Promise((resolve, reject) =>
      mockData.refreshHandlerListeners.set(configId, async ({
        record, signal
      }) => {
        try {
          const result = await refreshZcaps({
            serviceType: 'refreshing', config: record.config, signal
          });
          result.should.deep.equal({
            refresh: {enabled: false, after: 0}
          });

          // update record
          await mockData.refreshingService.configStorage.update({
            config: {...record.config, sequence: record.config.sequence + 1},
            refresh: {
              enabled: false,
              after: expectedAfter
            }
          });
          resolve(mockData.refreshingService.configStorage.get({id: configId}));
        } catch(e) {
          reject(e);
        }
      }));

    let err;
    let result;
    try {
      const {id: meterId} = await helpers.createMeter({
        capabilityAgent, serviceType: 'refreshing'
      });
      result = await helpers.createConfig({
        capabilityAgent, meterId, servicePath: '/refreshables',
        options: {id: configId}
      });
    } catch(e) {
      err = e;
    }
    assertNoError(err);
    should.exist(result);
    result.should.have.keys([
      'controller', 'id', 'sequence', 'meterId'
    ]);
    result.sequence.should.equal(0);
    const {id: capabilityAgentId} = capabilityAgent;
    result.controller.should.equal(capabilityAgentId);

    // wait for refresh promise to resolve
    const record = await configRefreshPromise;
    record.config.id.should.equal(configId);
    record.config.sequence.should.equal(1);
    record.meta.refresh.enabled.should.equal(false);
    record.meta.refresh.after.should.equal(expectedAfter);
  });
  it('should find no refresh zcap in a config w/ others', async () => {
    const secret = crypto.randomUUID();
    const handle = 'test';
    const capabilityAgent = await CapabilityAgent.fromSecret({secret, handle});

    // function to be called when refreshing the created config
    const expectedAfter = Date.now() + 987654321;
    const configId = `${mockData.baseUrl}/refreshables/${crypto.randomUUID()}`;
    const configRefreshPromise = new Promise((resolve, reject) =>
      mockData.refreshHandlerListeners.set(configId, async ({
        record, signal
      }) => {
        try {
          const result = await refreshZcaps({
            serviceType: 'refreshing', config: record.config, signal
          });
          result.should.deep.equal({
            refresh: {enabled: false, after: 0}
          });

          // update record
          await mockData.refreshingService.configStorage.update({
            config: {...record.config, sequence: record.config.sequence + 1},
            refresh: {
              enabled: false,
              after: expectedAfter
            }
          });
          resolve(mockData.refreshingService.configStorage.get({id: configId}));
        } catch(e) {
          reject(e);
        }
      }));

    let err;
    let result;
    try {
      const {id: meterId} = await helpers.createMeter({
        capabilityAgent, serviceType: 'refreshing'
      });
      const zcaps = await _createZcaps({
        capabilityAgent, serviceType: 'refreshing'
      });
      delete zcaps.refresh;
      result = await helpers.createConfig({
        capabilityAgent, meterId, servicePath: '/refreshables',
        options: {id: configId, zcaps}
      });
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

    // wait for refresh promise to resolve
    const record = await configRefreshPromise;
    record.config.id.should.equal(configId);
    record.config.sequence.should.equal(1);
    record.meta.refresh.enabled.should.equal(false);
    record.meta.refresh.after.should.equal(expectedAfter);
  });
  it('should handle 404 for refresh policy', async () => {
    const secret = crypto.randomUUID();
    const handle = 'test';
    const capabilityAgent = await CapabilityAgent.fromSecret({secret, handle});

    // function to be called when refreshing the created config
    const expectedAfter = Date.now() + 987654321;
    const configId = `${mockData.baseUrl}/refreshables/${crypto.randomUUID()}`;
    const configRefreshPromise = new Promise((resolve, reject) =>
      mockData.refreshHandlerListeners.set(configId, async ({
        record, signal
      }) => {
        try {
          const result = await refreshZcaps({
            serviceType: 'refreshing', config: record.config, signal
          });
          result.refresh.enabled.should.equal(false);
          result.error.name.should.equal('NotFoundError');
          should.not.exist(result.config);

          // update record
          await mockData.refreshingService.configStorage.update({
            config: {...record.config, sequence: record.config.sequence + 1},
            refresh: {
              enabled: true,
              after: expectedAfter
            }
          });
          resolve(mockData.refreshingService.configStorage.get({id: configId}));
        } catch(e) {
          reject(e);
        }
      }));

    let err;
    let result;
    try {
      const {id: meterId} = await helpers.createMeter({
        capabilityAgent, serviceType: 'refreshing'
      });
      const zcaps = await _createZcaps({
        capabilityAgent, serviceType: 'refreshing'
      });
      result = await helpers.createConfig({
        capabilityAgent, meterId, servicePath: '/refreshables',
        options: {
          id: configId,
          zcaps
        }
      });
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

    // wait for refresh promise to resolve
    const record = await configRefreshPromise;
    record.config.id.should.equal(configId);
    record.config.sequence.should.equal(1);
    record.meta.refresh.enabled.should.equal(true);
    record.meta.refresh.after.should.equal(expectedAfter);
  });
  it('should handle 403 for refresh policy', async () => {
    const secret = crypto.randomUUID();
    const handle = 'test';
    const capabilityAgent = await CapabilityAgent.fromSecret({secret, handle});

    mockData.zcapRefreshPolicyRouteListeners.set(
      capabilityAgent.id, async () => {
        throw new BedrockError('Zcap refresh not allowed.', {
          name: 'NotAllowedError',
          details: {
            httpStatusCode: 403,
            public: true
          }
        });
      });

    // function to be called when refreshing the created config
    const expectedAfter = Date.now() + 987654321;
    const configId = `${mockData.baseUrl}/refreshables/${crypto.randomUUID()}`;
    const configRefreshPromise = new Promise((resolve, reject) =>
      mockData.refreshHandlerListeners.set(configId, async ({
        record, signal
      }) => {
        try {
          const result = await refreshZcaps({
            serviceType: 'refreshing', config: record.config, signal
          });
          result.refresh.enabled.should.equal(false);
          result.error.name.should.equal('NotAllowedError');
          should.not.exist(result.config);

          // update record
          await mockData.refreshingService.configStorage.update({
            config: {...record.config, sequence: record.config.sequence + 1},
            refresh: {
              enabled: true,
              after: expectedAfter
            }
          });
          resolve(mockData.refreshingService.configStorage.get({id: configId}));
        } catch(e) {
          reject(e);
        }
      }));

    let err;
    let result;
    try {
      const {id: meterId} = await helpers.createMeter({
        capabilityAgent, serviceType: 'refreshing'
      });
      const zcaps = await _createZcaps({
        capabilityAgent, serviceType: 'refreshing'
      });
      result = await helpers.createConfig({
        capabilityAgent, meterId, servicePath: '/refreshables',
        options: {
          id: configId,
          zcaps
        }
      });
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

    // wait for refresh promise to resolve
    const record = await configRefreshPromise;
    record.config.id.should.equal(configId);
    record.config.sequence.should.equal(1);
    record.meta.refresh.enabled.should.equal(true);
    record.meta.refresh.after.should.equal(expectedAfter);
  });
  it('should handle 403 for refresh', async () => {
    const secret = crypto.randomUUID();
    const handle = 'test';
    const capabilityAgent = await CapabilityAgent.fromSecret({secret, handle});

    mockData.zcapRefreshPolicyRouteListeners.set(capabilityAgent.id, async ({
      res
    }) => {
      res.json({
        policy: {
          refresh: {
            // no constraints
            constraints: {}
          }
        }
      });
    });
    mockData.zcapRefreshRouteListeners.set(capabilityAgent.id, async () => {
      throw new BedrockError('Zcap refresh not allowed.', {
        name: 'NotAllowedError',
        details: {
          httpStatusCode: 403,
          public: true
        }
      });
    });

    // function to be called when refreshing the created config
    const expectedAfter = Date.now() + 987654321;
    const configId = `${mockData.baseUrl}/refreshables/${crypto.randomUUID()}`;
    const configRefreshPromise = new Promise((resolve, reject) =>
      mockData.refreshHandlerListeners.set(configId, async ({
        record, signal
      }) => {
        try {
          const now = Date.now();
          const later = now + 1000 * 60 * 5;
          const result = await refreshZcaps({
            serviceType: 'refreshing', config: record.config, signal
          });
          // should be true as refresh is enabled, however, the refresh zcap
          // was possibly temporarily disallowed
          result.refresh.enabled.should.equal(true);
          should.exist(result.config);
          result.refresh.after.should.be.gte(later);
          should.exist(result.results);
          result.results.length.should.equal(4);
          result.results[0].refreshed.should.equal(false);
          result.results[1].refreshed.should.equal(false);
          result.results[2].refreshed.should.equal(false);
          result.results[3].refreshed.should.equal(false);
          result.results[0].error.name.should.equal('NotAllowedError');
          result.results[1].error.name.should.equal('NotAllowedError');
          result.results[2].error.name.should.equal('NotAllowedError');
          result.results[3].error.name.should.equal('NotAllowedError');

          // update record
          await mockData.refreshingService.configStorage.update({
            config: {...result.config, sequence: result.config.sequence + 1},
            refresh: {
              enabled: true,
              after: expectedAfter
            }
          });
          resolve(mockData.refreshingService.configStorage.get({id: configId}));
        } catch(e) {
          reject(e);
        }
      }));

    let err;
    let result;
    let zcaps;
    try {
      const {id: meterId} = await helpers.createMeter({
        capabilityAgent, serviceType: 'refreshing'
      });
      zcaps = await _createZcaps({
        capabilityAgent, serviceType: 'refreshing'
      });
      result = await helpers.createConfig({
        capabilityAgent, meterId, servicePath: '/refreshables',
        options: {
          id: configId,
          zcaps
        }
      });
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

    // wait for refresh promise to resolve
    const record = await configRefreshPromise;
    record.config.id.should.equal(configId);
    record.config.sequence.should.equal(1);
    record.meta.refresh.enabled.should.equal(true);
    record.meta.refresh.after.should.equal(expectedAfter);

    // ensure zcaps did not change
    for(const [key, value] of Object.entries(zcaps)) {
      record.config.zcaps[key].should.deep.equal(value);
    }
  });
  it('should not refresh zcaps with "refresh=false" policy', async () => {
    const secret = crypto.randomUUID();
    const handle = 'test';
    const capabilityAgent = await CapabilityAgent.fromSecret({secret, handle});

    mockData.zcapRefreshPolicyRouteListeners.set(capabilityAgent.id, async ({
      res
    }) => {
      res.json({
        policy: {
          refresh: false
        }
      });
    });
    mockData.zcapRefreshRouteListeners.set(capabilityAgent.id, async () => {
      // should not happen because no zcap refreshes should even be attempted
      throw new BedrockError('Zcap refresh not allowed.', {
        name: 'NotAllowedError',
        details: {
          httpStatusCode: 403,
          public: true
        }
      });
    });

    // function to be called when refreshing the created config
    const configId = `${mockData.baseUrl}/refreshables/${crypto.randomUUID()}`;
    const configRefreshPromise = new Promise((resolve, reject) =>
      mockData.refreshHandlerListeners.set(configId, async ({
        record, signal
      }) => {
        try {
          const result = await refreshZcaps({
            serviceType: 'refreshing', config: record.config, signal
          });
          result.refresh.enabled.should.equal(false);
          result.refresh.after.should.equal(0);
          should.not.exist(result.config);

          // update record
          await mockData.refreshingService.configStorage.update({
            config: {...record.config, sequence: record.config.sequence + 1},
            refresh: {
              enabled: result.refresh.enabled,
              after: result.refresh.after
            }
          });
          resolve(mockData.refreshingService.configStorage.get({id: configId}));
        } catch(e) {
          reject(e);
        }
      }));

    let err;
    let result;
    try {
      const {id: meterId} = await helpers.createMeter({
        capabilityAgent, serviceType: 'refreshing'
      });
      const zcaps = await _createZcaps({
        capabilityAgent, serviceType: 'refreshing'
      });
      result = await helpers.createConfig({
        capabilityAgent, meterId, servicePath: '/refreshables',
        options: {
          id: configId,
          zcaps
        }
      });
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

    // wait for refresh promise to resolve
    const record = await configRefreshPromise;
    record.config.id.should.equal(configId);
    record.config.sequence.should.equal(1);
    record.meta.refresh.enabled.should.equal(false);
    record.meta.refresh.after.should.equal(0);
  });
  it('should not refresh zcaps with too large TTL', async () => {
    const secret = crypto.randomUUID();
    const handle = 'test';
    const capabilityAgent = await CapabilityAgent.fromSecret({secret, handle});

    mockData.zcapRefreshPolicyRouteListeners.set(capabilityAgent.id, async ({
      res
    }) => {
      res.json({
        policy: {
          refresh: {
            constraints: {
              // require fully expired zcaps
              maxTtlBeforeRefresh: 0
            }
          }
        }
      });
    });
    mockData.zcapRefreshRouteListeners.set(capabilityAgent.id, async () => {
      // should not happen because no zcap refreshes should even be attempted
      throw new BedrockError('Zcap refresh not allowed.', {
        name: 'NotAllowedError',
        details: {
          httpStatusCode: 403,
          public: true
        }
      });
    });

    // function to be called when refreshing the created config
    const expectedAfter = Date.now() + 987654321;
    const configId = `${mockData.baseUrl}/refreshables/${crypto.randomUUID()}`;
    const configRefreshPromise = new Promise((resolve, reject) =>
      mockData.refreshHandlerListeners.set(configId, async ({
        record, signal
      }) => {
        try {
          const now = Date.now();
          const later = now + 1000 * 60 * 5;
          const result = await refreshZcaps({
            serviceType: 'refreshing', config: record.config, signal
          });
          result.refresh.enabled.should.equal(true);
          should.exist(result.config);
          result.refresh.after.should.be.gte(later);
          should.exist(result.results);
          result.results.length.should.equal(4);
          result.results[3].refreshed.should.equal(false);
          result.results[3].refreshed.should.equal(false);
          result.results[3].refreshed.should.equal(false);
          result.results[3].refreshed.should.equal(false);
          should.not.exist(result.results[0].error);
          should.not.exist(result.results[0].error);
          should.not.exist(result.results[0].error);
          should.not.exist(result.results[0].error);

          // update record
          await mockData.refreshingService.configStorage.update({
            config: {...result.config, sequence: result.config.sequence + 1},
            refresh: {
              enabled: true,
              after: expectedAfter
            }
          });
          resolve(mockData.refreshingService.configStorage.get({id: configId}));
        } catch(e) {
          reject(e);
        }
      }));

    let err;
    let result;
    let zcaps;
    try {
      const {id: meterId} = await helpers.createMeter({
        capabilityAgent, serviceType: 'refreshing'
      });
      zcaps = await _createZcaps({
        capabilityAgent, serviceType: 'refreshing'
      });
      result = await helpers.createConfig({
        capabilityAgent, meterId, servicePath: '/refreshables',
        options: {
          id: configId,
          zcaps
        }
      });
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

    // wait for refresh promise to resolve
    const record = await configRefreshPromise;
    record.config.id.should.equal(configId);
    record.config.sequence.should.equal(1);
    record.meta.refresh.enabled.should.equal(true);
    record.meta.refresh.after.should.equal(expectedAfter);

    // ensure zcaps did not change
    for(const [key, value] of Object.entries(zcaps)) {
      record.config.zcaps[key].should.deep.equal(value);
    }
  });
  it('should not refresh zcaps with new invalid ones', async () => {
    const secret = crypto.randomUUID();
    const handle = 'test';
    const capabilityAgent = await CapabilityAgent.fromSecret({secret, handle});

    mockData.zcapRefreshPolicyRouteListeners.set(capabilityAgent.id, async ({
      res
    }) => {
      res.json({
        policy: {
          refresh: {
            // no constraints
            constraints: {}
          }
        }
      });
    });
    mockData.zcapRefreshRouteListeners.set(capabilityAgent.id, async ({
      req, res
    }) => {
      const oldZcap = req.body;
      const newZcap = await helpers.delegate({
        capability: oldZcap.parentCapability,
        allowedActions: oldZcap.allowedAction,
        controller: oldZcap.controller,
        invocationTarget: oldZcap.invocationTarget,
        delegator: capabilityAgent
      });
      // make new zcap invalid
      delete newZcap['@context'];
      res.json(newZcap);
    });

    // function to be called when refreshing the created config
    const expectedAfter = Date.now() + 987654321;
    const configId = `${mockData.baseUrl}/refreshables/${crypto.randomUUID()}`;
    const configRefreshPromise = new Promise((resolve, reject) =>
      mockData.refreshHandlerListeners.set(configId, async ({
        record, signal
      }) => {
        try {
          const now = Date.now();
          const later = now + 1000 * 60 * 5;
          const result = await refreshZcaps({
            serviceType: 'refreshing', config: record.config, signal
          });
          result.refresh.enabled.should.equal(true);
          should.exist(result.config);
          result.refresh.after.should.be.gte(later);
          should.exist(result.results);
          result.results.length.should.equal(4);
          result.results[0].refreshed.should.equal(false);
          result.results[1].refreshed.should.equal(false);
          result.results[2].refreshed.should.equal(false);
          result.results[3].refreshed.should.equal(false);
          result.results[0].error.name.should.equal('ValidationError');
          result.results[1].error.name.should.equal('ValidationError');
          result.results[2].error.name.should.equal('ValidationError');
          result.results[3].error.name.should.equal('ValidationError');

          // update record
          await mockData.refreshingService.configStorage.update({
            config: {...result.config, sequence: result.config.sequence + 1},
            refresh: {
              enabled: true,
              after: expectedAfter
            }
          });
          resolve(mockData.refreshingService.configStorage.get({id: configId}));
        } catch(e) {
          reject(e);
        }
      }));

    let err;
    let result;
    let zcaps;
    try {
      const {id: meterId} = await helpers.createMeter({
        capabilityAgent, serviceType: 'refreshing'
      });
      zcaps = await _createZcaps({
        capabilityAgent, serviceType: 'refreshing'
      });
      result = await helpers.createConfig({
        capabilityAgent, meterId, servicePath: '/refreshables',
        options: {
          id: configId,
          zcaps
        }
      });
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

    // wait for refresh promise to resolve
    const record = await configRefreshPromise;
    record.config.id.should.equal(configId);
    record.config.sequence.should.equal(1);
    record.meta.refresh.enabled.should.equal(true);
    record.meta.refresh.after.should.equal(expectedAfter);

    // ensure zcaps did not change
    for(const [key, value] of Object.entries(zcaps)) {
      record.config.zcaps[key].should.deep.equal(value);
    }
  });
  it('should refresh zcaps in a config', async () => {
    const secret = crypto.randomUUID();
    const handle = 'test';
    const capabilityAgent = await CapabilityAgent.fromSecret({secret, handle});

    mockData.zcapRefreshPolicyRouteListeners.set(capabilityAgent.id, async ({
      res
    }) => {
      res.json({
        policy: {
          refresh: {
            // no constraints
            constraints: {}
          }
        }
      });
    });
    mockData.zcapRefreshRouteListeners.set(capabilityAgent.id, async ({
      req, res
    }) => {
      const oldZcap = req.body;
      const newZcap = await helpers.delegate({
        capability: oldZcap.parentCapability,
        allowedActions: oldZcap.allowedAction,
        controller: oldZcap.controller,
        invocationTarget: oldZcap.invocationTarget,
        delegator: capabilityAgent
      });
      res.json(newZcap);
    });

    // function to be called when refreshing the created config
    let expectedAfter;
    const configId = `${mockData.baseUrl}/refreshables/${crypto.randomUUID()}`;
    const configRefreshPromise = new Promise((resolve, reject) =>
      mockData.refreshHandlerListeners.set(configId, async ({
        record, signal
      }) => {
        try {
          const now = Date.now();
          const later = now + 1000 * 60 * 5;
          const result = await refreshZcaps({
            serviceType: 'refreshing', config: record.config, signal
          });
          result.refresh.enabled.should.equal(true);
          should.exist(result.config);
          result.refresh.after.should.be.gte(later);
          should.exist(result.results);
          result.results.length.should.equal(4);
          result.results[0].refreshed.should.equal(true);
          result.results[1].refreshed.should.equal(true);
          result.results[2].refreshed.should.equal(true);
          result.results[3].refreshed.should.equal(true);
          should.not.exist(result.results[0].error);
          should.not.exist(result.results[0].error);
          should.not.exist(result.results[0].error);
          should.not.exist(result.results[0].error);

          // set expected after
          expectedAfter = result.refresh.after;

          // update record
          await mockData.refreshingService.configStorage.update({
            config: {...result.config, sequence: result.config.sequence + 1},
            refresh: {
              enabled: result.refresh.enabled,
              after: result.refresh.after
            }
          });
          resolve(mockData.refreshingService.configStorage.get({id: configId}));
        } catch(e) {
          reject(e);
        }
      }));

    let err;
    let result;
    let zcaps;
    try {
      const {id: meterId} = await helpers.createMeter({
        capabilityAgent, serviceType: 'refreshing'
      });
      zcaps = await _createZcaps({
        capabilityAgent, serviceType: 'refreshing'
      });
      result = await helpers.createConfig({
        capabilityAgent, meterId, servicePath: '/refreshables',
        options: {
          id: configId,
          zcaps
        }
      });
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

    // wait for refresh promise to resolve
    const record = await configRefreshPromise;
    record.config.id.should.equal(configId);
    record.config.sequence.should.equal(1);
    record.meta.refresh.enabled.should.equal(true);
    record.meta.refresh.after.should.equal(expectedAfter);

    // ensure zcaps changed
    for(const [key, value] of Object.entries(zcaps)) {
      record.config.zcaps[key].should.not.deep.equal(value);
    }
  });
});

async function _createZcaps({capabilityAgent, serviceType}) {
  const zcaps = {};

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
  const {baseUrl} = mockData;
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

  // delegate refresh zcap to service agent
  const refreshUrl =
    `${baseUrl}/profiles/${encodeURIComponent(capabilityAgent.id)}/zcaps` +
    `/policies/${encodeURIComponent(serviceAgent.id)}/refresh`;
  zcaps.refresh = await helpers.delegate({
    controller: serviceAgent.id,
    delegator: capabilityAgent,
    invocationTarget: refreshUrl
  });

  return zcaps;
}
