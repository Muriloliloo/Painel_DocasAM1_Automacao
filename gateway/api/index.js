"use strict";

const { createConfig } = require("../src/config");
const { createGatewayHandler } = require("../src/server");
const { createConfiguredYmsProvider } = require("../src/providers/yms-provider-factory");
const { createGoogleBigQueryExecutor } = require("../src/providers/google-bigquery-executor");

function createHandler() {
  const config = createConfig();
  const ymsQueryExecutor = config.ymsMode === "provider"
    ? createGoogleBigQueryExecutor()
    : undefined;
  const ymsProvider = createConfiguredYmsProvider(config, {
    queryExecutor: ymsQueryExecutor
  });
  return createGatewayHandler(config, { ymsProvider });
}

const handler = createHandler();

module.exports = handler;
