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


test("YMS reutiliza resultado dentro do TTL sem novo job BigQuery", async () => {
  const calls = [];
  let nowMs = 1000;

  const provider = createBigQueryYmsProvider({
    sqlLoader: runtimeSql,
    queryCacheMs: 45000,
    now: () => nowMs,
    async queryExecutor(request) {
      calls.push(request);
      return [{ route_name: "C2_AM1", marker: calls.length }];
    }
  });

  const options = {
    facilityId: "SSP15",
    cycle: "AM1",
    waves: [1, 2, 3, 4, 5],
    operationDate: "2026-09-29",
    timezone: "America/Sao_Paulo"
  };

  const first = await provider.query(options);
  nowMs += 30000;
  const second = await provider.query(options);

  assert.equal(calls.length, 1);
  assert.equal(first[0].marker, 1);
  assert.equal(second[0].marker, 1);

  nowMs += 20000;
  const third = await provider.query(options);

  assert.equal(calls.length, 2);
  assert.equal(third[0].marker, 2);
});

test("YMS deduplica chamadas concorrentes para a mesma operacao", async () => {
  let calls = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });

  const provider = createBigQueryYmsProvider({
    sqlLoader: runtimeSql,
    queryCacheMs: 45000,
    async queryExecutor() {
      calls += 1;
      await gate;
      return [{ route_name: "C2_AM1" }];
    }
  });

  const options = {
    facilityId: "SSP15",
    cycle: "AM1",
    waves: [1, 2, 3, 4, 5],
    operationDate: "2026-09-29",
    timezone: "America/Sao_Paulo"
  };

  const firstPromise = provider.query(options);
  const secondPromise = provider.query(options);

  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);

  release();

  const [first, second] = await Promise.all([firstPromise, secondPromise]);
  assert.deepEqual(first, [{ route_name: "C2_AM1" }]);
  assert.deepEqual(second, [{ route_name: "C2_AM1" }]);
  assert.equal(calls, 1);
});

test("YMS deduplica tambem a descoberta da data operacional", async () => {
  let auxiliaryCalls = 0;
  let mainCalls = 0;
  let releaseAuxiliary;
  const gate = new Promise(resolve => { releaseAuxiliary = resolve; });

  const provider = createBigQueryYmsProvider({
    sqlLoader: runtimeSql,
    queryCacheMs: 45000,
    async queryExecutor(request) {
      if ("reference_date" in request.params) {
        auxiliaryCalls += 1;
        await gate;
        return [{ operation_date: { value: "2026-09-29" } }];
      }
      mainCalls += 1;
      return [{ route_name: "C2_AM1" }];
    }
  });

  const options = {
    facilityId: "SSP15",
    cycle: "AM1",
    waves: [1, 2, 3, 4, 5],
    timezone: "America/Sao_Paulo"
  };

  const firstPromise = provider.query(options);
  const secondPromise = provider.query(options);

  await new Promise(resolve => setImmediate(resolve));
  assert.equal(auxiliaryCalls, 1);

  releaseAuxiliary();
  await Promise.all([firstPromise, secondPromise]);

  assert.equal(auxiliaryCalls, 1);
  assert.equal(mainCalls, 1);
});
