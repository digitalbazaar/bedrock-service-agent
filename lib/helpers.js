/*!
 * Copyright (c) 2022-2025 Digital Bazaar, Inc. All rights reserved.
 */
import assert from 'assert-plus';
import {CapabilityAgent} from '@digitalbazaar/webkms-client';
import {Ed25519Signature2020} from '@digitalbazaar/ed25519-signature-2020';
import {promisify} from 'node:util';
import {randomBytes} from 'node:crypto';
import {ZcapClient} from '@digitalbazaar/ezcap';

const randomBytesAsync = promisify(randomBytes);

// handle backwards compatibility w/old cache config options
export function coerceCacheConfig(cacheConfig) {
  // coerce `maxSize` w/o `sizeCalculation` to `max`
  if(cacheConfig.maxSize !== undefined &&
    cacheConfig.sizeCalculation === undefined) {
    cacheConfig = {...cacheConfig, max: cacheConfig.maxSize};
    delete cacheConfig.maxSize;
  }

  // coerce `maxAge` to `ttl` in `cacheConfig`
  if(cacheConfig.maxAge !== undefined) {
    cacheConfig = {...cacheConfig, ttl: cacheConfig.maxAge};
    delete cacheConfig.maxAge;
  }

  return cacheConfig;
}

export async function createCapabilityAgent() {
  const secret = await randomBytesAsync(32);
  const handle = 'primary';
  const capabilityAgent = await CapabilityAgent.fromSecret({handle, secret});
  return {capabilityAgent, secret};
}

export async function delegate({
  capability, controller, delegationSigner, maxExpires
} = {}) {
  assert.object(capability, 'capability');
  assert.string(controller, 'controller');
  assert.date(maxExpires, 'maxExpires');
  assert.object(delegationSigner, 'delegationSigner');

  const SuiteClass = Ed25519Signature2020;
  const zcapExpires = new Date(capability.expires);
  const expires = new Date(Math.min(zcapExpires, maxExpires));

  const zcapClient = new ZcapClient({SuiteClass, delegationSigner});
  return zcapClient.delegate({capability, controller, expires});
}
