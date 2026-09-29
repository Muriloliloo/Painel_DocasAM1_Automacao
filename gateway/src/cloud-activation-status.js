"use strict";

const OIDC_KEYS = Object.freeze([
  "GCP_PROJECT_NUMBER",
  "GCP_SERVICE_ACCOUNT_EMAIL",
  "GCP_WORKLOAD_IDENTITY_POOL_ID",
  "GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID"
]);

function cloudActivationStatus(env = process.env) {
  const missing = OIDC_KEYS.filter(key => !String(env[key] || "").trim());
  const ymsMode = String(env.YMS_MODE || "disabled").trim().toLowerCase();
  const sourceMode = String(env.SNAPSHOT_SOURCE_MODE || "dispatch-customs").trim().toLowerCase();
  const gatewayMode = String(env.GATEWAY_MODE || "mock").trim().toLowerCase();

  return {
    oidcConfigured: missing.length === 0,
    missingOidcKeys: missing,
    gatewayMode,
    ymsMode,
    sourceMode,
    bigQueryProjectConfigured: Boolean(String(env.GOOGLE_CLOUD_PROJECT || "").trim()),
    bigQueryLocationConfigured: Boolean(String(env.BIGQUERY_LOCATION || "").trim()),
    activationRequested:
      gatewayMode === "real"
      && ymsMode === "provider"
      && sourceMode === "yms-primary"
  };
}

module.exports = {
  OIDC_KEYS,
  cloudActivationStatus
};
