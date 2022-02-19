/*!
 * Copyright (c) 2019-2022 Digital Bazaar, Inc. All rights reserved.
 */
import assert from 'assert-plus';
import bedrock from 'bedrock';
import {LruCache} from '@digitalbazaar/lru-memoize';

/**
 * Each instance of this API is associated with a single EDV client and
 * performs initialization (ensures required indexes are created).
 */
export class DocumentStore {
  /**
   * Creates a `DocumentStore` interface for accessing documents stored in
   * an EDV (Encrypted Data Vault) that are associated with a particular
   * service object.
   *
   * @param {object} options - The options to use.
   * @param {object} options.serviceObjectId - The ID of the service object
   *   this storage instance is for.
   * @param {object} options.edvClient - An `EdvClient` instance to use.
   */
  constructor({serviceObjectId, edvClient} = {}) {
    assert.string(serviceObjectId, 'serviceObjectId');
    assert.object(edvClient, 'edvClient');
    this.edvClient = edvClient;
    this.serviceObjectId = serviceObjectId;
    // create cache for EDV docs
    const cfg = bedrock.config['service-agent'];
    this.cache = new LruCache(cfg.caches.document);

    // setup EDV indexes...

    // index to find by ID
    edvClient.ensureIndex({attribute: 'content.id', unique: true});
    // index to find by type
    edvClient.ensureIndex({attribute: 'content.type'});
    // index to find by `meta.type`; this index is typically only populated
    // server-side, whereas `content.type` may be populated via user input
    edvClient.ensureIndex({attribute: 'meta.type'});
  }

  /**
   * Gets a document by the ID of its content.
   *
   * @param {object} options - The options to use.
   * @param {string} options.id - The ID of the object.
   * @param {boolean} [options.useCache=true] - `true` to allow returning a
   *   cached value, `false` not to.
   *
   * @returns {Promise<object>} The EDV document for the stored object.
   */
  async get({id, useCache = true} = {}) {
    if(useCache) {
      const fn = () => this._getUncachedDoc({id});
      return this.cache.memoize({key: id, fn});
    }

    return this._getUncachedDoc({id});
  }

  /**
   * Upserts a document in EDV storage, overwriting any previous version if
   * one exists.
   *
   * @param {object} options - The options to use.
   * @param {object} options.content - The content to upsert; it will be set as
   *   the `content` of the EDV document; "content.id" must be a string.
   * @param {object} [options.meta={}] - Custom meta data to set.
   * @param {Function} [options.mutator] - A function that takes the options
   *   `({doc, content, meta})` that is called if an existing document is
   *   found and that must return the document to use to update the existing
   *   document; if not provided, the existing `content` and `meta` fields
   *   will be overwritten.
   *
   * @returns {Promise<object>} - The stored EDV document.
   */
  async upsert({content, meta = {}, mutator} = {}) {
    assert.object(content, 'content');
    assert.object(meta, 'meta');
    if(mutator !== undefined) {
      // mutator may be false or a function
      if(!(mutator === false || typeof mutator === 'function')) {
        throw new TypeError('"mutator" must be false or a function.');
      }
    }
    meta = {...meta};
    // `id` required to use `upsert`
    if(typeof content.id !== 'string') {
      throw new TypeError('"content.id" must be a string.');
    }

    // get previous document and overwrite if it exists; loop to handle
    // concurrent updates
    let result;
    while(true) {
      let doc;
      let isNew = false;
      try {
        doc = await this.get({id: content.id, useCache: false});
        if(mutator) {
          doc = await mutator({doc, content, meta});
        } else {
          // just overwrite directly
          doc.meta = meta;
          doc.content = content;
        }
      } catch(e) {
        if(e.name !== 'NotFoundError') {
          throw e;
        }
        isNew = true;
        doc = {
          id: await this.edvClient.generateId(),
          content, meta
        };
      }

      try {
        result = await this.edvClient.update({doc});
        break;
      } catch(e) {
        // see if the duplication happened because of `content.id`, if so,
        // try again
        if(e.name === 'DuplicateError' && isNew) {
          await this.get({id: content.id, useCache: false});
          // no exception, so document was created while we were trying to
          // update, so loop to try again to update the existing doc instead
          continue;
        }
        if(e.name !== 'InvalidStateError') {
          throw e;
        }
        // loop to try again
      }
    }

    // clear cache
    this.cache.delete(content.id);

    return result;
  }

  /**
   * Removes a verifiable credential identified by its ID or EDV doc ID (for
   * VCs that do not have IDs). If the credential is bundled by any other
   * credential or if the credential is a bundle and `deleteBundle=false`,
   * then an error will be thrown unless `force` is set to true.
   *
   * @param {object} options - The options to use.
   * @param {string} [options.id] - The ID of the credential.
   * @param {string} [options.docId] - The ID of the EDV document storing the
   *   credential.
   *
   * @returns {Promise<object>} - An object with `{deleted: boolean, doc}`
   *   where `deleted` is set to true if anything was deleted; `doc` is only
   *   set if the deleted document was found.
   */
  async delete({id, docId} = {}) {
    if(!(id || docId)) {
      throw new TypeError('Either "id" or "docId" must be a string.');
    }
    if(id && docId) {
      throw new Error('Only one of "id" or "docId" may be given.');
    }

    // loop to handle concurrent updates
    while(true) {
      try {
        return await this._delete({id, docId});
      } catch(e) {
        if(e.name !== 'InvalidStateError') {
          throw e;
        }
        // loop to try again
      }
    }
  }

  async _getUncachedDoc({id}) {
    const {documents: [doc]} = await this.edvClient.find({
      equals: {'content.id': id},
      limit: 1
    });
    if(!doc) {
      const err = new Error('Document not found.');
      err.name = 'NotFoundError';
      throw err;
    }
    return doc;
  }

  // called from `delete` as a helper within a concurrent ops handling loop
  async _delete({id, docId}) {
    let doc;
    try {
      if(docId) {
        // fetch doc by `docId`
        try {
          doc = await this.edvClient.get({id: docId});
          id = doc.content.id;
        } catch(e) {
          if(e.name === 'NotFoundError') {
            return {deleted: false, doc};
          }
          throw e;
        }
      }

      if(!doc) {
        // fetch doc by `content.id`
        ({documents: [doc]} = await this.edvClient.find({
          equals: {'content.id': id}
        }));
      }

      if(!doc) {
        // no doc found
        return {deleted: false, doc};
      }

      await this.edvClient.delete({doc});
      return {deleted: true, doc};
    } catch(e) {
      if(e.name === 'NotFoundError') {
        return {deleted: false, doc: undefined};
      }
      throw e;
    } finally {
      if(id) {
        // clear cache (for simplicity, this occurs even if delete failed)
        this.cache.delete(id);
      }
    }
  }
}
