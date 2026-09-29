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
    mockScenario: "operational-recovery",
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

    for (const process of ["waiting_customs", "customs_in_progress", "loading_packages"]) {
      const snapshot = await requestJson(baseUrl, `/snapshot?${query}`);
      assert.equal(snapshot.response.status, 200);
      assert.equal(snapshot.body.operacional[0]?.route_name, "G5_AM1");
      assert.equal(snapshot.body.operacional[0]?.process, process);
    }

    const failure = await requestJson(baseUrl, `/snapshot?${query}`);
    assert.equal(failure.response.status, 502);
    assert.equal(failure.body.snapshotComplete, false);
    assert.equal(failure.body.sources.dispatch, "error");

    const recovered = await requestJson(baseUrl, `/snapshot?${query}`);
    assert.equal(recovered.response.status, 200);
    assert.equal(recovered.body.operacional[0]?.process, "dispatched");

    console.log("Smoke recovery aprovado: falha temporaria preservavel e recuperacao para dispatched.");
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
}

main().catch(error => {
  console.error(`Smoke recovery falhou: ${error.message}`);
  process.exitCode = 1;
});
