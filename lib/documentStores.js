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

const ONE_MINUTE = 1000 * 60;
const FIVE_MINUTES = ONE_MINUTE * 5;

// Note: If the service agent needs to change on a service, the service must
// be restarted to clear this cache so it does not use a stale service agent.
let DOCUMENT_STORE_CACHE;

bedrock.events.on('bedrock.init', async () => {
  const cfg = bedrock.config['service-agent'];
  if(!cfg.caches.documentStore.maxAge ||
    cfg.caches.documentStore.maxAge < ONE_MINUTE ||
    cfg.caches.documentStore.maxAge > FIVE_MINUTES) {
    throw new Error(
      'Document store cache max age must be between one and five minutes.');
  }
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

  const key = `${config.sequence}-${config.id}`;
  const fn = () => _getUncachedDocumentStore({config, serviceType, key});
  const record = await DOCUMENT_STORE_CACHE.memoize({key, fn});
  // if rotation is possible, start rotation process
  if(record.next && !record.rotating) {
    record.rotating = true;
    Promise.resolve(record.next)
      .then(() => DOCUMENT_STORE_CACHE.cache.set(key, record.next))
      .catch(() => {})
      .finally(() => delete record.next);
  }
  return record.documentStore;
}

async function _getUncachedDocumentStore({config, serviceType, key}) {
  const {serviceAgent} = await serviceAgents.get({serviceType});

  // get ephemeral signer to optimize; it is known that the ephemeral signer
  // will last at least 5 minutes which is the max lifetime for a document
  // store
  const {
    capabilityAgent, zcaps
  } = await serviceAgents.getEphemeralAgent({config, serviceAgent});
  const invocationSigner = capabilityAgent.getSigner();

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

  const documentStore = new DocumentStore(
    {serviceObjectId: config.id, edvClient});

  // return document store and flags for rotation to help prevent some cold
  // cache issues
  const record = {documentStore, next: null, rotating: false};

  // schedule potential record rotation one minute from expiration
  const cfg = bedrock.config['service-agent'];
  setTimeout(() => {
    // start creating new cache record for potential rotation; it will be
    // used if the old record is accessed prior to record expiration
    record.next = _getUncachedDocumentStore({config, serviceType, key});
  }, cfg.caches.documentStore.maxAge - ONE_MINUTE);

  return record;
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
