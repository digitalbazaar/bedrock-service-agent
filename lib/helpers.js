/*!
 * Copyright (c) 2022 Digital Bazaar, Inc. All rights reserved.
 */
import assert from 'assert-plus';
import {promisify} from 'node:util';
import {randomBytes} from 'node:crypto';
import {CapabilityAgent} from '@digitalbazaar/webkms-client';
import {Ed25519Signature2020} from '@digitalbazaar/ed25519-signature-2020';
import {ZcapClient} from '@digitalbazaar/ezcap';

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
