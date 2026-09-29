"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { REQUIRED_TABLES, preflight } = require("../scripts/preflight-yms");

test("preflight YMS valida BigQuery e todas as tabelas obrigatorias", async () => {
  const calls = [];
  const checks = await preflight({
    async execute(request) {
      calls.push(request);
      return [];
    }
  });

  assert.equal(calls.length, REQUIRED_TABLES.length + 1);
  assert.equal(checks.length, REQUIRED_TABLES.length + 1);
  assert.equal(calls[0].sql, "SELECT 1 AS ok");

  for (const table of REQUIRED_TABLES) {
    assert.equal(calls.some(call => call.sql.includes("`" + table + "`")), true);
  }
});
