/*!
 * Copyright (c) 2018-2025 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import * as documentStores from './documentStores.js';
import * as serviceAgents from './serviceAgents.js';
import {metering, middleware} from '@bedrock/service-core';
import {asyncHandler} from '@bedrock/express';
import cors from 'cors';
import {createValidateMiddleware as validate} from '@bedrock/validation';

const {util: {BedrockError}} = bedrock;

bedrock.events.on('bedrock-express.configure.routes', app => {
  const {routes} = bedrock.config['service-agent'];

  // get a service agent; this is a public endpoint
  app.get(
    routes.serviceAgents,
    cors(),
    asyncHandler(async (req, res) => {
      const {serviceType} = req.params;
      const record = await serviceAgents.get({serviceType});
      // return `id` and `serviceType` only
      const {serviceAgent} = record;
      res.json({
        id: serviceAgent.id,
        serviceType: serviceAgent.serviceType
      });
    }));
});

// helper for adding HTTP routes for documents of a particular type to a
// particular instance (service object)
export function addDocumentRoutes({
  app, service,
  type, typeName, contentProperty,
  basePath, pathParam,
  createBodySchema, updateBodySchema
}) {
  const {routePrefix, serviceType} = service;
  const baseRoute = `${routePrefix}/:localId${basePath}`;
  const paramRoute = `${baseRoute}/:${pathParam}`;

  const getConfigMiddleware = middleware.createGetConfigMiddleware({service});

  /* Note: CORS is used on all endpoints. This is safe because authorization
  uses HTTP signatures + capabilities, not cookies; CSRF is not possible. */

  // store a new document
  app.options(baseRoute, cors());
  app.post(
    baseRoute,
    cors(),
    validate({bodySchema: createBodySchema}),
    getConfigMiddleware,
    middleware.authorizeServiceObjectRequest(),
    asyncHandler(async (req, res) => {
      const {config} = req.serviceObject;
      const {documentStore} = await documentStores.get({config, serviceType});

      const {id} = req.body;
      const content = {id, [contentProperty]: req.body[contentProperty]};
      const meta = {type};

      try {
        await documentStore.upsert({
          content, meta,
          async mutator() {
            // abort upsert due to duplicate
            const error = new Error('AbortError');
            error.name = 'AbortError';
            throw error;
          }
        });
      } catch(e) {
        if(e.name === 'AbortError') {
          throw new BedrockError(`Duplicate ${typeName}.`, {
            name: 'DuplicateError',
            details: {
              httpStatusCode: 409,
              public: true
            }
          });
        }
        throw e;
      }

      const location = `${config.id}${basePath}/${encodeURIComponent(id)}`;
      res.status(201).location(location).json({...content, sequence: 0});

      // meter operation usage
      metering.reportOperationUsage({req});
    }));

  // update an existing document
  app.options(paramRoute, cors());
  app.post(
    paramRoute,
    cors(),
    validate({bodySchema: updateBodySchema}),
    getConfigMiddleware,
    middleware.authorizeServiceObjectRequest(),
    asyncHandler(async (req, res) => {
      const {config} = req.serviceObject;
      const {documentStore} = await documentStores.get({config, serviceType});

      const {id, sequence} = req.body;
      const content = {id, [contentProperty]: req.body[contentProperty]};
      const meta = {type};

      try {
        await documentStore.upsert({
          content, meta,
          async mutator({doc}) {
            if(doc.meta.type !== type) {
              // wrong document type, update not allowed
              const error = new Error(
                `Existing document is not a ${typeName}.`);
              error.name = 'NotAllowedError';
              throw error;
            }

            if(doc.sequence !== (sequence - 1)) {
              // abort upsert due to out of sequence
              const error = new Error('AbortError');
              error.name = 'AbortError';
              error.actual = doc.sequence;
              throw error;
            }
            // update content and meta
            doc.content = content;
            doc.meta = meta;
            return doc;
          }
        });
      } catch(e) {
        if(e.name === 'AbortError') {
          throw new BedrockError(
            `Could not update ${typeName}; unexpected sequence.`, {
              name: 'InvalidStateError',
              details: {
                expected: sequence - 1,
                actual: e.actual,
                httpStatusCode: 409,
                public: true
              }
            });
        }
        throw e;
      }

      res.json({...content, sequence});

      // meter operation usage
      metering.reportOperationUsage({req});
    }));

  // get a stored document
  app.get(
    paramRoute,
    cors(),
    getConfigMiddleware,
    middleware.authorizeServiceObjectRequest(),
    asyncHandler(async (req, res) => {
      const {config} = req.serviceObject;
      const {documentStore} = await documentStores.get({config, serviceType});

      let doc;
      try {
        doc = await documentStore.get({id: req.params[pathParam]});
      } catch(e) {
        // document not found
        if(e.name === 'NotFoundError') {
          throw new BedrockError(`${typeName} not found.`, {
            name: 'NotFoundError',
            details: {
              httpStatusCode: 404,
              public: true
            }
          });
        }
        throw e;
      }

      // ensure `meta.type` (only set by server) matches expectations
      if(doc.meta.type !== type) {
        // invalid meta type, treat as document not found
        throw new BedrockError(`${typeName} not found.`, {
          name: 'NotFoundError',
          details: {
            httpStatusCode: 404,
            public: true
          }
        });
      }

      const result = {
        id: doc.content.id,
        [contentProperty]: doc.content[contentProperty],
        sequence: doc.sequence
      };

      res.json(result);
    }));
}
