"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createConfig } = require("../src/config");
const { createRuntimeGateway } = require("../src/runtime-gateway");

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve("http://127.0.0.1:" + address.port);
    });
  });
}

function close(server) {
  return new Promise(resolve => server.close(resolve));
}

test("runtime injeta executor BigQuery e deixa endpoint YMS pronto", async () => {
  const calls = [];
  const config = createConfig({}, {
    mode: "mock",
    nodeEnv: "development",
    ymsMode: "provider",
    port: 0,
    allowedOrigins: ["http://localhost:8000"],
    allowedFacilityIds: ["SSP15"],
    allowedSiteIds: ["MLB"],
    allowedGroupIds: ["TESTE"],
    allowedCycles: ["AM1"],
    allowedWaves: ["1", "2", "3", "4", "5"]
  });

  const server = createRuntimeGateway({
    config,
    async ymsQueryExecutor(request) {
      calls.push(request);

      if ("reference_date" in request.params) {
        return [{ operation_date: { value: "2026-09-28" } }];
      }

      return [{
        facility_id: "SSP15",
        operation_date: request.params.operation_date,
        cycle_name: "AM1",
        wave_number: 1,
        process_id: "PROCESSO-PRIVADO",
        route_name: "C2_AM1",
        route_resolution_status: "resolved",
        carrier_name: "TRANSPORTADORA TESTE",
        plate: "TESTE123",
        loading_zone_name: "52",
        gate_out_at: "2026-09-28 07:46:11",
        latest_event_name: "gate-out",
        latest_status: "PROCESS_FINISHED",
        latest_purpose_status: "LOADING_PACKAGES_STARTED",
        latest_event_at: "2026-09-28 07:46:11"
      }];
    }
  });

  const baseUrl = await listen(server);

  try {
    const ready = await fetch(baseUrl + "/ready");
    const readyBody = await ready.json();

    assert.equal(ready.status, 200);
    assert.equal(readyBody.ready, true);

    const response = await fetch(
      baseUrl
        + "/yms?facilityId=SSP15&siteId=MLB&groupId=TESTE"
        + "&cycle=AM1&timezone=America%2FSao_Paulo&waves=1%2C2%2C3%2C4%2C5"
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.snapshotComplete, true);
    assert.equal(body.sources.yms, "ok");
    assert.equal(body.yms.length, 1);
    assert.equal(body.yms[0].route_name, "C2_AM1");
    assert.equal(body.yms[0].lifecycle_stage, "dispatched");

    const serialized = JSON.stringify(body);
    assert.equal(serialized.includes("PROCESSO-PRIVADO"), false);

    assert.equal(calls.length, 2);
    assert.equal(calls[1].params.operation_date, "2026-09-28");
    assert.deepEqual(calls[1].params.wave_numbers, [1, 2, 3, 4, 5]);
  } finally {
    await close(server);
  }
});
