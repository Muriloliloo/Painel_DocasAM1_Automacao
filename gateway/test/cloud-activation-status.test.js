"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  OIDC_KEYS,
  cloudActivationStatus
} = require("../src/cloud-activation-status");

test("status cloud lista somente nomes de itens ausentes", () => {
  const status = cloudActivationStatus({
    GATEWAY_MODE: "mock",
    YMS_MODE: "disabled",
    SNAPSHOT_SOURCE_MODE: "dispatch-customs",
    GOOGLE_CLOUD_PROJECT: "meli-bi-data",
    BIGQUERY_LOCATION: "US"
  });

  assert.equal(status.oidcConfigured, false);
  assert.deepEqual(status.missingOidcKeys, OIDC_KEYS);
  assert.equal(status.gatewayMode, "mock");
  assert.equal(status.ymsMode, "disabled");
  assert.equal(status.sourceMode, "dispatch-customs");
  assert.equal(status.bigQueryProjectConfigured, true);
  assert.equal(status.bigQueryLocationConfigured, true);
  assert.equal(status.activationRequested, false);
});

test("status cloud reconhece configuracao pronta para ativacao", () => {
  const status = cloudActivationStatus({
    GATEWAY_MODE: "real",
    YMS_MODE: "provider",
    SNAPSHOT_SOURCE_MODE: "yms-primary",
    GOOGLE_CLOUD_PROJECT: "meli-bi-data",
    BIGQUERY_LOCATION: "US",
    GCP_PROJECT_NUMBER: "123456789",
    GCP_SERVICE_ACCOUNT_EMAIL: "painel@example.iam.gserviceaccount.com",
    GCP_WORKLOAD_IDENTITY_POOL_ID: "vercel-pool",
    GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: "vercel-provider"
  });

  assert.equal(status.oidcConfigured, true);
  assert.deepEqual(status.missingOidcKeys, []);
  assert.equal(status.activationRequested, true);
});

test("status cloud nunca devolve valores dos identificadores OIDC", () => {
  const env = {
    GCP_PROJECT_NUMBER: "123456789",
    GCP_SERVICE_ACCOUNT_EMAIL: "segredo@example.iam.gserviceaccount.com",
    GCP_WORKLOAD_IDENTITY_POOL_ID: "pool-interno",
    GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: "provider-interno"
  };
  const serialized = JSON.stringify(cloudActivationStatus(env));

  for (const value of Object.values(env)) {
    assert.equal(serialized.includes(value), false);
  }
});
