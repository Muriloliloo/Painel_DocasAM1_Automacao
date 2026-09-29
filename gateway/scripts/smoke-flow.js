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
    mockScenario: "operational-sequence",
    ymsMode: "disabled",
    allowedOrigins: ["http://localhost:8000"],
    allowedFacilityIds: ["SSP15"],
    allowedSiteIds: ["MLB"],
    allowedGroupIds: ["TESTE"],
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
    const query = "facilityId=SSP15&siteId=MLB&groupId=TESTE&cycle=AM1"
      + "&timezone=America%2FSao_Paulo&waves=1,2,3,4,5";

    const expected = [
      "waiting_customs",
      "customs_in_progress",
      "loading_packages",
      "dispatched"
    ];

    for (const process of expected) {
      const snapshot = await requestJson(baseUrl, `/snapshot?${query}`);
      assert.equal(snapshot.response.status, 200);
      assert.equal(snapshot.body.snapshotComplete, true);
      assert.equal(snapshot.body.operacional[0]?.route_name, "G5_AM1");
      assert.equal(snapshot.body.operacional[0]?.dock_number, 6);
      assert.equal(snapshot.body.operacional[0]?.process, process);
      assert.equal("yms" in snapshot.body, false);
    }

    const terminalSnapshot = await requestJson(baseUrl, `/snapshot?${query}`);
    assert.equal(terminalSnapshot.response.status, 200);
    assert.equal(terminalSnapshot.body.operacional[0]?.route_name, "G5_AM1");
    assert.equal(terminalSnapshot.body.operacional[0]?.process, "dispatched");

    console.log("Smoke flow aprovado: waiting_customs -> customs_in_progress -> loading_packages -> dispatched (estado final preservado).");
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
}

main().catch(error => {
  console.error(`Smoke flow falhou: ${error.message}`);
  process.exitCode = 1;
});
