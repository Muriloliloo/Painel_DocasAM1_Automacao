"use strict";

const { GatewayError } = require("../errors");

function loadBigQueryClass() {
  try {
    return require("@google-cloud/bigquery").BigQuery;
  } catch {
    throw new GatewayError(
      503,
      "BIGQUERY_CLIENT_NOT_INSTALLED",
      "Cliente BigQuery nao instalado no runtime."
    );
  }
}

function parameterTypes(params = {}) {
  const types = {};

  for (const key of Object.keys(params)) {
    if (key === "wave_numbers") {
      types[key] = ["INT64"];
    } else if (key === "operation_date" || key === "reference_date") {
      types[key] = "DATE";
    } else {
      types[key] = "STRING";
    }
  }

  return types;
}

function createGoogleBigQueryExecutor({
  BigQueryClass,
  projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "",
  location = process.env.BIGQUERY_LOCATION || "",
  authClient,
  authClientFactory
} = {}) {
  const Client = BigQueryClass || loadBigQueryClass();
  let bigqueryPromise;

  async function getClient() {
    if (!bigqueryPromise) {
      bigqueryPromise = (async () => {
        const resolvedAuthClient = authClient
          || (typeof authClientFactory === "function" ? await authClientFactory() : null);

        const clientOptions = {};
        if (projectId) clientOptions.projectId = projectId;
        if (resolvedAuthClient) clientOptions.authClient = resolvedAuthClient;

        return new Client(clientOptions);
      })();
    }
    return bigqueryPromise;
  }

  return async function executeBigQuery({ sql, params, signal }) {
    if (signal?.aborted) {
      throw new GatewayError(504, "UPSTREAM_TIMEOUT", "Consulta BigQuery cancelada antes da execucao.");
    }

    if (!sql || typeof sql !== "string" || !params || typeof params !== "object") {
      throw new GatewayError(500, "YMS_QUERY_INVALID", "Consulta BigQuery invalida.");
    }

    const options = {
      query: sql,
      params,
      types: parameterTypes(params),
      useLegacySql: false
    };

    if (location) options.location = location;

    let rows;
    try {
      const bigquery = await getClient();
      [rows] = await bigquery.query(options);
    } catch {
      throw new GatewayError(
        502,
        "YMS_BIGQUERY_FAILED",
        "Falha ao consultar a fonte YMS no BigQuery."
      );
    }

    if (signal?.aborted) {
      throw new GatewayError(504, "UPSTREAM_TIMEOUT", "Consulta BigQuery excedeu o tempo permitido.");
    }

    if (!Array.isArray(rows)) {
      throw new GatewayError(502, "YMS_INVALID_RESPONSE", "Resposta BigQuery invalida.");
    }

    return rows;
  };
}

module.exports = {
  parameterTypes,
  createGoogleBigQueryExecutor
};
