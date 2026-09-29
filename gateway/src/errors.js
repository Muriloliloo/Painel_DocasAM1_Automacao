"use strict";

const ERROR_CODES = Object.freeze({
  AUTH_NOT_CONFIGURED: "AUTH_NOT_CONFIGURED",
  AUTH_FAILED: "AUTH_FAILED",
  UPSTREAM_UNAVAILABLE: "UPSTREAM_UNAVAILABLE",
  UPSTREAM_TIMEOUT: "UPSTREAM_TIMEOUT",
  UPSTREAM_INVALID_RESPONSE: "UPSTREAM_INVALID_RESPONSE",
  UPSTREAM_HOST_NOT_ALLOWED: "UPSTREAM_HOST_NOT_ALLOWED"
});

class GatewayError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.name = "GatewayError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

module.exports = { ERROR_CODES, GatewayError };
