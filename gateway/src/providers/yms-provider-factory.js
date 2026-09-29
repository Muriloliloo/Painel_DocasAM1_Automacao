"use strict";

const {
  createYmsProvider,
  isYmsProviderReady
} = require("./yms-provider");
const {
  createBigQueryYmsProvider,
  loadRuntimeSql,
  loadPrimaryRuntimeSql
} = require("./bigquery-yms-provider");

function createConfiguredYmsProvider(config, { queryExecutor } = {}) {
  if (config.ymsMode !== "provider") {
    return createYmsProvider(config);
  }

  return createBigQueryYmsProvider({
    queryExecutor,
    queryCacheMs: config.ymsQueryCacheMs,
    sqlLoader: config.ymsSqlProfile === "lean"
      ? loadPrimaryRuntimeSql
      : loadRuntimeSql
  });
}

module.exports = {
  createConfiguredYmsProvider,
  isYmsProviderReady
};
