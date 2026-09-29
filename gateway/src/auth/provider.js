"use strict";

const { ERROR_CODES, GatewayError } = require("../errors");
const { createCorporateAuthProvider } = require("./corporate-provider");

function createUnconfiguredAuthProvider() {
  return Object.freeze({
    mode: "unconfigured",
    async getAuthContext() {
      throw new GatewayError(
        503,
        ERROR_CODES.AUTH_NOT_CONFIGURED,
        "A autenticacao corporativa oficial ainda nao foi configurada."
      );
    }
  });
}

function createAuthProvider(config) {
  const mode = config?.authMode || "unconfigured";
  if (mode === "corporate") return createCorporateAuthProvider();
  return createUnconfiguredAuthProvider();
}

module.exports = { createAuthProvider, createUnconfiguredAuthProvider };
