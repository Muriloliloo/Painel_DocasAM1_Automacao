"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createBigQueryYmsProvider
} = require("../src/providers/bigquery-yms-provider");

function runtimeSql() {
  return "SELECT @facility_id, @cycle_name, @operation_date, @wave_numbers";
}

test("YMS preserva operationDate explicita sem consulta auxiliar", async () => {
  const calls = [];
  const provider = createBigQueryYmsProvider({
    sqlLoader: runtimeSql,
    async queryExecutor(request) {
      calls.push(request);
      return [{ route_name: "C2_AM1" }];
    }
  });

  const rows = await provider.query({
    facilityId: "SSP15",
    cycle: "AM1",
    waves: [1, 2, 3, 4, 5],
    operationDate: "2026-09-28",
    timezone: "America/Sao_Paulo"
  });

  assert.deepEqual(rows, [{ route_name: "C2_AM1" }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].params.operation_date, "2026-09-28");
  assert.equal("reference_date" in calls[0].params, false);
});

test("YMS resolve automaticamente o ciclo mais recente entre D-1 e D", async () => {
  const calls = [];
  let resolvedDate;

  const provider = createBigQueryYmsProvider({
    sqlLoader: runtimeSql,
    async queryExecutor(request) {
      calls.push(request);

      if ("reference_date" in request.params) {
        const reference = new Date(request.params.reference_date + "T12:00:00Z");
        reference.setUTCDate(reference.getUTCDate() - 1);
        resolvedDate = reference.toISOString().slice(0, 10);
        return [{ operation_date: { value: resolvedDate } }];
      }

      return [{ route_name: "C2_AM1", operation_date: request.params.operation_date }];
    }
  });

  const rows = await provider.query({
    facilityId: "SSP15",
    cycle: "AM1",
    waves: ["1", "2", "3", "4", "5"],
    timezone: "America/Sao_Paulo"
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].params.facility_id, "SSP15");
  assert.equal(calls[0].params.cycle_name, "AM1");
  assert.deepEqual(calls[0].params.wave_numbers, [1, 2, 3, 4, 5]);
  assert.equal(calls[1].params.operation_date, resolvedDate);
  assert.equal(rows[0].operation_date, resolvedDate);
});

test("YMS falha fechado quando nao encontra ciclo em D nem D-1", async () => {
  const provider = createBigQueryYmsProvider({
    sqlLoader: runtimeSql,
    async queryExecutor(request) {
      if ("reference_date" in request.params) {
        return [{ operation_date: null }];
      }
      return [];
    }
  });

  await assert.rejects(
    provider.query({
      facilityId: "SSP15",
      cycle: "AM1",
      waves: [1, 2, 3, 4, 5],
      timezone: "America/Sao_Paulo"
    }),
    error => error?.code === "YMS_OPERATION_DATE_NOT_FOUND"
  );
});
