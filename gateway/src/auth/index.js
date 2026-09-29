"use strict";

const { ERROR_CODES, GatewayError } = require("../errors");
const { createAuthProvider } = require("./provider");

const FORBIDDEN_UPSTREAM_HEADERS = new Set([
  "connection",
  "content-length",
  "cookie",
  "host",
  "origin",
  "referer",
  "transfer-encoding",
  "user-agent"
]);

function validatedAuthContext(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GatewayError(503, ERROR_CODES.AUTH_FAILED, "Contexto de autenticacao corporativa invalido.");
  }

  const inputHeaders = value.headers ?? {};
  if (!inputHeaders || typeof inputHeaders !== "object" || Array.isArray(inputHeaders)) {
    throw new GatewayError(503, ERROR_CODES.AUTH_FAILED, "Headers de autenticacao corporativa invalidos.");
  }

  const headers = {};
  for (const [name, headerValue] of Object.entries(inputHeaders)) {
    const normalizedName = String(name).trim().toLowerCase();
    if (!/^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(normalizedName)
        || FORBIDDEN_UPSTREAM_HEADERS.has(normalizedName)
        || typeof headerValue !== "string"
        || /[\r\n]/.test(headerValue)) {
      throw new GatewayError(503, ERROR_CODES.AUTH_FAILED, "Contexto de autenticacao corporativa invalido.");
    }
    headers[normalizedName] = headerValue;
  }

  return Object.freeze({
    headers: Object.freeze(headers),
    dispatcher: value.dispatcher
  });
}

async function getAuthContext(provider) {
  if (!provider || typeof provider.getAuthContext !== "function") {
    throw new GatewayError(503, ERROR_CODES.AUTH_NOT_CONFIGURED, "Provider de autenticacao nao configurado.");
  }

  try {
    return validatedAuthContext(await provider.getAuthContext());
  } catch (error) {
    if (error instanceof GatewayError && error.code === ERROR_CODES.AUTH_NOT_CONFIGURED) {
      throw new GatewayError(503, ERROR_CODES.AUTH_NOT_CONFIGURED, "A autenticacao corporativa oficial ainda nao foi configurada.");
    }
    throw new GatewayError(503, ERROR_CODES.AUTH_FAILED, "Falha segura na autenticacao corporativa.");
  }
}

module.exports = { createAuthProvider, getAuthContext, validatedAuthContext };
