"use strict";

const { createConfig } = require("../src/config");
const { createRuntimeGateway } = require("../src/runtime-gateway");
const { createGoogleBigQueryExecutor } = require("../src/providers/google-bigquery-executor");

async function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve("http://127.0.0.1:" + address.port);
    });
  });
}

async function close(server) {
  return new Promise(resolve => server.close(resolve));
}

function summarizeStages(rows) {
  const stages = {};
  for (const row of rows) {
    const stage = String(row.lifecycle_stage || "unknown");
    stages[stage] = (stages[stage] || 0) + 1;
  }
  return stages;
}

async function runYmsProviderSmoke({ queryExecutor } = {}) {
  const config = createConfig({}, {
    port: 0,
    bindHost: "127.0.0.1",
    nodeEnv: "development",
    mode: "mock",
    authMode: "unconfigured",
    ymsMode: "provider",
    allowedOrigins: ["http://localhost:8000"],
    allowedFacilityIds: ["SSP15"],
    allowedSiteIds: ["MLB"],
    allowedGroupIds: ["TESTE"],
    allowedCycles: ["AM1"],
    allowedWaves: ["1", "2", "3", "4", "5"],
    upstreamTimeoutMs: 30000
  });

  const server = createRuntimeGateway({
    config,
    ymsQueryExecutor: queryExecutor || createGoogleBigQueryExecutor()
  });

  const baseUrl = await listen(server);
  try {
    const ready = await fetch(baseUrl + "/ready");
    if (!ready.ok) throw new Error("Gateway YMS nao ficou ready.");

    const response = await fetch(
      baseUrl
        + "/yms?facilityId=SSP15&siteId=MLB&groupId=TESTE"
        + "&cycle=AM1&timezone=America%2FSao_Paulo&waves=1%2C2%2C3%2C4%2C5"
    );
    const body = await response.json();

    if (!response.ok || body.snapshotComplete !== true || body.sources?.yms !== "ok") {
      throw new Error(body.error?.code || "YMS_SMOKE_FAILED");
    }

    const rows = Array.isArray(body.yms) ? body.yms : [];
    const operationDates = Array.from(new Set(rows.map(row => row.operation_date).filter(Boolean)));

    return {
      ready: true,
      source: "yms",
      rows: rows.length,
      operation_dates: operationDates,
      lifecycle_stages: summarizeStages(rows)
    };
  } finally {
    await close(server);
  }
}

async function main() {
  try {
    const summary = await runYmsProviderSmoke();
    process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
  } catch (error) {
    process.stderr.write(JSON.stringify({
      ready: false,
      source: "yms",
      error: {
        code: error?.code || "YMS_SMOKE_FAILED",
        message: error?.message || "Falha no smoke YMS."
      }
    }, null, 2) + "\n");
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { runYmsProviderSmoke, summarizeStages };
