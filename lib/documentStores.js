/*!
 * Copyright (c) 2019-2023 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import * as serviceAgents from './serviceAgents.js';
import {Hmac, KeyAgreementKey, KmsClient} from '@digitalbazaar/webkms-client';
import assert from 'assert-plus';
import {didIo} from '@bedrock/did-io';
import {DocumentStore} from './DocumentStore.js';
import {EdvClient} from '@digitalbazaar/edv-client';
import {httpClient} from '@digitalbazaar/http-client';
import {httpsAgent} from '@bedrock/https-agent';
import {LruCache} from '@digitalbazaar/lru-memoize';
import '@bedrock/did-context';
import '@bedrock/security-context';
import '@bedrock/veres-one-context';

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
  _createDocumentStoreCache();
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
  return record.documentStore;
}

// exposed for testing purposes only
export function _resetDocumentStoreCache({ttl} = {}) {
  _createDocumentStoreCache({ttl});
}

function _createDocumentStoreCache({ttl} = {}) {
  // force `updateAgeOnGet` to ensure rotation can happen
  const cfg = bedrock.config['service-agent'];
  const options = {...cfg.caches.documentStore, updateAgeOnGet: true};
  if(ttl !== undefined) {
    options.maxAge = ttl;
  }
  DOCUMENT_STORE_CACHE = new LruCache(options);
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

  // track document store and potential next record for rotation
  const record = {documentStore, next: null};

  // schedule potential cache record rotation
  record.next = new Promise(resolve => setTimeout(() => {
    // only continue if key is still in cache
    const current = DOCUMENT_STORE_CACHE.cache.get(key);
    if(!current) {
      return resolve(null);
    }
    Promise.resolve(current).then(currentRecord => {
      // only start rotation if same record is still present in the cache
      if(!(currentRecord === record &&
        current === DOCUMENT_STORE_CACHE.cache.get(key))) {
        return resolve(null);
      }

      // start rotation process
      const promise = _getUncachedDocumentStore({config, serviceType, key});
      Promise.resolve(promise)
        .then(() => {
          if(current === DOCUMENT_STORE_CACHE.cache.get(key)) {
            DOCUMENT_STORE_CACHE.cache.set(key, promise);
          }
        }).catch(() => {});
      resolve(promise);
    }).catch(() => resolve(null));
  }, DOCUMENT_STORE_CACHE.cache.maxAge));

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
