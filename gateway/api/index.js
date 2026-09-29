"use strict";

let cachedHandler = null;

function createHandler() {
  const { createConfig } = require("../src/config");
  const { createGatewayHandler } = require("../src/server");
  const { createConfiguredYmsProvider } = require("../src/providers/yms-provider-factory");

  const config = createConfig();
  const ymsQueryExecutor = config.ymsMode === "provider"
    ? require("../src/providers/google-bigquery-executor").createGoogleBigQueryExecutor()
    : undefined;
  const ymsProvider = createConfiguredYmsProvider(config, {
    queryExecutor: ymsQueryExecutor
  });

  return createGatewayHandler(config, { ymsProvider });
}

module.exports = async function serverlessGateway(request, response) {
  try {
    if (!cachedHandler) cachedHandler = createHandler();
    return await cachedHandler(request, response);
  } catch (error) {
    console.error("Gateway serverless falhou:", error);

    if (response.headersSent) {
      try { response.end(); } catch (_) {}
      return;
    }

    response.statusCode = 500;
    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.end(JSON.stringify({
      error: {
        code: "SERVERLESS_BOOTSTRAP_FAILED",
        message: error?.message || "Falha ao iniciar gateway serverless."
      }
    }));
  }
};
