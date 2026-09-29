"use strict";

const {
  loadRuntimeSql,
  loadPrimaryRuntimeSql
} = require("../src/providers/bigquery-yms-provider");
const {
  parameterTypes,
  normalizeMaximumBytesBilled
} = require("../src/providers/google-bigquery-executor");
const {
  createVercelGcpAuthClient
} = require("../src/providers/vercel-gcp-auth");
const { GatewayError } = require("../src/errors");

function benchmarkDate(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new GatewayError(
      400,
      "INVALID_BENCHMARK_DATE",
      "YMS_BENCHMARK_DATE deve usar YYYY-MM-DD."
    );
  }
  return text;
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function gib(bytes) {
  return Math.round((toNumber(bytes) / (1024 ** 3)) * 1000) / 1000;
}

async function createClient({
  BigQueryClass,
  authClientFactory = () => createVercelGcpAuthClient(),
  projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "meli-bi-data"
} = {}) {
  const BigQuery = BigQueryClass || require("@google-cloud/bigquery").BigQuery;
  const authClient = await authClientFactory();

  return new BigQuery({
    projectId,
    ...(authClient ? { authClient } : {})
  });
}

async function dryRunProfile({
  client,
  profile,
  sql,
  operationDate,
  location = process.env.BIGQUERY_LOCATION || "US",
  maximumBytesBilled = process.env.BIGQUERY_MAXIMUM_BYTES_BILLED || "10737418240"
}) {
  const params = {
    facility_id: "SSP15",
    cycle_name: "AM1",
    operation_date: benchmarkDate(operationDate),
    wave_numbers: [1, 2, 3, 4, 5]
  };

  const [job] = await client.createQueryJob({
    query: sql,
    params,
    types: parameterTypes(params),
    useLegacySql: false,
    useQueryCache: false,
    dryRun: true,
    location,
    maximumBytesBilled: normalizeMaximumBytesBilled(maximumBytesBilled)
  });

  const stats = job?.metadata?.statistics || {};
  const queryStats = stats.query || {};

  return {
    profile,
    total_bytes_processed: String(stats.totalBytesProcessed || queryStats.totalBytesProcessed || "0"),
    total_gib_processed: gib(stats.totalBytesProcessed || queryStats.totalBytesProcessed || 0),
    cache_hit: queryStats.cacheHit === true
  };
}

async function benchmarkYmsProfiles({
  client,
  operationDate = process.env.YMS_BENCHMARK_DATE,
  richSql = loadRuntimeSql(),
  leanSql = loadPrimaryRuntimeSql()
} = {}) {
  const resolvedClient = client || await createClient();
  const date = benchmarkDate(operationDate);

  const [rich, lean] = await Promise.all([
    dryRunProfile({
      client: resolvedClient,
      profile: "rich",
      sql: richSql,
      operationDate: date
    }),
    dryRunProfile({
      client: resolvedClient,
      profile: "lean",
      sql: leanSql,
      operationDate: date
    })
  ]);

  const richBytes = toNumber(rich.total_bytes_processed);
  const leanBytes = toNumber(lean.total_bytes_processed);

  return {
    operation_date: date,
    facility_id: "SSP15",
    cycle_name: "AM1",
    waves: [1, 2, 3, 4, 5],
    rich,
    lean,
    estimated_reduction_percent: richBytes > 0
      ? Math.round((1 - (leanBytes / richBytes)) * 10000) / 100
      : 0
  };
}

async function main() {
  try {
    const result = await benchmarkYmsProfiles();
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } catch (error) {
    process.stderr.write(JSON.stringify({
      ready: false,
      error: {
        code: error?.code || "YMS_BENCHMARK_FAILED",
        message: error?.message || "Falha no benchmark YMS."
      }
    }, null, 2) + "\n");
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  benchmarkDate,
  gib,
  dryRunProfile,
  benchmarkYmsProfiles,
  createClient
};
