"use strict";

const { createConfig } = require("./config");
const { createSafeLogger } = require("./logging");
const { createRuntimeGateway } = require("./runtime-gateway");
const {
  createGoogleBigQueryExecutor
} = require("./providers/google-bigquery-executor");

function createYmsQueryExecutor(config) {
  if (config.ymsMode !== "provider") return undefined;
  return createGoogleBigQueryExecutor();
}

function start() {
  const config = createConfig();
  const logger = createSafeLogger();
  const ymsQueryExecutor = createYmsQueryExecutor(config);
  const server = createRuntimeGateway({
    config,
    ymsQueryExecutor
  });

  server.listen(config.port, config.bindHost, () => {
    logger.info("Gateway seguro iniciado.", {
      host: config.bindHost,
      port: config.port,
      gatewayMode: config.mode,
      authMode: config.authMode,
      ymsMode: config.ymsMode
    });
  });

  return server;
}

if (require.main === module) {
  start();
}

module.exports = {
  createYmsQueryExecutor,
  start
};
