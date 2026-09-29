"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createConfig, validatedBindHost } = require("../src/config");

test("bind host usa loopback por padrao", () => {
  const config = createConfig({}, {
    port: 0,
    nodeEnv: "development",
    mode: "mock",
    allowedOrigins: ["http://localhost:8000"],
    allowedGroupIds: ["TESTE"]
  });
  assert.equal(config.bindHost, "127.0.0.1");
});

test("bind host aceita exposicao controlada para container", () => {
  assert.equal(validatedBindHost("0.0.0.0"), "0.0.0.0");
  assert.equal(validatedBindHost("127.0.0.1"), "127.0.0.1");
  assert.throws(() => validatedBindHost("::"), /BIND_HOST/);
  assert.throws(() => validatedBindHost("gateway.local"), /BIND_HOST/);
});
