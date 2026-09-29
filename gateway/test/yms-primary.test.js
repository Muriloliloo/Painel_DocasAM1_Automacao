"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const { createConfig } = require("../src/config");
const { normalizeYmsRow } = require("../src/adapters/yms");
const { createYmsProvider } = require("../src/providers/yms-provider");
const { buildSnapshot } = require("../src/services/snapshot");
const {
  elapsedSeconds,
  dockFromLoadingZone,
  ymsToOperationalRow
} = require("../src/services/yms-operational-bridge");

test("YMS primary aceita runtime real sem auth corporativa", async () => {
  const config = createConfig({}, {
    nodeEnv: "development",
    mode: "real",
    authMode: "unconfigured",
    ymsMode: "mock",
    snapshotSourceMode: "yms-primary",
    allowedGroupIds: []
  });

  const result = await buildSnapshot({
    config,
    scenario: "normal",
    waves: ["1", "2", "3", "4", "5"],
    facilityId: "SSP15",
    groupId: "SSP15_20260929_AM1_0",
    siteId: "MLB",
    cycle: "AM1",
    timezone: "America/Sao_Paulo",
    dependencies: {
      ymsProvider: createYmsProvider(config)
    }
  });

  assert.equal(result.snapshotComplete, true);
  assert.equal(result.sourceMode, "yms-primary");
  assert.deepEqual(result.sources, {
    dispatch: "derived_yms",
    aduana: "derived_yms",
    yms: "ok"
  });
  assert.ok(result.operacional.some(row =>
    row.route_name === "VJ3_AM1" && row.process === "dispatched"
  ));
  assert.ok(result.operacional.some(row =>
    row.route_name === "N3_AM1" && row.process === "customs_in_progress"
  ));
  assert.ok(result.operacional.some(row =>
    row.route_name === "C2_AM1" && row.process === "loading_packages"
  ));
  assert.ok(result.aduana.some(row =>
    row.route_name === "N3_AM1" && row.process === "customs_in_progress"
  ));
  assert.equal(
    result.operacional.find(row => row.route_name === "VV8_AM1")?.process,
    ""
  );
});

test("ponte YMS converte somente fatos conhecidos para o painel", () => {
  const row = {
    route_name: "VR6_AM1",
    lifecycle_stage: "customs_in_progress",
    loading_zone_name: "Doca 4",
    yms_check_in_at: "2026-09-29T10:00:00Z",
    customs_started_at: "2026-09-29T10:30:00Z"
  };

  const converted = ymsToOperationalRow(row, Date.parse("2026-09-29T10:31:05Z"));
  assert.equal(converted.route_name, "VR6_AM1");
  assert.equal(converted.process, "customs_in_progress");
  assert.equal(converted.dock_number, "4");
  assert.equal(converted.start_time, 65);
  assert.equal(converted.total_elapsed_time, 1865);
  assert.equal(dockFromLoadingZone("zona 12"), "12");
  assert.equal(elapsedSeconds("", "", Date.now()), "");
});

test("normalizador YMS aceita wrappers de data do BigQuery", () => {
  const normalized = normalizeYmsRow({
    operation_date: { value: "2026-09-29" },
    latest_event_at: { value: "2026-09-29T10:31:05Z" }
  });

  assert.equal(normalized.operation_date, "2026-09-29");
  assert.equal(normalized.latest_event_at, "2026-09-29T10:31:05Z");
});
