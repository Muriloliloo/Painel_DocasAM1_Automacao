"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { runYmsProviderSmoke, summarizeStages } = require("../scripts/smoke-yms-provider");

test("smoke YMS resume somente dados publicos", async () => {
  const calls = [];
  const summary = await runYmsProviderSmoke({
    async queryExecutor(request) {
      calls.push(request);
      if ("reference_date" in request.params) {
        return [{ operation_date: { value: "2026-09-28" } }];
      }
      return [
        {
          facility_id: "SSP15",
          operation_date: "2026-09-28",
          cycle_name: "AM1",
          wave_number: 1,
          process_id: "PRIVADO-1",
          route_name: "C2_AM1",
          route_resolution_status: "resolved",
          gate_out_at: "2026-09-28 07:46:11",
          latest_event_name: "gate-out",
          latest_status: "PROCESS_FINISHED",
          latest_purpose_status: "LOADING_PACKAGES_STARTED"
        },
        {
          facility_id: "SSP15",
          operation_date: "2026-09-28",
          cycle_name: "AM1",
          wave_number: 2,
          process_id: "PRIVADO-2",
          route_name: "A2_AM1",
          route_resolution_status: "resolved",
          latest_event_name: "killed",
          latest_status: "UN-LOAD_UNFINISHED",
          latest_purpose_status: "LOADING_PACKAGES_STARTED"
        }
      ];
    }
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(summary, {
    ready: true,
    source: "yms",
    rows: 2,
    operation_dates: ["2026-09-28"],
    lifecycle_stages: { dispatched: 1, terminal_exception: 1 }
  });
  assert.equal(JSON.stringify(summary).includes("PRIVADO"), false);
  assert.equal(JSON.stringify(summary).includes("C2_AM1"), false);
});

test("resumo de estagios trata ausente como unknown", () => {
  assert.deepEqual(summarizeStages([
    { lifecycle_stage: "dispatched" },
    { lifecycle_stage: "dispatched" },
    {}
  ]), { dispatched: 2, unknown: 1 });
});
