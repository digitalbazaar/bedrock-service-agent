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
  },
  documentStore: {
    // one document store instance per service object; default of
    // 1000 means 1000 of the most popular service objects can stay in memory
    maxSize: 1000,
    maxAge: 5 * 60 * 1000
  },
  document: {
    // each document store instance has a cache for EDV documents; each doc is
    // at most 10 MiB, meaning 100 * 10 MiB = 1000 MiB of in memory storage
    // per document store instance -- and if the `documentStore` cache allows
    // 1000 storage instances, then that is 1000 * 1000 MiB = ~1 GiB of
    // combined cache
    maxSize: 100,
    maxAge: 5 * 60 * 1000
  }
};
