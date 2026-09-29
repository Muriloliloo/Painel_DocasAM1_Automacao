"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parameterTypes,
  createGoogleBigQueryExecutor
} = require("../src/providers/google-bigquery-executor");

test("executor BigQuery tipa parametros YMS corretamente", () => {
  assert.deepEqual(parameterTypes({
    facility_id: "SSP15",
    cycle_name: "AM1",
    operation_date: "2026-09-28",
    wave_numbers: [1, 2, 3, 4, 5]
  }), {
    facility_id: "STRING",
    cycle_name: "STRING",
    operation_date: "DATE",
    wave_numbers: ["INT64"]
  });

  assert.deepEqual(parameterTypes({
    facility_id: "SSP15",
    cycle_name: "AM1",
    reference_date: "2026-09-29",
    wave_numbers: [1, 2, 3, 4, 5]
  }), {
    facility_id: "STRING",
    cycle_name: "STRING",
    reference_date: "DATE",
    wave_numbers: ["INT64"]
  });
});

test("executor BigQuery usa query parametrizada e identidade do runtime", async () => {
  const clients = [];
  const calls = [];

  class FakeBigQuery {
    constructor(options) {
      clients.push(options);
    }

    async query(options) {
      calls.push(options);
      return [[{ route_name: "C2_AM1" }]];
    }
  }

  const execute = createGoogleBigQueryExecutor({
    BigQueryClass: FakeBigQuery,
    projectId: "projeto-runtime",
    location: "US"
  });

  const rows = await execute({
    sql: "SELECT @facility_id, @operation_date, @wave_numbers",
    params: {
      facility_id: "SSP15",
      operation_date: "2026-09-28",
      wave_numbers: [1, 2, 3, 4, 5]
    }
  });

  assert.deepEqual(clients, [{ projectId: "projeto-runtime" }]);
  assert.deepEqual(rows, [{ route_name: "C2_AM1" }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].useLegacySql, false);
  assert.equal(calls[0].location, "US");
  assert.deepEqual(calls[0].types, {
    facility_id: "STRING",
    operation_date: "DATE",
    wave_numbers: ["INT64"]
  });
});


test("executor BigQuery injeta authClient federado quando fornecido", async () => {
  const clients = [];
  const authClient = { kind: "federated" };

  class FakeBigQuery {
    constructor(options) {
      clients.push(options);
    }

    async query() {
      return [[]];
    }
  }

  const execute = createGoogleBigQueryExecutor({
    BigQueryClass: FakeBigQuery,
    projectId: "meli-bi-data",
    location: "US",
    authClientFactory: async () => authClient
  });

  await execute({ sql: "SELECT 1", params: {} });

  assert.equal(clients.length, 1);
  assert.equal(clients[0].projectId, "meli-bi-data");
  assert.equal(clients[0].authClient, authClient);
});

test("executor BigQuery converte falha do SDK em erro seguro", async () => {
  class FailingBigQuery {
    async query() {
      throw new Error("detalhe privado da infraestrutura");
    }
  }

  const execute = createGoogleBigQueryExecutor({
    BigQueryClass: FailingBigQuery
  });

  await assert.rejects(
    execute({
      sql: "SELECT @facility_id",
      params: { facility_id: "SSP15" }
    }),
    error => {
      assert.equal(error.code, "YMS_BIGQUERY_FAILED");
      assert.equal(error.message.includes("detalhe privado"), false);
      return true;
    }
  );
});
