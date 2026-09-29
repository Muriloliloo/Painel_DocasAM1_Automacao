"use strict";

const { createGoogleBigQueryExecutor } = require("../src/providers/google-bigquery-executor");

const REQUIRED_TABLES = Object.freeze([
  "meli-bi-data.WHOWNER.BT_CYCLE_SUMMARY_LM",
  "meli-bi-data.WHOWNER.BT_LOADING_ZONES_PROCESS_LM",
  "meli-bi-data.WHOWNER.BT_YMS_JOURNEY_PLANNER",
  "meli-bi-data.WHOWNER.BT_PRECHECKIN_TRACEABILITY_LM",
  "meli-bi-data.WHOWNER.BT_CYCLE_ROUTE",
  "meli-bi-data.WHOWNER.BT_YMS_PLANIFICATION_OPERATIVE_LM",
  "meli-bi-data.WHOWNER.BT_YMS_LOADING_ZONES_EVENTS",
  "meli-bi-data.WHOWNER.BT_SHP_MT_FACILITY_RESOURCE"
]);

async function preflight({ execute = createGoogleBigQueryExecutor() } = {}) {
  const checks = [];

  await execute({ sql: "SELECT 1 AS ok", params: {} });
  checks.push({ check: "bigquery", status: "ok" });

  for (const table of REQUIRED_TABLES) {
    await execute({
      sql: "SELECT 1 AS ok FROM `" + table + "` LIMIT 0",
      params: {}
    });
    checks.push({ check: table, status: "ok" });
  }

  return checks;
}

async function main() {
  try {
    const checks = await preflight();
    process.stdout.write(JSON.stringify({ ready: true, source: "yms", checks }, null, 2) + "\n");
  } catch (error) {
    process.stderr.write(JSON.stringify({
      ready: false,
      source: "yms",
      error: {
        code: error?.code || "YMS_PREFLIGHT_FAILED",
        message: error?.message || "Falha no preflight YMS."
      }
    }, null, 2) + "\n");
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { REQUIRED_TABLES, preflight };
