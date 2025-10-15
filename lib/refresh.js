/*!
 * Copyright (c) 2021-2025 Digital Bazaar, Inc. All rights reserved.
 */
import * as serviceAgents from './serviceAgents.js';
import {agent} from '@bedrock/https-agent';
import {Ed25519Signature2020} from '@digitalbazaar/ed25519-signature-2020';
import {logger} from './logger.js';
import PQueue from 'p-queue';
import {ZcapClient} from '@digitalbazaar/ezcap';

// load config defaults
import './config.js';

// allow for 5 minute clock skew delta generally
const CLOCK_SKEW_DELTA = 1000 * 60 * 5;
const ONE_DAY = 1000 * 60 * 60 * 24;
const THIRTY_DAYS = ONE_DAY * 30;
const SIX_MONTHS = THIRTY_DAYS * 6;
const DEFAULT_MAX_REFRESH_AFTER = SIX_MONTHS;
const DEFAULT_POLICY_ERROR_REFRESH_AFTER = ONE_DAY;
const DEFAULT_MAX_TTL_BEFORE_REFRESH = THIRTY_DAYS;

/**
 * Refreshes zcaps in the given service object configuration, if possible, and
 * returns if and when the next refresh should occur.
 *
 * @param {object} options - The options to use.
 * @param {object} options.serviceType - The service type.
 * @param {object} options.config - The service object configuration.
 * @param {object} [options.signal] - Optional signal to abort operation.
 *
 * @returns {Promise<object>} An object with a `refresh` object including
 *   whether `refresh` should be `enabled` and `after` when the next refresh
 *   should occur.
 */
export async function refreshZcaps({serviceType, config, signal} = {}) {
  // FIXME: remove
  console.log('serviceType', serviceType, 'config', config);

  const refreshZcap = config.zcaps?.refresh;
  if(!refreshZcap) {
    // no `refresh` zcap, so refresh should be disabled for this config
    return {enabled: false, after: 0};
  }

  // get refresh policy
  let policy;
  const zcapClient = await _getZcapClient({serviceType});
  try {
    policy = await zcapClient.read({
      url: `${refreshZcap.invocationTarget}/policy`,
      capability: refreshZcap
    });
  } catch(error) {
    if(error.name === 'NotFoundError' || error.name === 'NotAllowedError') {
      // explicitly no refresh policy, disable refresh
      logger.error(
        `Zcap refresh policy for service type "${serviceType}" and config ` +
        `"${config.id}" not found or not allowed; zcap refresh disabled for ` +
        `config; fix and update config to re-enable.`, {error});
      return {enabled: false, after: 0};
    }

    logger.error(
      'Could not fetch zcap refresh policy during config record refresh for '
      `"${serviceType}"; trying refresh again later.`, {error});

    // error fetching refresh policy, try again later
    return {enabled: true, after: DEFAULT_POLICY_ERROR_REFRESH_AFTER};
  }

  signal?.throwIfAborted();

  // gather all zcaps to be refreshed
  const zcaps = new Map(Object.entries(config.zcaps));

  // compute earliest `after` time for next refresh as zcaps are processed
  const now = Date.now();
  let after = now + DEFAULT_MAX_REFRESH_AFTER;

  // process each zcap efficiently in parallel
  const queue = new PQueue({
    autoStart: true,
    // maximum number of refreshes to attempt at once
    concurrency: 4,
    // one second interval
    interval: 1000,
    // maximum updates per interval (second) to avoid DoS of remote systems
    intervalCap: 60
  });
  await Promise.all([...zcaps.entries()].map(
    ([key, capability]) => queue.add(async () => {
      let refreshTime = _getRefreshTime({policy, capability});
      if(now < refreshTime) {
        return;
      }
      const result = await _refreshCapability({
        zcapClient, refreshZcap, capability, config
      });
      if(result.refreshed) {
        zcaps.set(key, result.capability);
        refreshTime = _getRefreshTime({
          policy, now, capability: result.capability
        });
      }
      after = Math.min(after, refreshTime);
    }, {signal})));

  // wait for queue to complete
  await queue.onIdle();

  signal?.throwIfAborted();

  // apply updates
  config = {...config, zcaps: Object.fromEntries(zcaps.entries())};

  return {config, refresh: {enabled: true, after}};
}

async function _getZcapClient({serviceType}) {
  const {serviceAgent} = await serviceAgents.get({serviceType});
  const invocationSigner = await serviceAgents.getInvocationSigner({
    serviceAgent
  });
  return new ZcapClient({
    agent,
    invocationSigner,
    SuiteClass: Ed25519Signature2020
  });
}

// determines refresh time based on policy and capability expiry
function _getRefreshTime({policy, capability}) {
  // determine max TTL for the zcap before refresh is allowed using policy
  // first and then falling back to default
  const maxTtlBeforeRefresh = typeof policy?.maxTtlBeforeRefresh === 'number' ?
    policy?.maxTtlBeforeRefresh : DEFAULT_MAX_TTL_BEFORE_REFRESH;
  // set refresh time to the earliest possible time based on expiry time, plus
  // clock skew allowance, minus `maxTtlBeforeRefresh`
  const expiryTime = Date.parse(capability.expires).getTime();
  return expiryTime + CLOCK_SKEW_DELTA - maxTtlBeforeRefresh;
}

async function _refreshCapability({
  zcapClient, refreshZcap, capability, config
}) {
  let newZcap;
  try {
    newZcap = await zcapClient.write({
      capability: refreshZcap,
      json: capability
    });
  } catch(error) {
    logger.error(
      `Could not refresh zcap "${capability.id}" in config "${config.id}".`,
      {error});
  }
  return {capability: newZcap ?? capability, refreshed: !!newZcap};
}
