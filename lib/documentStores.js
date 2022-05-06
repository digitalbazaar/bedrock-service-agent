/*!
 * Copyright (c) 2019-2022 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import * as serviceAgents from './serviceAgents.js';
import '@bedrock/did-context';
import '@bedrock/security-context';
import '@bedrock/veres-one-context';
import assert from 'assert-plus';
import {httpClient} from '@digitalbazaar/http-client';
import {httpsAgent} from '@bedrock/https-agent';
import {didIo} from '@bedrock/did-io';
import {DocumentStore} from './DocumentStore.js';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {EdvClient} = require('@digitalbazaar/edv-client');
const {Hmac, KeyAgreementKey, KmsClient} =
  require('@digitalbazaar/webkms-client');
const {LruCache} = require('@digitalbazaar/lru-memoize');

// load config defaults
import './config.js';

let DOCUMENT_STORE_CACHE;

bedrock.events.on('bedrock.init', async () => {
  const cfg = bedrock.config['service-agent'];
  DOCUMENT_STORE_CACHE = new LruCache(cfg.caches.documentStore);
});

/**
 * Gets the `DocumentStore` instance for the given service object config.
 *
 * @param {object} options - The options to use.
 * @param {object} options.config - The service object config.
 * @param {object} options.serviceType - The service type.
 *
 * @returns {Promise<DocumentStore>} The `DocumentStore` instance.
 */
export async function get({config, serviceType} = {}) {
  assert.object(config, 'config');
  assert.string(config.id, 'config.id');
  assert.object(config.zcaps, 'config.zcaps');
  assert.object(config.zcaps.edv, 'config.zcaps.edv');
  assert.object(config.zcaps.hmac, 'config.zcaps.hmac');
  assert.object(config.zcaps.keyAgreementKey, 'config.zcaps.keyAgreementKey');
  const fn = () => _getUncachedDocumentStore({config, serviceType});
  const key = `${config.sequence}-${config.id}`;
  return DOCUMENT_STORE_CACHE.memoize({key, fn});
}

async function _getUncachedDocumentStore({config, serviceType}) {
  const {serviceAgent} = await serviceAgents.get({serviceType});

  // create invocation signer from service agent
  const invocationSigner = await serviceAgents.getInvocationSigner(
    {serviceAgent});
  const {zcaps} = config;

  const kmsClient = new KmsClient({httpsAgent});
  const [hmac, keyAgreementKey] = await Promise.all([
    Hmac.fromCapability({capability: zcaps.hmac, invocationSigner, kmsClient}),
    KeyAgreementKey.fromCapability(
      {capability: zcaps.keyAgreementKey, invocationSigner, kmsClient})
  ]);

  // parse EDV ID from EDV zcap invocation target
  const index = zcaps.edv.invocationTarget.lastIndexOf('/documents');
  const edvId = index === -1 ?
    zcaps.edv.invocationTarget : zcaps.edv.invocationTarget.slice(0, index);

  // create `edvClient`
  const edvClient = new EdvClient({
    id: edvId,
    capability: zcaps.edv,
    invocationSigner,
    hmac,
    httpsAgent,
    keyAgreementKey,
    keyResolver
  });

  return new DocumentStore({serviceObjectId: config.id, edvClient});
}

async function keyResolver({id}) {
  // support DID-based keys only
  if(id.startsWith('did:')) {
    return didIo.get({url: id});
  }
  // support HTTP-based keys; currently a requirement for WebKMS
  const {data} = await httpClient.get(id, {agent: httpsAgent});
  return data;
}
