"use strict";

const {
  createYmsProvider,
  isYmsProviderReady
} = require("./yms-provider");
const {
  createBigQueryYmsProvider
} = require("./bigquery-yms-provider");

function createConfiguredYmsProvider(config, { queryExecutor } = {}) {
  if (config.ymsMode !== "provider") {
    return createYmsProvider(config);
  }

  return createBigQueryYmsProvider({
    queryExecutor,
    queryCacheMs: config.ymsQueryCacheMs
  });
}

module.exports = {
  createConfiguredYmsProvider,
  isYmsProviderReady
};
