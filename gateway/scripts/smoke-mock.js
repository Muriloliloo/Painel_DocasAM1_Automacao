"use strict";

const assert = require("node:assert/strict");
const { createConfig } = require("../src/config");
const { createGatewayServer } = require("../src/server");

async function requestJson(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Origin: "http://localhost:8000" }
  });
  return { response, body: await response.json() };
}

async function main() {
  const config = createConfig({}, {
    port: 0,
    nodeEnv: "development",
    mode: "mock",
    authMode: "unconfigured",
    mockScenario: "normal",
    allowedOrigins: ["http://localhost:8000"],
    allowedFacilityIds: ["SSP15"],
    allowedSiteIds: ["MLB"],
    allowedCycles: ["AM1"],
    allowedWaves: ["1", "2", "3", "4", "5"],
    upstreamTimeoutMs: 1000,
    mockDelayMs: 1
  });
  const server = createGatewayServer(config);

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const health = await requestJson(baseUrl, "/health");
    assert.equal(health.response.status, 200);
    assert.equal(health.body.status, "ok");

    const ready = await requestJson(baseUrl, "/ready");
    assert.equal(ready.response.status, 200);
    assert.equal(ready.body.ready, true);

    const query = "facilityId=SSP15&siteId=MLB&groupId=TESTE&cycle=AM1"
      + "&timezone=America%2FSao_Paulo&waves=1,2,3,4,5";
    const snapshot = await requestJson(baseUrl, `/snapshot?${query}`);
    assert.equal(snapshot.response.status, 200);
    assert.equal(snapshot.body.snapshotComplete, true);
    assert.equal(snapshot.body.operacional.length, 3);
    assert.equal(snapshot.body.aduana.length, 1);
    console.log("Smoke mock aprovado: health, ready e snapshot 3/1.");
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
}

main().catch(error => {
  console.error(`Smoke mock falhou: ${error.message}`);
  process.exitCode = 1;
});
