"use strict";

const { createConfig } = require("./config");
const { createGatewayServer } = require("./server");
const {
  createConfiguredYmsProvider
} = require("./providers/yms-provider-factory");

function createRuntimeGateway({
  config = createConfig(),
  ymsQueryExecutor,
  dependencies = {}
} = {}) {
  const ymsProvider = dependencies.ymsProvider || createConfiguredYmsProvider(
    config,
    { queryExecutor: ymsQueryExecutor }
  );

  return createGatewayServer(config, {
    ...dependencies,
    ymsProvider
  });
}

module.exports = {
  createRuntimeGateway
};
