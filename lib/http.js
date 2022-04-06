/*!
 * Copyright (c) 2018-2022 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import * as serviceAgents from './serviceAgents.js';
import {asyncHandler} from '@bedrock/express';
import cors from 'cors';

bedrock.events.on('bedrock-express.configure.routes', app => {
  const cfg = bedrock.config['service-agent'];
  const {routes} = cfg;

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
