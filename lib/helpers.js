/*!
 * Copyright (c) 2022 Digital Bazaar, Inc. All rights reserved.
 */
import assert from 'assert-plus';
import {createRequire} from 'node:module';
import {promisify} from 'node:util';
import {randomBytes} from 'node:crypto';
const require = createRequire(import.meta.url);
const {CapabilityAgent} = require('@digitalbazaar/webkms-client');
const {Ed25519Signature2020} = require('@digitalbazaar/ed25519-signature-2020');
const {ZcapClient} = require('@digitalbazaar/ezcap');

import './http.js';

// load config defaults
import './config.js';

const randomBytesAsync = promisify(randomBytes);

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
