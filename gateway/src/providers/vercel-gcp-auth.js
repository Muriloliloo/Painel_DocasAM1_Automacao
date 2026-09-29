"use strict";

const { GatewayError } = require("../errors");

const REQUIRED_ENV = Object.freeze([
  "GCP_PROJECT_NUMBER",
  "GCP_SERVICE_ACCOUNT_EMAIL",
  "GCP_WORKLOAD_IDENTITY_POOL_ID",
  "GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID"
]);

function oidcConfiguration(env = process.env) {
  const values = Object.fromEntries(REQUIRED_ENV.map(key => [key, String(env[key] || "").trim()]));
  const presentCount = REQUIRED_ENV.filter(key => Boolean(values[key])).length;
  const configured = presentCount === REQUIRED_ENV.length;
  const partial = presentCount > 0 && !configured;

  return {
    configured,
    partial,
    ...values
  };
}

function oidcAudience(config) {
  return `//iam.googleapis.com/projects/${config.GCP_PROJECT_NUMBER}/locations/global/workloadIdentityPools/${config.GCP_WORKLOAD_IDENTITY_POOL_ID}/providers/${config.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID}`;
}

async function createVercelGcpAuthClient({
  env = process.env,
  oidcLoader,
  googleAuthLoader
} = {}) {
  const config = oidcConfiguration(env);
  if (config.partial) {
    throw new GatewayError(
      500,
      "GCP_OIDC_CONFIGURATION_INCOMPLETE",
      "Configuracao OIDC GCP incompleta."
    );
  }
  if (!config.configured) return null;

  let getVercelOidcToken;
  let ExternalAccountClient;

  try {
    const oidc = oidcLoader ? await oidcLoader() : await import("@vercel/oidc");
    const google = googleAuthLoader ? await googleAuthLoader() : require("google-auth-library");
    getVercelOidcToken = oidc.getVercelOidcToken;
    ExternalAccountClient = google.ExternalAccountClient;
  } catch {
    throw new GatewayError(
      503,
      "GCP_OIDC_CLIENT_NOT_INSTALLED",
      "Dependencias de identidade federada GCP indisponiveis no runtime."
    );
  }

  if (typeof getVercelOidcToken !== "function" || !ExternalAccountClient?.fromJSON) {
    throw new GatewayError(
      503,
      "GCP_OIDC_CLIENT_INVALID",
      "Runtime OIDC GCP invalido."
    );
  }

  const audience = oidcAudience(config);
  const authClient = ExternalAccountClient.fromJSON({
    type: "external_account",
    audience,
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    token_url: "https://sts.googleapis.com/v1/token",
    service_account_impersonation_url:
      `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${config.GCP_SERVICE_ACCOUNT_EMAIL}:generateAccessToken`,
    subject_token_supplier: {
      getSubjectToken: () => getVercelOidcToken({ audience })
    }
  });

  if (!authClient) {
    throw new GatewayError(
      503,
      "GCP_OIDC_CLIENT_INVALID",
      "Falha ao inicializar identidade federada GCP."
    );
  }

  return authClient;
}

module.exports = {
  REQUIRED_ENV,
  oidcConfiguration,
  oidcAudience,
  createVercelGcpAuthClient
};
