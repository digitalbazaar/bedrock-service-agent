/*!
 * Copyright (c) 2021-2025 Digital Bazaar, Inc. All rights reserved.
 */
import * as serviceAgents from './serviceAgents.js';
import {agent} from '@bedrock/https-agent';
import {compile} from '@bedrock/validation';
import {Ed25519Signature2020} from '@digitalbazaar/ed25519-signature-2020';
import {logger} from './logger.js';
import PQueue from 'p-queue';
import {schemas} from '@bedrock/service-core';
import {ZcapClient} from '@digitalbazaar/ezcap';

// load config defaults
import './config.js';

const FIVE_MINUTES = 1000 * 60 * 5;
const ONE_DAY = 1000 * 60 * 60 * 24;
const THIRTY_DAYS = ONE_DAY * 30;
const SIX_MONTHS = THIRTY_DAYS * 6;
const DEFAULT_MAX_REFRESH_AFTER = SIX_MONTHS;
const DEFAULT_POLICY_ERROR_REFRESH_AFTER = ONE_DAY;
const DEFAULT_MAX_TTL_BEFORE_REFRESH = THIRTY_DAYS;

// allow for 5 minute clock skew delta generally
const CLOCK_SKEW_DELTA = FIVE_MINUTES;

// lazy-compile delegated zcap schema on startup
let _validateDelegatedZcap;

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
  const refreshZcap = config.zcaps?.refresh;
  if(typeof refreshZcap?.invocationTarget !== 'string') {
    // no delegated `refresh` zcap; refresh should be disabled for this config
    return {
      refresh: {enabled: false, after: 0}
    };
  }

  // get refresh policy
  let policy;
  const zcapClient = await _getZcapClient({serviceType});
  try {
    ({data: policy} = await zcapClient.read({
      url: `${refreshZcap.invocationTarget}/policy`,
      capability: refreshZcap
    }));
  } catch(error) {
    if(error.name === 'HTTPError' && error.data) {
      // dereference error from HTTP
      error = error.data;
    }
    if(error.name === 'NotFoundError' || error.name === 'NotAllowedError') {
      // explicitly no refresh policy, disable refresh
      logger.error(
        `Zcap refresh policy for service type "${serviceType}" and config ` +
        `"${config.id}" not found or not allowed; zcap refresh disabled for ` +
        `config; fix and update config to re-enable.`, {error});
      return {
        refresh: {enabled: false, after: 0},
        error
      };
    }

    logger.error(
      'Could not fetch zcap refresh policy during config record refresh for ' +
      `"${serviceType}"; trying refresh again later.`, {error});

    // error fetching refresh policy, try again later
    return {
      refresh: {
        enabled: true, after: DEFAULT_POLICY_ERROR_REFRESH_AFTER
      },
      error
    };
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
  const results = await Promise.all([...zcaps].map(
    ([key, capability]) => queue.add(async () => {
      let refreshTime = _getRefreshTime({policy, capability});
      if(now < refreshTime) {
        return {capability, refreshed: false, referenceId: key};
      }
      const result = await _refreshCapability({
        zcapClient, refreshZcap, capability, config
      });
      result.referenceId = key;
      if(result.refreshed) {
        zcaps.set(key, result.capability);
        refreshTime = _getRefreshTime({
          policy, now, capability: result.capability
        });
      }
      // pick earliest of `after` and `refreshTime`, but no less than five
      // minutes from now should another zcap refresh be attempted
      after = Math.max(now + FIVE_MINUTES, Math.min(after, refreshTime));
      return result;
    }, {signal})));

  // wait for queue to complete
  await queue.onIdle();

  signal?.throwIfAborted();

  // apply updates
  config = {...config, zcaps: Object.fromEntries(zcaps)};

  return {config, refresh: {enabled: true, after}, results};
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
  const maxTtlBeforeRefresh =
    typeof policy?.refresh?.constraints?.maxTtlBeforeRefresh === 'number' ?
      policy.refresh.constraints.maxTtlBeforeRefresh :
      DEFAULT_MAX_TTL_BEFORE_REFRESH;
  // set refresh time to the earliest possible time based on expiry time, plus
  // clock skew allowance, minus `maxTtlBeforeRefresh`
  const expiryTime = Date.parse(capability.expires);
  return expiryTime + CLOCK_SKEW_DELTA - maxTtlBeforeRefresh;
}

async function _refreshCapability({
  zcapClient, refreshZcap, capability, config
}) {
  let err;
  let newZcap;
  try {
    ({data: newZcap} = await zcapClient.write({
      capability: refreshZcap,
      json: capability
    }));
    // validate new zcap; do not replace old one if new zcap is invalid
    if(!_validateDelegatedZcap) {
      _validateDelegatedZcap = compile({schema: schemas.delegatedZcap});
    }
    const {error} = _validateDelegatedZcap(newZcap);
    if(error) {
      newZcap = undefined;
      throw error;
    }
  } catch(error) {
    if(error.name === 'HTTPError' && error.data) {
      // dereference error from HTTP
      error = error.data;
    }
    err = error;
    logger.error(
      `Could not refresh zcap "${capability.id}" in config "${config.id}".`,
      {error});
  }
  return {capability: newZcap ?? capability, refreshed: !!newZcap, error: err};
}
