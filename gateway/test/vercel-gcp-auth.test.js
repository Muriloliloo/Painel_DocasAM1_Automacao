"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  oidcConfiguration,
  oidcAudience,
  createVercelGcpAuthClient
} = require("../src/providers/vercel-gcp-auth");

const COMPLETE_ENV = Object.freeze({
  GCP_PROJECT_NUMBER: "123456789",
  GCP_SERVICE_ACCOUNT_EMAIL: "painel@example.iam.gserviceaccount.com",
  GCP_WORKLOAD_IDENTITY_POOL_ID: "vercel-pool",
  GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: "vercel-provider"
});

test("OIDC vazio preserva ADC", async () => {
  assert.deepEqual(oidcConfiguration({}), {
    configured: false,
    partial: false,
    GCP_PROJECT_NUMBER: "",
    GCP_SERVICE_ACCOUNT_EMAIL: "",
    GCP_WORKLOAD_IDENTITY_POOL_ID: "",
    GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: ""
  });
  assert.equal(await createVercelGcpAuthClient({ env: {} }), null);
});

test("OIDC parcial falha fechado", async () => {
  await assert.rejects(
    createVercelGcpAuthClient({
      env: { GCP_PROJECT_NUMBER: "123456789" }
    }),
    error => error.code === "GCP_OIDC_CONFIGURATION_INCOMPLETE"
  );
});

test("OIDC completo monta external account sem segredo permanente", async () => {
  const supplied = [];
  const configs = [];
  const fakeClient = { kind: "external-account" };

  const authClient = await createVercelGcpAuthClient({
    env: COMPLETE_ENV,
    oidcLoader: async () => ({
      async getVercelOidcToken() {
        supplied.push("token-requested");
        return "TOKEN-FICTICIO-DE-TESTE";
      }
    }),
    googleAuthLoader: async () => ({
      ExternalAccountClient: {
        fromJSON(config) {
          configs.push(config);
          return fakeClient;
        }
      }
    })
  });

  assert.equal(authClient, fakeClient);
  assert.equal(configs.length, 1);
  assert.equal(
    configs[0].audience,
    "//iam.googleapis.com/projects/123456789/locations/global/workloadIdentityPools/vercel-pool/providers/vercel-provider"
  );
  assert.equal(
    configs[0].service_account_impersonation_url,
    "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/painel@example.iam.gserviceaccount.com:generateAccessToken"
  );
  assert.equal(await configs[0].subject_token_supplier.getSubjectToken(), "TOKEN-FICTICIO-DE-TESTE");
  assert.equal(supplied.length, 1);
});

test("audience usa somente identificadores GCP", () => {
  const config = oidcConfiguration(COMPLETE_ENV);
  assert.equal(config.configured, true);
  assert.equal(config.partial, false);
  assert.equal(
    oidcAudience(config),
    "//iam.googleapis.com/projects/123456789/locations/global/workloadIdentityPools/vercel-pool/providers/vercel-provider"
  );
});
