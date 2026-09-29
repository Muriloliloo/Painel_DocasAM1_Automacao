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

function countStages(rows = []) {
  const stages = {};
  for (const row of rows) {
    const stage = String(row.process || "pending");
    stages[stage] = (stages[stage] || 0) + 1;
  }
  return stages;
}

async function runYmsPrimarySmoke({ queryExecutor } = {}) {
  const config = createConfig({}, {
    port: 0,
    bindHost: "127.0.0.1",
    nodeEnv: "production",
    mode: "real",
    authMode: "unconfigured",
    ymsMode: "provider",
    snapshotSourceMode: "yms-primary",
    allowedOrigins: ["https://muriloliloo.github.io"],
    allowedFacilityIds: ["SSP15"],
    allowedSiteIds: ["MLB"],
    allowedGroupIds: [],
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
    const ready = await fetch(baseUrl + "/ready", {
      headers: { Origin: "https://muriloliloo.github.io" }
    });
    const readyBody = await ready.json();
    if (!ready.ok || readyBody.ready !== true) {
      throw new Error("Gateway YMS primary nao ficou ready.");
    }

    const response = await fetch(
      baseUrl
        + "/snapshot?facilityId=SSP15&siteId=MLB"
        + "&cycle=AM1&timezone=America%2FSao_Paulo&waves=1%2C2%2C3%2C4%2C5",
      { headers: { Origin: "https://muriloliloo.github.io" } }
    );
    const body = await response.json();

    if (!response.ok
        || body.snapshotComplete !== true
        || body.sourceMode !== "yms-primary"
        || body.sources?.yms !== "ok"
        || body.sources?.dispatch !== "derived_yms"
        || body.sources?.aduana !== "derived_yms") {
      throw new Error(body.error?.code || "YMS_PRIMARY_SMOKE_FAILED");
    }

    return {
      ready: true,
      source: "yms-primary",
      operational_rows: Array.isArray(body.operacional) ? body.operacional.length : 0,
      customs_rows: Array.isArray(body.aduana) ? body.aduana.length : 0,
      yms_rows: Array.isArray(body.yms) ? body.yms.length : 0,
      operational_stages: countStages(body.operacional)
    };
  } finally {
    await close(server);
  }
}

async function main() {
  try {
    const summary = await runYmsPrimarySmoke();
    process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
  } catch (error) {
    process.stderr.write(JSON.stringify({
      ready: false,
      source: "yms-primary",
      error: {
        code: error?.code || "YMS_PRIMARY_SMOKE_FAILED",
        message: error?.message || "Falha no smoke YMS primary."
      }
    }, null, 2) + "\n");
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { runYmsPrimarySmoke, countStages };
