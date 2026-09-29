"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  benchmarkDate,
  gib,
  benchmarkYmsProfiles
} = require("../scripts/benchmark-yms-profiles");

test("benchmark valida data operacional", () => {
  assert.equal(benchmarkDate("2026-09-28"), "2026-09-28");
  assert.throws(
    () => benchmarkDate("28/09/2026"),
    error => error.code === "INVALID_BENCHMARK_DATE"
  );
});

test("benchmark converte bytes para GiB", () => {
  assert.equal(gib(1024 ** 3), 1);
  assert.equal(gib(0), 0);
});

test("benchmark compara rich e lean por dry run", async () => {
  const calls = [];
  const fakeClient = {
    async createQueryJob(options) {
      calls.push(options);
      const isLean = String(options.query).includes("LEAN_MARKER");
      return [{
        metadata: {
          statistics: {
            totalBytesProcessed: isLean ? "268435456" : "1073741824",
            query: {
              cacheHit: false
            }
          }
        }
      }];
    }
  };

  const result = await benchmarkYmsProfiles({
    client: fakeClient,
    operationDate: "2026-09-28",
    richSql: "SELECT 'RICH_MARKER', @facility_id, @operation_date, @wave_numbers",
    leanSql: "SELECT 'LEAN_MARKER', @facility_id, @operation_date, @wave_numbers"
  });

  assert.equal(calls.length, 2);
  assert.equal(calls.every(call => call.dryRun === true), true);
  assert.equal(calls.every(call => call.useQueryCache === false), true);
  assert.equal(calls.every(call => call.location === "US"), true);
  assert.equal(result.rich.total_gib_processed, 1);
  assert.equal(result.lean.total_gib_processed, 0.25);
  assert.equal(result.estimated_reduction_percent, 75);
});
