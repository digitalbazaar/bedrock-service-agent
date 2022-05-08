/*!
 * Copyright (c) 2022 Digital Bazaar, Inc. All rights reserved.
 */
import assert from 'assert-plus';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {Ed25519Signature2020} = require('@digitalbazaar/ed25519-signature-2020');
const {ZcapClient} = require('@digitalbazaar/ezcap');

import './http.js';

// load config defaults
import './config.js';

export async function delegate({
  capability, controller, expires, delegationSigner
} = {}) {
  assert.object(capability, 'capability');
  assert.string(controller, 'controller');
  assert.date(expires, 'expires');
  assert.object(delegationSigner, 'delegationSigner');

  const SuiteClass = Ed25519Signature2020;

  // FIXME: determine if / where expiration calculations should be performed
  if(!expires) {
    const defaultExpires = new Date(Date.now() + 5 * 60 * 1000);
    if(defaultExpires < new Date(capability.expires)) {
      expires = defaultExpires;
    } else {
      expires = capability.expires;
    }
  }

  const zcapClient = new ZcapClient({SuiteClass, delegationSigner});
  return zcapClient.delegate({capability, controller, expires});
}
