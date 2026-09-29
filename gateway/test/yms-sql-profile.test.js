"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createConfig } = require("../src/config");
const { createConfiguredYmsProvider } = require("../src/providers/yms-provider-factory");

async function captureSql(profile) {
  const calls = [];
  const config = createConfig({}, {
    nodeEnv: "development",
    mode: "mock",
    ymsMode: "provider",
    ymsSqlProfile: profile,
    snapshotSourceMode: "yms-primary",
    ymsQueryCacheMs: 45000
  });

  const provider = createConfiguredYmsProvider(config, {
    async queryExecutor(request) {
      calls.push(request);
      return [];
    }
  });

  await provider.query({
    facilityId: "SSP15",
    cycle: "AM1",
    waves: [1, 2, 3, 4, 5],
    operationDate: "2026-09-29",
    timezone: "America/Sao_Paulo"
  });

  return calls[0].sql;
}

test("YMS usa perfil rich por padrao", () => {
  const config = createConfig({}, {
    nodeEnv: "development",
    mode: "mock",
    ymsMode: "provider"
  });
  assert.equal(config.ymsSqlProfile, "rich");
});

test("perfil lean usa somente SQL enxuto do YMS primary", async () => {
  const sql = await captureSql("lean");

  assert.match(sql, /BT_CYCLE_SUMMARY_LM/);
  assert.match(sql, /BT_LOADING_ZONES_PROCESS_LM/);
  assert.match(sql, /BT_CYCLE_ROUTE/);
  assert.match(sql, /BT_YMS_LOADING_ZONES_EVENTS/);

  assert.doesNotMatch(sql, /BT_YMS_JOURNEY_PLANNER/);
  assert.doesNotMatch(sql, /BT_PRECHECKIN_TRACEABILITY_LM/);
  assert.doesNotMatch(sql, /BT_YMS_PLANIFICATION_OPERATIVE_LM/);
  assert.doesNotMatch(sql, /BT_SHP_MT_FACILITY_RESOURCE/);
});

test("perfil rich preserva SQL completo", async () => {
  const sql = await captureSql("rich");

  assert.match(sql, /BT_YMS_JOURNEY_PLANNER/);
  assert.match(sql, /BT_PRECHECKIN_TRACEABILITY_LM/);
  assert.match(sql, /BT_YMS_PLANIFICATION_OPERATIVE_LM/);
  assert.match(sql, /BT_SHP_MT_FACILITY_RESOURCE/);
});
