"use strict";

const { createAuthProvider } = require("../src/auth");
const { createConfig } = require("../src/config");
const { ERROR_CODES, GatewayError } = require("../src/errors");

function assertProductionConfiguration(config) {
  const required = [
    [config.nodeEnv === "production", "NODE_ENV deve ser production."],
    [config.mode === "real", "GATEWAY_MODE deve ser real."],
    [config.authMode === "corporate", "AUTH_MODE deve ser corporate."],
    [config.allowedOrigins.size > 0, "PANEL_ALLOWED_ORIGIN deve conter a origem exata do painel."],
    [config.allowedUpstreamHosts.size > 0, "A allowlist de hosts upstream esta vazia."],
    [config.allowedFacilityIds.size > 0, "A allowlist de facilities esta vazia."],
    [config.allowedSiteIds.size > 0, "A allowlist de sites esta vazia."],
    [config.allowedCycles.size > 0, "A allowlist de ciclos esta vazia."],
    [config.allowedWaves.size > 0, "A allowlist de ondas esta vazia."]
  ];
  const failed = required.find(([valid]) => !valid);
  if (failed) throw new GatewayError(500, "INVALID_CONFIGURATION", failed[1]);
}

function inspectProviderConfiguration(provider) {
  if (provider?.mode !== "corporate"
      || typeof provider.inspectConfiguration !== "function"
      || typeof provider.getAuthContext !== "function") {
    throw new GatewayError(500, "INVALID_CONFIGURATION", "Provider corporativo possui estrutura invalida.");
  }

  const status = provider.inspectConfiguration();
  if (!status || typeof status !== "object" || status.mode !== "corporate"
      || typeof status.configured !== "boolean" || status instanceof Promise) {
    throw new GatewayError(500, "INVALID_CONFIGURATION", "Inspecao estrutural do provider e invalida.");
  }
  if (!status.configured) {
    throw new GatewayError(
      503,
      ERROR_CODES.AUTH_NOT_CONFIGURED,
      "A autenticacao corporativa oficial ainda nao foi configurada."
    );
  }
  return status;
}

function runPreflight({ env = process.env, providerFactory = createAuthProvider, logger = console } = {}) {
  try {
    const config = createConfig(env);
    assertProductionConfiguration(config);

    inspectProviderConfiguration(providerFactory(config));
    logger.log("Preflight corporativo aprovado: configuracao estrutural do provider esta pronta.");
    return 0;
  } catch (error) {
    const code = error instanceof GatewayError ? error.code : "PREFLIGHT_FAILED";
    const message = error instanceof GatewayError ? error.message : "Falha segura no preflight corporativo.";
    logger.error(`${code}: ${message}`);
    return code === ERROR_CODES.AUTH_NOT_CONFIGURED ? 2 : 1;
  }
}

if (require.main === module) {
  process.exitCode = runPreflight();
}

module.exports = { assertProductionConfiguration, inspectProviderConfiguration, runPreflight };
