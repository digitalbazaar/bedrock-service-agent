/*!
 * Copyright (c) 2018-2025 Digital Bazaar, Inc. All rights reserved.
 */
import {config} from '@bedrock/core';

export const mockData = {};

// functions used in tests
mockData.refreshHandlerListeners = new Map();
mockData.zcapRefreshRouteListeners = new Map();
mockData.zcapRefreshPolicyRouteListeners = new Map();

// mock product IDs and reverse lookup for service products
mockData.productIdMap = new Map([
  // edv service
  ['edv', 'urn:uuid:dbd15f08-ff67-11eb-893b-10bf48838a41'],
  ['urn:uuid:dbd15f08-ff67-11eb-893b-10bf48838a41', 'edv'],
  // example service
  ['example', 'urn:uuid:66aad4d0-8ac1-11ec-856f-10bf48838a41'],
  ['urn:uuid:66aad4d0-8ac1-11ec-856f-10bf48838a41', 'example'],
  // webkms service
  ['webkms', 'urn:uuid:80a82316-e8c2-11eb-9570-10bf48838a41'],
  ['urn:uuid:80a82316-e8c2-11eb-9570-10bf48838a41', 'webkms'],
  // refreshing service for testing refresh feature
  ['refreshing', 'urn:uuid:c48900f6-cb4f-4c7e-bbd6-afdc2cc4b070'],
  ['urn:uuid:c48900f6-cb4f-4c7e-bbd6-afdc2cc4b070', 'refreshing']
]);

mockData.baseUrl = config.server.baseUri;
