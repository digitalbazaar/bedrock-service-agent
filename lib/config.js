/*!
 * Copyright (c) 2022 Digital Bazaar, Inc. All rights reserved.
 */
import bedrock from 'bedrock';
const {config} = bedrock;

const namespace = 'service-agent';
const cfg = config[namespace] = {};

cfg.caches = {
  serviceAgent: {
    // there is likely only one service agent per process, but this does
    // not pre-allocate additional space
    maxSize: 100,
    maxAge: 5 * 60 * 1000
  }
};
