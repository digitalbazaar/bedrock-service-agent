/*!
 * Copyright (c) 2019-2022 Digital Bazaar, Inc. All rights reserved.
 */
import 'bedrock-did-context';
import 'bedrock-veres-one-context';
import 'bedrock-security-context';
import assert from 'assert-plus';
import bedrock from 'bedrock';
import brZcapStorage from 'bedrock-zcap-storage';
import {httpsAgent} from 'bedrock-https-agent';
import {didIo} from 'bedrock-did-io';
import {DocumentStore} from './DocumentStore.js';
import {EdvClient} from '@digitalbazaar/edv-client';
import {Hmac, KeyAgreementKey, KmsClient} from '@digitalbazaar/webkms-client';
import {LruCache} from '@digitalbazaar/lru-memoize';
import * as serviceAgents from './serviceAgents.js';

// load config defaults
require('./config');

let DOCUMENT_STORE_CACHE;

bedrock.events.on('bedrock.init', async () => {
  const cfg = bedrock.config['service-agent'];
  DOCUMENT_STORE_CACHE = new LruCache(cfg.caches.documentStore);
});

/**
 * Gets the `DocumentStore` instance for the given service object.
 *
 * @param {object} options - The options to use.
 * @param {object} options.serviceObjectId - The ID of the service object
 *   this storage instance is for.
 * @param {object} options.serviceType - The service type.
 *
 * @returns {Promise<DocumentStore>} The `DocumentStore` instance.
 */
export async function get({serviceObjectId, serviceType} = {}) {
  assert.string(serviceObjectId, 'serviceObjectId');
  const fn = () => _getUncachedDocumentStore(
    {serviceObjectId, serviceType});
  return DOCUMENT_STORE_CACHE.memoize({key: serviceObjectId, fn});
}

async function _getUncachedDocumentStore({serviceObjectId, serviceType}) {
  const serviceAgent = await serviceAgents.get({serviceType});
  const {id: controller} = serviceAgent;

  // create invocation signer from service agent and get zcaps for storage
  const [
    {invocationSigner},
    {capability: edvZcap},
    {capability: hmacZcap},
    {capability: kakZcap}
  ] = await Promise.all([
    _getInvocationSigner({serviceAgent}),
    brZcapStorage.zcaps.get({invoker: controller, referenceId: 'edv'}),
    brZcapStorage.zcaps.get({invoker: controller, referenceId: 'hmac'}),
    brZcapStorage.zcaps.get({invoker: controller, referenceId: 'kak'})
  ]);

  const kmsClient = new KmsClient({httpsAgent});
  const [hmac, keyAgreementKey] = await Promise.all([
    Hmac.fromCapability({capability: hmacZcap, invocationSigner, kmsClient}),
    KeyAgreementKey.fromCapability(
      {capability: kakZcap, invocationSigner, kmsClient})
  ]);

  // parse EDV ID from EDV zcap invocation target
  const index = edvZcap.invocationTarget.lastIndexOf('/documents');
  const edvId = index === -1 ?
    edvZcap.invocationTarget : edvZcap.invocationTarget.slice(0, index);

  // create `edvClient`
  const edvClient = new EdvClient({
    id: edvId,
    capability: edvZcap,
    hmac,
    httpsAgent,
    keyAgreementKey,
    keyResolver
  });

  return new DocumentStore({serviceObjectId, edvClient});
}

async function _getInvocationSigner({serviceAgent}) {
  // FIXME: implement
}

async function keyResolver({id}) {
  // support DID-based keys only
  return didIo.get({url: id});
}
