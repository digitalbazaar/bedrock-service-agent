/*!
 * Copyright (c) 2022-2025 Digital Bazaar, Inc. All rights reserved.
 */
import {config} from '@bedrock/core';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import '@bedrock/app-identity';
import '@bedrock/https-agent';
import '@bedrock/service-core';
import '@bedrock/service-agent';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

config.mocha.tests.push(path.join(__dirname, 'mocha'));

// MongoDB
config.mongodb.name = 'bedrock_service_agent_test';
config.mongodb.dropCollections.onInit = true;
config.mongodb.dropCollections.collections = [];
// drop all collections on initialization
config.mongodb.dropCollections = {};
config.mongodb.dropCollections.onInit = true;
config.mongodb.dropCollections.collections = [];

// allow self-signed certs in test framework
config['https-agent'].rejectUnauthorized = false;

// create test application identity
// ...and `ensureConfigOverride` has already been set via
// `bedrock-app-identity` so it doesn't have to be set here
config['app-identity'].seeds.services.example = {
  id: 'did:key:z6MkrH839XwPCUQ2TkA6ifehciWnEvzuQ2njc6J19fpuP5oN',
  seedMultibase: 'z1AgvAGfbairK3AV6GqbeF8gSpYZXftQsGb5DTjptgawNyn',
  serviceType: 'example'
};

// create application identity for service with refresh
config['app-identity'].seeds.services.refreshing = {
  id: 'did:key:z6MkqhgbwggDuoHeru2GSDmZN6V2oPs1vHZoXhEVJnKpDzEz',
  seedMultibase: 'z1AnLvp9wWsUe9YkGoQpvLikA1GjtuduvQGwgptu5va2mKS',
  serviceType: 'refreshing'
};

// set config storage refresh interval short for testing purposes
config['service-core'].configStorage.refresh.interval = 100;

// use local KMS for testing
config['service-agent'].kms.baseUrl = 'https://localhost:18443/kms';
