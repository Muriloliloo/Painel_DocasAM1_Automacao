"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { after, before, test } = require("node:test");
const { createConfig } = require("../src/config");
const { createGatewayServer, validateRequestTarget } = require("../src/server");
const { createAuthProvider, getAuthContext } = require("../src/auth");
const { normalizeCustomsRow } = require("../src/adapters/customs");
const { classifyLifecycleStage, normalizeYmsRow } = require("../src/adapters/yms");
const { createUpstreamClient } = require("../src/http/upstream-client");
const { createSafeLogger } = require("../src/logging");
const { runPreflight } = require("../scripts/preflight-corporate");
const { buildDispatchSnapshot, buildCustomsSnapshot } = require("../src/services/snapshot");
const { buildSourceComparison, dockComparison } = require("../src/services/source-comparison");
const { sanitizeDispatch } = require("../src/sanitizers/dispatch");
const { sanitizeCustoms } = require("../src/sanitizers/customs");
const { sanitizeYms } = require("../src/sanitizers/yms");
const { createBigQueryYmsProvider, validateWaveNumbers, currentDateInTimeZone } = require("../src/providers/bigquery-yms-provider");

let server;
let baseUrl;

function testConfig(overrides = {}) {
  return createConfig({}, {
    port: 0,
    nodeEnv: "development",
    mode: "mock",
    authMode: "unconfigured",
    mockScenario: "normal",
    allowedOrigins: ["http://localhost:8000"],
    allowedFacilityIds: ["SSP15"],
    allowedSiteIds: ["MLB"],
    allowedGroupIds: ["TESTE"],
    allowedCycles: ["AM1"],
    allowedWaves: ["1", "2", "3", "4", "5"],
    upstreamTimeoutMs: 80,
    mockDelayMs: 1,
    mockTimeoutDelayMs: 200,
    ...overrides
  });
}

function query(extra = "") {
  const base = "facilityId=SSP15&siteId=MLB&groupId=TESTE&cycle=AM1&timezone=America%2FSao_Paulo&waves=1,2,3,4,5";
  return `${base}${extra}`;
}

async function jsonRequest(path, options) {
  const response = await fetch(`${baseUrl}${path}`, options);
  return { response, body: await response.json() };
}

async function withGateway(config, dependencies, operation) {
  const temporaryServer = createGatewayServer(config, dependencies);
  await new Promise(resolve => temporaryServer.listen(0, "127.0.0.1", resolve));
  const temporaryUrl = `http://127.0.0.1:${temporaryServer.address().port}`;
  try {
    return await operation(temporaryUrl);
  } finally {
    await new Promise(resolve => temporaryServer.close(resolve));
  }
}

function upstreamRequest(client, config, overrides = {}) {
  return client.get({
    baseUrl: config.dispatchBaseUrl,
    path: config.dispatchPath,
    query: { facilityId: "SSP15", groupId: "TESTE", siteId: "MLB", wave: "1" },
    allowedQueryKeys: ["facilityId", "groupId", "siteId", "wave"],
    authContext: { headers: {} },
    ...overrides
  });
}

before(async () => {
  server = createGatewayServer(testConfig());
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

test("G1 /health responde 200", async () => {
  const { response, body } = await jsonRequest("/health");
  assert.equal(response.status, 200);
  assert.deepEqual(body, { status: "ok", gatewayMode: "mock", authMode: "unconfigured" });
});

test("G2 /snapshot normal respeita o contrato", async () => {
  const { response, body } = await jsonRequest(`/snapshot?${query()}`);
  assert.equal(response.status, 200);
  assert.equal(body.snapshotComplete, true);
  assert.equal(body.emptyConfirmed, false);
  assert.deepEqual(body.sources, { dispatch: "ok", aduana: "ok" });
  assert.ok(Array.isArray(body.operacional));
  assert.ok(Array.isArray(body.aduana));
});

test("G3 sanitizador Dispatch remove campos extras", () => {
  const result = sanitizeDispatch({
    route_name: "VT9_AM1",
    route_id: 1,
    process: "loading_packages",
    cpf: "remove",
    email: "remove",
    authorization: "remove",
    cookie: "remove",
    token: "remove",
    internal_secret: "remove"
  });
  assert.deepEqual(Object.keys(result), ["route_name", "route_id", "process", "dock_number", "start_time", "total_elapsed_time"]);
  for (const field of ["cpf", "email", "authorization", "cookie", "token", "internal_secret"]) {
    assert.equal(field in result, false);
  }
});

test("G4 sanitizador Aduana remove CPF, email e telefone", () => {
  const result = sanitizeCustoms({
    route_name: "VT9_AM1",
    cpf: "remove",
    document: "remove",
    email: "remove",
    phone: "remove",
    telefone: "remove",
    authorization: "remove",
    cookie: "remove",
    token: "remove",
    headers: "remove",
    internal_secret: "remove"
  });
  for (const field of ["cpf", "document", "email", "phone", "telefone", "authorization", "cookie", "token", "headers", "internal_secret"]) {
    assert.equal(field in result, false);
  }
});

test("G5 sanitizador Aduana preserva 0 e string 0", () => {
  const numeric = sanitizeCustoms({ aduanaUnidades: 0, aduanaBipadas: 0 });
  const textual = sanitizeCustoms({ aduanaUnidades: "0", aduanaBipadas: "0" });
  assert.equal(numeric.aduanaUnidades, 0);
  assert.equal(numeric.aduanaBipadas, 0);
  assert.equal(textual.aduanaUnidades, "0");
  assert.equal(textual.aduanaBipadas, "0");
});

test("G6 snapshot normal e completo", async () => {
  const { body } = await jsonRequest(`/snapshot?${query()}`);
  assert.equal(body.snapshotComplete, true);
});

test("G7 vazio nao confirmado permanece protegido", async () => {
  const { body } = await jsonRequest(`/snapshot?${query("&scenario=empty-unconfirmed")}`);
  assert.equal(body.emptyConfirmed, false);
  assert.deepEqual(body.operacional, []);
  assert.deepEqual(body.aduana, []);
});

test("G8 vazio confirmado exige cenario explicito", async () => {
  const { body } = await jsonRequest(`/snapshot?${query("&scenario=empty-confirmed")}`);
  assert.equal(body.snapshotComplete, true);
  assert.equal(body.emptyConfirmed, true);
});

test("G9 falha Dispatch nao retorna snapshot completo", async () => {
  const { response, body } = await jsonRequest(`/snapshot?${query("&scenario=failure-dispatch")}`);
  assert.equal(response.status, 502);
  assert.equal(body.snapshotComplete, false);
  assert.equal(body.sources.dispatch, "error");
});

test("G10 falha Aduana nao retorna snapshot completo", async () => {
  const { response, body } = await jsonRequest(`/snapshot?${query("&scenario=failure-customs")}`);
  assert.equal(response.status, 502);
  assert.equal(body.snapshotComplete, false);
  assert.equal(body.sources.aduana, "error");
});

test("G11 CORS aceita localhost configurado", async () => {
  const response = await fetch(`${baseUrl}/health`, { headers: { Origin: "http://localhost:8000" } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:8000");
  const serverToServer = await fetch(`${baseUrl}/health`);
  assert.equal(serverToServer.status, 200);
  assert.equal(serverToServer.headers.get("access-control-allow-origin"), null);
});

test("G12 CORS rejeita origem nao autorizada", async () => {
  const { response, body } = await jsonRequest("/health", { headers: { Origin: "https://nao-autorizado.example" } });
  assert.equal(response.status, 403);
  assert.equal(body.error.code, "ORIGIN_NOT_ALLOWED");
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  const cloudMock = createConfig({ NODE_ENV: "production", GATEWAY_MODE: "mock" });
  assert.deepEqual([...cloudMock.allowedOrigins], ["https://muriloliloo.github.io"]);
  assert.throws(
    () => createConfig({ NODE_ENV: "production", GATEWAY_MODE: "mock", PANEL_ALLOWED_ORIGIN: "*" }),
    /curinga/
  );
});

test("G13 POST /snapshot nao e permitido", async () => {
  const { response, body } = await jsonRequest(`/snapshot?${query()}`, { method: "POST" });
  assert.equal(response.status, 405);
  assert.equal(body.error.code, "METHOD_NOT_ALLOWED");
});

test("G14 parametros invalidos sao rejeitados", async () => {
  const { response, body } = await jsonRequest(`/snapshot?${query("&targetUrl=https%3A%2F%2Finterno.example")}`);
  assert.equal(response.status, 400);
  assert.equal(body.error.code, "INVALID_QUERY");
  const excessiveWaves = Array.from({ length: 100 }, (_, index) => String(index % 5 + 1)).join(",");
  const excessive = await jsonRequest(`/snapshot?facilityId=SSP15&siteId=MLB&groupId=TESTE&cycle=AM1&timezone=America%2FSao_Paulo&waves=${excessiveWaves}`);
  assert.equal(excessive.response.status, 400);
  const giant = await jsonRequest(`/snapshot?groupId=${"A".repeat(3000)}`);
  assert.equal(giant.response.status, 414);
  for (const target of ["/../snapshot", "/%2e%2e/snapshot", "//internal.example/snapshot", "/snapshot%0d%0a"]) {
    assert.throws(() => validateRequestTarget(target));
  }
});

test("G15 timeout do mock e tratado", async () => {
  const { response, body } = await jsonRequest(`/snapshot?${query("&scenario=timeout")}`);
  assert.equal(response.status, 504);
  assert.equal(body.snapshotComplete, false);
  assert.equal(body.error.code, "UPSTREAM_TIMEOUT");
  const health = await jsonRequest("/health");
  assert.equal(health.response.status, 200);
});

test("G16 resposta nao contem nomes de campos sensiveis", async () => {
  const { body } = await jsonRequest(`/snapshot?${query()}`);
  const serialized = JSON.stringify(body).toLowerCase();
  for (const forbidden of ["authorization", "cookie", "token", "csrf", "cpf", "email", "telefone"]) {
    assert.equal(serialized.includes(forbidden), false, `campo proibido encontrado: ${forbidden}`);
  }
  for (const header of ["Authorization", "Cookie", "X-CSRF-Token"]) {
    const rejected = await jsonRequest(`/snapshot?${query()}`, { headers: { [header]: "valor-nao-secreto-de-teste" } });
    assert.equal(rejected.response.status, 400);
    assert.equal(rejected.body.error.code, "SENSITIVE_HEADER_REJECTED");
  }
});

test("G17 producao nao retorna stack interna", async () => {
  const productionServer = createGatewayServer(testConfig({ nodeEnv: "production", mode: "real" }));
  await new Promise(resolve => productionServer.listen(0, "127.0.0.1", resolve));
  const productionUrl = `http://127.0.0.1:${productionServer.address().port}`;
  try {
    const response = await fetch(`${productionUrl}/snapshot?${query()}`);
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.error.code, "AUTH_NOT_CONFIGURED");
    assert.equal("stack" in body, false);
    assert.equal(JSON.stringify(body).includes("at "), false);
  } finally {
    await new Promise(resolve => productionServer.close(resolve));
  }
});

test("A1 real com auth unconfigured falha fechado", async () => {
  let upstreamCalls = 0;
  await withGateway(testConfig({ mode: "real", authMode: "unconfigured" }), {
    fetchImpl: async () => {
      upstreamCalls += 1;
      throw new Error("fetch upstream nao deveria ser executado");
    }
  }, async url => {
    const health = await fetch(`${url}/health`);
    const healthBody = await health.json();
    assert.equal(health.status, 200);
    assert.deepEqual(healthBody, { status: "ok", gatewayMode: "real", authMode: "unconfigured" });

    const ready = await fetch(`${url}/ready`);
    assert.equal(ready.status, 503);
    assert.equal((await ready.json()).ready, false);

    const response = await fetch(`${url}/snapshot?${query()}`);
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.error.code, "AUTH_NOT_CONFIGURED");
    assert.equal(body.snapshotComplete, false);
  });
  assert.equal(upstreamCalls, 0);

  await withGateway(testConfig({ mode: "real" }), {
    authProvider: {
      async getAuthContext() {
        throw new Error("detalhe-sensivel-ficticio");
      }
    },
    upstreamClient: { async get() { return []; } }
  }, async url => {
    const response = await fetch(`${url}/snapshot?${query()}`);
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.error.code, "AUTH_FAILED");
    assert.equal(JSON.stringify(body).includes("detalhe-sensivel-ficticio"), false);
  });
});

test("A2 health nao revela segredo", async () => {
  const { response, body } = await jsonRequest("/health");
  assert.equal(response.status, 200);
  const serialized = JSON.stringify(body).toLowerCase();
  for (const forbidden of ["authorization", "cookie", "token", "secret", "password", "csrf", "credential"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("A3 frontend nao escolhe destino upstream", async () => {
  for (const parameter of ["baseUrl", "host", "url", "upstreamUrl"]) {
    const { response, body } = await jsonRequest(`/snapshot?${query(`&${parameter}=destino-nao-permitido`)}`);
    assert.equal(response.status, 400);
    assert.equal(body.error.code, "INVALID_QUERY");
  }
});

test("A4 URL upstream com usuario ou senha e rejeitada", () => {
  assert.throws(
    () => testConfig({ dispatchBaseUrl: "https://usuario:senha@envios.adminml.com" }),
    /usuario ou senha/
  );
  assert.throws(
    () => testConfig({ dispatchBaseUrl: "https://nao-autorizado.example" }),
    error => error.code === "UPSTREAM_HOST_NOT_ALLOWED"
  );
  assert.throws(
    () => testConfig({ dispatchPath: "/logistics/../destino" }),
    /caminho nao autorizado/
  );
});

test("A5 HTTP upstream inseguro e rejeitado em production", () => {
  assert.throws(
    () => testConfig({ nodeEnv: "production", dispatchBaseUrl: "http://envios.adminml.com" }),
    /HTTPS em production/
  );
  assert.throws(
    () => testConfig({ dispatchBaseUrl: "file:///destino" }),
    /protocolo HTTP\(S\)/
  );
});

test("A6 redirect upstream para outro host e rejeitado", async () => {
  const config = testConfig();
  const client = createUpstreamClient({
    config,
    fetchImpl: async () => new Response(null, {
      status: 302,
      headers: { location: "https://nao-autorizado.example/redirect" }
    })
  });
  await assert.rejects(
    upstreamRequest(client, config),
    error => error.code === "UPSTREAM_HOST_NOT_ALLOWED"
  );
});

test("A7 headers do navegador nao sao encaminhados aos adaptadores reais", async () => {
  const calls = [];
  const dependencies = {
    authProvider: {
      async getAuthContext() {
        return { headers: { "x-official-test": "contexto-ficticio" } };
      }
    },
    upstreamClient: {
      async get(request) {
        calls.push(request);
        return [];
      }
    }
  };

  await withGateway(testConfig({ mode: "real" }), dependencies, async url => {
    const response = await fetch(`${url}/snapshot?${query()}`, {
      headers: { "X-Browser-Trace": "nao-encaminhar" }
    });
    assert.equal(response.status, 200);
  });

  assert.ok(calls.length >= 2);
  assert.equal(JSON.stringify(calls).includes("X-Browser-Trace"), false);
  assert.equal(JSON.stringify(calls).includes("nao-encaminhar"), false);

  const config = testConfig();
  let sentOptions;
  const client = createUpstreamClient({
    config,
    fetchImpl: async (_url, options) => {
      sentOptions = options;
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  await upstreamRequest(client, config, {
    authContext: { headers: { "x-official-test": "contexto-ficticio" } }
  });
  assert.deepEqual(Object.keys(sentOptions.headers).sort(), ["accept", "user-agent", "x-official-test"]);
  assert.equal(sentOptions.method, "GET");
  assert.equal(sentOptions.credentials, "omit");
  assert.equal(sentOptions.redirect, "manual");
});

test("A8 Authorization e Cookie recebidos do cliente continuam rejeitados", async () => {
  for (const header of ["Authorization", "Cookie", "X-CSRF-Token"]) {
    const { response, body } = await jsonRequest(`/snapshot?${query()}`, {
      headers: { [header]: "valor-ficticio-rejeitado" }
    });
    assert.equal(response.status, 400);
    assert.equal(body.error.code, "SENSITIVE_HEADER_REJECTED");
  }
});

test("A9 logger mascara valores sensiveis", () => {
  const calls = [];
  const logger = createSafeLogger({ info: (...values) => calls.push(values) });
  logger.info("evento", {
    authorization: "segredo-authorization",
    nested: {
      api_key: "segredo-api-key",
      clientSecret: "segredo-client-secret",
      safe: "valor-publico"
    }
  });
  const serialized = JSON.stringify(calls);
  assert.equal(serialized.includes("segredo-authorization"), false);
  assert.equal(serialized.includes("segredo-api-key"), false);
  assert.equal(serialized.includes("segredo-client-secret"), false);
  assert.equal(serialized.includes("valor-publico"), true);
  assert.equal(serialized.includes("[REDACTED]"), true);
});

test("A10 resposta upstream acima do limite e rejeitada", async () => {
  const config = testConfig({ maxResponseBytes: 64 });
  const client = createUpstreamClient({
    config,
    fetchImpl: async () => new Response(JSON.stringify({ data: "x".repeat(256) }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })
  });
  await assert.rejects(
    upstreamRequest(client, config),
    error => error.code === "UPSTREAM_INVALID_RESPONSE" && /limite/.test(error.message)
  );
});

test("A11 timeout do cliente upstream e controlado", async () => {
  const config = testConfig({ upstreamTimeoutMs: 10 });
  const client = createUpstreamClient({
    config,
    fetchImpl: async (_url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("abortado")), { once: true });
    })
  });
  await assert.rejects(
    upstreamRequest(client, config),
    error => error.code === "UPSTREAM_TIMEOUT" && error.status === 504
  );
});

test("A12 resposta upstream invalida falha fechado", async () => {
  const config = testConfig();
  const invalidJsonClient = createUpstreamClient({
    config,
    fetchImpl: async () => new Response("nao-json", {
      status: 200,
      headers: { "content-type": "application/json" }
    })
  });
  await assert.rejects(
    upstreamRequest(invalidJsonClient, config),
    error => error.code === "UPSTREAM_INVALID_RESPONSE"
  );

  const invalidTypeClient = createUpstreamClient({
    config,
    fetchImpl: async () => new Response("[]", {
      status: 200,
      headers: { "content-type": "text/plain" }
    })
  });
  await assert.rejects(
    upstreamRequest(invalidTypeClient, config),
    error => error.code === "UPSTREAM_INVALID_RESPONSE"
  );
});

test("A13 sanitizacao Dispatch permanece por allowlist", () => {
  const result = sanitizeDispatch({
    route_name: "TESTE1_AM1",
    route_id: 123,
    process: "loading_packages",
    cookie: "remover"
  });
  assert.deepEqual(Object.keys(result), ["route_name", "route_id", "process", "dock_number", "start_time", "total_elapsed_time"]);
  assert.equal("cookie" in result, false);
});

test("A14 sanitizacao Aduana permanece por allowlist", () => {
  const result = sanitizeCustoms({
    route_name: "TESTE1_AM1",
    route_id: 123,
    status: "in_progress",
    cpf: "remover",
    email: "remover"
  });
  assert.deepEqual(Object.keys(result), [
    "route_name", "route_id", "status", "process", "operator_name", "audit_time",
    "aduanaUnidades", "aduanaBipadas", "driver_name", "carrier_name", "plate"
  ]);
  assert.equal("cpf" in result, false);
  assert.equal("email" in result, false);
});

test("A15 modo mock permanece compativel com o frontend atual", async () => {
  const ready = await jsonRequest("/ready");
  assert.equal(ready.response.status, 200);
  assert.deepEqual(ready.body, { ready: true, gatewayMode: "mock", authMode: "unconfigured" });

  const { response, body } = await jsonRequest(`/snapshot?${query()}`);
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(body), ["snapshotComplete", "emptyConfirmed", "sources", "operacional", "aduana"]);
  assert.equal(body.snapshotComplete, true);
  assert.equal(body.emptyConfirmed, false);
  assert.equal(body.operacional.some(row => row.route_name === "VT9_AM1" && row.route_id === 502731583001), true);
  assert.equal(body.aduana.some(row => row.route_name === "VJ3_AM1" && row.route_id === 502731583004), true);

  let upstreamCalls = 0;
  await withGateway(testConfig(), {
    fetchImpl: async () => {
      upstreamCalls += 1;
      throw new Error("fetch upstream nao deveria ser executado");
    }
  }, async url => {
    const mockResponse = await fetch(`${url}/snapshot?${query()}`);
    assert.equal(mockResponse.status, 200);
  });
  assert.equal(upstreamCalls, 0);
});

test("T1 corporate stub falha fechado sem chamada upstream", async () => {
  const config = testConfig({ mode: "real", authMode: "corporate" });
  const provider = createAuthProvider(config);
  assert.equal(provider.mode, "corporate");
  assert.deepEqual(provider.inspectConfiguration(), {
    configured: false,
    mode: "corporate",
    reason: "AUTH_NOT_CONFIGURED"
  });
  await assert.rejects(
    getAuthContext(provider),
    error => error.code === "AUTH_NOT_CONFIGURED" && error.status === 503
  );

  let upstreamCalls = 0;
  await withGateway(config, {
    upstreamClient: {
      async get() {
        upstreamCalls += 1;
        return [];
      }
    }
  }, async url => {
    const health = await fetch(`${url}/health`);
    assert.equal(health.status, 200);

    const ready = await fetch(`${url}/ready`);
    assert.equal(ready.status, 503);
    assert.equal((await ready.json()).ready, false);

    const snapshot = await fetch(`${url}/snapshot?${query()}`);
    const body = await snapshot.json();
    assert.equal(snapshot.status, 503);
    assert.equal(body.error.code, "AUTH_NOT_CONFIGURED");
  });
  assert.equal(upstreamCalls, 0);
});

test("T2 provider fake valido passa pelo contrato sem expor valor em logs", async () => {
  const fictionalValue = "VALOR-FICTICIO-DE-TESTE";
  const context = await getAuthContext({
    async getAuthContext() {
      return { headers: { authorization: fictionalValue } };
    }
  });
  assert.equal(context.headers.authorization, fictionalValue);

  const calls = [];
  const logger = createSafeLogger({ info: (...values) => calls.push(values) });
  logger.info("provider-validado", { headers: context.headers });
  const logged = JSON.stringify(calls);
  assert.equal(logged.includes(fictionalValue), false);
  assert.equal(logged.includes("[REDACTED]"), true);
});

test("T3 header com CRLF e rejeitado", async () => {
  await assert.rejects(
    getAuthContext({ async getAuthContext() { return { headers: { authorization: "teste\r\ninjetado" } }; } }),
    error => error.code === "AUTH_FAILED"
  );
});

test("T4 Cookie e rejeitado no contexto corporativo", async () => {
  await assert.rejects(
    getAuthContext({ async getAuthContext() { return { headers: { cookie: "VALOR-FICTICIO" } }; } }),
    error => error.code === "AUTH_FAILED"
  );
});

test("T5 Host e rejeitado no contexto corporativo", async () => {
  await assert.rejects(
    getAuthContext({ async getAuthContext() { return { headers: { host: "destino.example" } }; } }),
    error => error.code === "AUTH_FAILED"
  );
});

test("T6 Origin e rejeitado no contexto corporativo", async () => {
  await assert.rejects(
    getAuthContext({ async getAuthContext() { return { headers: { origin: "https://painel.example" } }; } }),
    error => error.code === "AUTH_FAILED"
  );
});

test("T7 contexto corporativo invalido resulta em AUTH_FAILED", async () => {
  for (const invalidContext of [null, [], { headers: [] }]) {
    await assert.rejects(
      getAuthContext({ async getAuthContext() { return invalidContext; } }),
      error => error.code === "AUTH_FAILED" && error.status === 503
    );
  }
});

test("T8 readiness real fica disponivel somente com contexto corporativo valido", async () => {
  let upstreamCalls = 0;
  await withGateway(testConfig({ mode: "real", authMode: "corporate" }), {
    authProvider: {
      async getAuthContext() {
        return { headers: { authorization: "VALOR-FICTICIO-DE-TESTE" } };
      }
    },
    upstreamClient: {
      async get() {
        upstreamCalls += 1;
        return [];
      }
    }
  }, async url => {
    const ready = await fetch(`${url}/ready`);
    assert.equal(ready.status, 200);
    assert.equal((await ready.json()).ready, true);
  });
  assert.equal(upstreamCalls, 0);
});

test("T9 caminho real Dispatch usa auth, client, extracao e sanitizacao", async () => {
  const config = testConfig({ mode: "real", authMode: "corporate" });
  let authCalls = 0;
  const requests = [];
  const result = await buildDispatchSnapshot({
    config,
    scenario: "normal",
    wave: "1",
    facilityId: "SSP15",
    groupId: "TESTE",
    siteId: "MLB",
    dependencies: {
      authProvider: {
        async getAuthContext() {
          authCalls += 1;
          return { headers: { authorization: "VALOR-FICTICIO-DE-TESTE" } };
        }
      },
      upstreamClient: {
        async get(request) {
          requests.push(request);
          return { data: [{
            route_name: "TESTE1_AM1",
            route_id: 1001,
            process: "loading_packages",
            dock_number: 3,
            start_time: 10,
            total_elapsed_time: 20,
            campo_privado: "REMOVER"
          }] };
        }
      }
    }
  });

  assert.equal(authCalls, 1);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].authContext.headers.authorization, "VALOR-FICTICIO-DE-TESTE");
  assert.deepEqual(Object.keys(result.operacional[0]), [
    "route_name", "route_id", "process", "dock_number", "start_time", "total_elapsed_time"
  ]);
  assert.equal("campo_privado" in result.operacional[0], false);
});

test("T10 caminho real Aduana normaliza payload bruto e remove IDs internos", async () => {
  const config = testConfig({ mode: "real", authMode: "corporate" });
  let authCalls = 0;
  const requests = [];
  const result = await buildCustomsSnapshot({
    config,
    scenario: "normal",
    timezone: "America/Sao_Paulo",
    dependencies: {
      authProvider: {
        async getAuthContext() {
          authCalls += 1;
          return { headers: { authorization: "VALOR-FICTICIO-DE-TESTE" } };
        }
      },
      upstreamClient: {
        async get(request) {
          requests.push(request);
          return { audits: [{
            status: "in_progress",
            process: "customs_in_progress",
            audit_time: 12,
            operator_id: "OPERADOR-INTERNO",
            driver: {
              route_id: "502731583004",
              cluster_id: "VJ3_AM1",
              driver_id: "DRIVER-INTERNO",
              vehicle_id: "VEICULO-INTERNO",
              carrier_id: "TRANSPORTADORA-INTERNA"
            },
            units: [
              { status: "audited", documento: "REMOVER" },
              { status: "pending", cpf: "REMOVER" }
            ]
          }] };
        }
      }
    }
  });

  assert.equal(authCalls, 1);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].authContext.headers.authorization, "VALOR-FICTICIO-DE-TESTE");
  assert.equal(result.aduana[0].route_name, "VJ3_AM1");
  assert.equal(result.aduana[0].route_id, "502731583004");
  assert.equal(result.aduana[0].aduanaUnidades, "");
  assert.equal(result.aduana[0].aduanaBipadas, 1);
  assert.deepEqual(Object.keys(result.aduana[0]), [
    "route_name", "route_id", "status", "process", "operator_name", "audit_time",
    "aduanaUnidades", "aduanaBipadas", "driver_name", "carrier_name", "plate"
  ]);
  const serialized = JSON.stringify(result.aduana[0]);
  for (const privateField of ["driver_id", "operator_id", "vehicle_id", "carrier_id", "documento", "cpf"]) {
    assert.equal(serialized.includes(privateField), false);
  }
});

test("T11 normalizacao Aduana preserva compatibilidade com payload plano", () => {
  const result = sanitizeCustoms(normalizeCustomsRow({
    route_name: "TESTE1_AM1",
    route_id: "1001",
    status: "in_progress",
    process: "customs_in_progress",
    operator_name: "OPERADOR TESTE",
    audit_time: 12,
    aduanaUnidades: 190,
    aduanaBipadas: 3,
    driver_name: "MOTORISTA TESTE",
    carrier_name: "TRANSPORTADORA TESTE",
    plate: "ABC1D23"
  }));

  assert.equal(result.route_name, "TESTE1_AM1");
  assert.equal(result.route_id, "1001");
  assert.equal(result.aduanaUnidades, 190);
  assert.equal(result.aduanaBipadas, 3);
});

test("T12 preflight e estrutural e nao chama auth ou upstream", () => {
  const env = {
    NODE_ENV: "production",
    GATEWAY_MODE: "real",
    AUTH_MODE: "corporate",
    PANEL_ALLOWED_ORIGIN: "https://painel-preflight.invalid",
    ALLOWED_GROUP_IDS: "TESTE"
  };
  const messages = [];
  const logger = {
    log: message => messages.push(message),
    error: message => messages.push(message)
  };

  const stubExitCode = runPreflight({ env, logger });
  assert.equal(stubExitCode, 2);
  assert.equal(messages.some(message => message.startsWith("AUTH_NOT_CONFIGURED:")), true);

  let authCalls = 0;
  let upstreamCalls = 0;
  const configuredExitCode = runPreflight({
    env,
    logger,
    providerFactory() {
      return {
        mode: "corporate",
        inspectConfiguration() {
          return { configured: true, mode: "corporate" };
        },
        async getAuthContext() {
          authCalls += 1;
          throw new Error("getAuthContext nao deve ser chamado pelo preflight");
        },
        upstreamClient: {
          async get() {
            upstreamCalls += 1;
            throw new Error("upstream nao deve ser chamado pelo preflight");
          }
        }
      };
    }
  });

  assert.equal(configuredExitCode, 0);
  assert.equal(authCalls, 0);
  assert.equal(upstreamCalls, 0);
});


test("Y1 normalizador YMS prioriza gate-out confirmado", () => {
  const result = normalizeYmsRow({
    facility_id: "SSP15",
    operation_date: "2026-09-02",
    cycle_name: "AM1",
    wave_number: 1,
    process_id: "PROCESSO-INTERNO",
    executed_route_id: "434014897",
    planned_route_id: "503226595004",
    route_name: "VJ3_AM1",
    planned_route_name: "A3_AM1",
    route_changed_from_plan: true,
    carrier_name: "UNICA TRANSPORTES",
    planned_carrier_name: "",
    plate: "SDD-UEO6I01",
    gate_out_at: "2026-09-02 09:36:26",
    latest_event_name: "gate-out",
    latest_status: "PROCESS_FINISHED",
    latest_purpose_status: "LOADING_PACKAGES_STARTED"
  });

  assert.equal(result.route_name, "VJ3_AM1");
  assert.equal(result.planned_route_name, "A3_AM1");
  assert.equal(result.route_changed_from_plan, true);
  assert.equal(result.lifecycle_stage, "dispatched");
  assert.equal(result.dispatch_confirmed, true);
  assert.equal(result.terminal_exception, false);
});

test("Y2 eventos terminais nao viram dispatched", () => {
  for (const latestEvent of ["killed", "canceled", "skipped"]) {
    const result = normalizeYmsRow({
      route_name: "TESTE_AM1",
      latest_event_name: latestEvent,
      latest_status: "UN-LOAD_UNFINISHED",
      latest_purpose_status: "LOADING_PACKAGES_STARTED"
    });
    assert.equal(result.lifecycle_stage, "terminal_exception");
    assert.equal(result.dispatch_confirmed, false);
    assert.equal(result.terminal_exception, true);
  }
});

test("Y3 classificacao YMS preserva etapas operacionais", () => {
  assert.equal(classifyLifecycleStage({
    latest_purpose_status: "DOING_AUDIT"
  }), "customs_in_progress");

  assert.equal(classifyLifecycleStage({
    latest_purpose_status: "WAITING_FOR_AUDIT"
  }), "waiting_customs");

  assert.equal(classifyLifecycleStage({
    loading_started_at: "2026-09-02 09:00:00"
  }), "loading_packages");

  assert.equal(classifyLifecycleStage({
    dock_in_at: "2026-09-02 08:50:00"
  }), "at_dock");

  assert.equal(classifyLifecycleStage({
    yms_check_in_at: "2026-09-02 08:40:00"
  }), "checked_in");
});

test("Y4 sanitizador YMS remove IDs internos e campos privados", () => {
  const normalized = normalizeYmsRow({
    facility_id: "SSP15",
    operation_date: "2026-09-02",
    cycle_name: "AM1",
    wave_number: 1,
    process_id: "PROCESSO-INTERNO",
    executed_route_id: "434014897",
    planned_route_id: "503226595004",
    route_name: "VJ3_AM1",
    planned_route_name: "A3_AM1",
    carrier_name: "UNICA TRANSPORTES",
    plate: "SDD-UEO6I01",
    gate_out_at: "2026-09-02 09:36:26",
    latest_event_name: "gate-out",
    latest_status: "PROCESS_FINISHED",
    driver_id: "DRIVER-INTERNO",
    carrier_id: "CARRIER-INTERNO",
    token: "REMOVER"
  });

  const result = sanitizeYms(normalized);
  const serialized = JSON.stringify(result);

  assert.equal(result.route_name, "VJ3_AM1");
  assert.equal(result.lifecycle_stage, "dispatched");
  for (const privateField of [
    "source_process_id",
    "yms_executed_route_id",
    "yms_planned_route_id",
    "driver_id",
    "carrier_id",
    "token"
  ]) {
    assert.equal(privateField in result, false);
    assert.equal(serialized.includes(privateField), false);
  }
});


test("Y5 snapshot preserva contrato antigo com YMS desabilitado", async () => {
  await withGateway(testConfig({ ymsMode: "disabled" }), {}, async url => {
    const response = await fetch(`${url}/snapshot?${query()}`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(Object.keys(body), [
      "snapshotComplete",
      "emptyConfirmed",
      "sources",
      "operacional",
      "aduana"
    ]);
    assert.deepEqual(body.sources, { dispatch: "ok", aduana: "ok" });
    assert.equal("yms" in body, false);
  });
});

test("Y6 snapshot adiciona YMS mock somente quando habilitado", async () => {
  await withGateway(testConfig({ ymsMode: "mock" }), {}, async url => {
    const ready = await fetch(`${url}/ready`);
    assert.equal(ready.status, 200);
    assert.equal((await ready.json()).ready, true);

    const response = await fetch(`${url}/snapshot?${query()}`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.snapshotComplete, true);
    assert.deepEqual(body.sources, {
      dispatch: "ok",
      aduana: "ok",
      yms: "ok"
    });
    assert.ok(Array.isArray(body.yms));
    assert.equal(body.yms.length, 6);
    assert.equal(body.yms[0].route_name, "VJ3_AM1");
    assert.equal(body.yms[0].planned_route_name, "A3_AM1");
    assert.equal(body.yms[0].lifecycle_stage, "dispatched");
    assert.equal(body.yms[0].dispatch_confirmed, true);

    const serialized = JSON.stringify(body.yms[0]);
    for (const privateField of [
      "source_process_id",
      "yms_executed_route_id",
      "yms_planned_route_id",
      "journey_id",
      "driver_id",
      "carrier_id"
    ]) {
      assert.equal(serialized.includes(privateField), false);
    }
  });
});

test("Y7 provider YMS real permanece fail closed sem executor configurado", async () => {
  await withGateway(testConfig({ ymsMode: "provider" }), {}, async url => {
    const ready = await fetch(`${url}/ready`);
    assert.equal(ready.status, 503);
    assert.equal((await ready.json()).ready, false);

    const response = await fetch(`${url}/snapshot?${query()}`);
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.equal(body.error.code, "YMS_PROVIDER_NOT_CONFIGURED");
    assert.equal(body.snapshotComplete, false);
    assert.equal(body.sources.dispatch, "ok");
    assert.equal(body.sources.aduana, "ok");
    assert.equal(body.sources.yms, "error");
  });
});

test("Y8 provider YMS injetado participa do snapshot sem expor IDs internos", async () => {
  const ymsProvider = {
    inspectConfiguration() {
      return { configured: true, mode: "provider" };
    },
    async query({ facilityId, cycle, waves }) {
      assert.equal(facilityId, "SSP15");
      assert.equal(cycle, "AM1");
      assert.deepEqual(waves, ["1", "2", "3", "4", "5"]);

      return [{
        facility_id: "SSP15",
        operation_date: "2026-09-02",
        cycle_name: "AM1",
        wave_number: 1,
        process_id: "PROCESSO-INTERNO",
        executed_route_id: "434014897",
        planned_route_id: "503226595004",
        route_name: "VJ3_AM1",
        planned_route_name: "A3_AM1",
        route_changed_from_plan: true,
        route_resolution_status: "resolved",
        carrier_name: "UNICA TRANSPORTES",
        plate: "SDD-UEO6I01",
        gate_out_at: "2026-09-02 09:36:26",
        latest_event_name: "gate-out",
        latest_status: "PROCESS_FINISHED",
        latest_purpose_status: "LOADING_PACKAGES_STARTED"
      }];
    }
  };

  await withGateway(testConfig({ ymsMode: "provider" }), { ymsProvider }, async url => {
    const ready = await fetch(`${url}/ready`);
    assert.equal(ready.status, 200);

    const response = await fetch(`${url}/snapshot?${query()}`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.sources.yms, "ok");
    assert.equal(body.yms[0].route_name, "VJ3_AM1");
    assert.equal(body.yms[0].lifecycle_stage, "dispatched");
    assert.equal(JSON.stringify(body.yms[0]).includes("PROCESSO-INTERNO"), false);
    assert.equal(JSON.stringify(body.yms[0]).includes("434014897"), false);
    assert.equal(JSON.stringify(body.yms[0]).includes("503226595004"), false);
  });
});


test("Y9 data operacional YMS respeita America/Sao_Paulo", () => {
  assert.equal(
    currentDateInTimeZone("America/Sao_Paulo", new Date("2026-09-26T13:00:00Z")),
    "2026-09-26"
  );
  assert.equal(
    currentDateInTimeZone("America/Sao_Paulo", new Date("2026-09-26T02:00:00Z")),
    "2026-09-25"
  );
});

test("Y10 provider BigQuery parametriza SQL sem credenciais no contrato", async () => {
  const calls = [];
  const provider = createBigQueryYmsProvider({
    sqlLoader() {
      return "SELECT @facility_id AS facility_id, @cycle_name AS cycle_name, @operation_date AS operation_date, @wave_numbers AS wave_numbers";
    },
    async queryExecutor(request) {
      calls.push(request);
      return [{ route_name: "VJ3_AM1" }];
    }
  });

  assert.deepEqual(provider.inspectConfiguration(), {
    configured: true,
    mode: "provider"
  });

  const rows = await provider.query({
    facilityId: "SSP15",
    cycle: "AM1",
    waves: ["1", "2", "3", "4", "5"],
    operationDate: "2026-09-02",
    timezone: "America/Sao_Paulo",
    signal: undefined
  });

  assert.deepEqual(rows, [{ route_name: "VJ3_AM1" }]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, {
    facility_id: "SSP15",
    cycle_name: "AM1",
    operation_date: "2026-09-02",
    wave_numbers: [1, 2, 3, 4, 5]
  });
  assert.equal("credentials" in calls[0], false);
  assert.equal("token" in calls[0], false);
  assert.equal("authorization" in calls[0], false);
});


test("Y10b provider BigQuery valida e normaliza ondas", () => {
  assert.deepEqual(validateWaveNumbers(["1", "2", "2", 3]), [1, 2, 3]);
  assert.throws(
    () => validateWaveNumbers([]),
    error => error.code === "INVALID_QUERY"
  );
  assert.throws(
    () => validateWaveNumbers(["0", "abc"]),
    error => error.code === "INVALID_QUERY"
  );
});

test("Y11 endpoint YMS isolado retorna os estagios mock sanitizados", async () => {
  await withGateway(testConfig({ ymsMode: "mock" }), {}, async url => {
    const response = await fetch(`${url}/yms?${query()}`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.snapshotComplete, true);
    assert.deepEqual(body.sources, { yms: "ok" });
    assert.equal(body.yms.length, 6);

    const stages = new Set(body.yms.map(row => row.lifecycle_stage));
    assert.equal(stages.has("dispatched"), true);
    assert.equal(stages.has("customs_in_progress"), true);
    assert.equal(stages.has("loading_packages"), true);
    assert.equal(stages.has("terminal_exception"), true);

    const serialized = JSON.stringify(body.yms);
    for (const privateValue of [
      "PROCESSO-MOCK-DISPATCHED",
      "PROCESSO-MOCK-ADUANA",
      "PROCESSO-MOCK-LOADING",
      "PROCESSO-MOCK-EXCEPTION",
      "434014897",
      "503226595004"
    ]) {
      assert.equal(serialized.includes(privateValue), false);
    }
  });
});

test("Y12 endpoint YMS falha fechado quando desabilitado", async () => {
  await withGateway(testConfig({ ymsMode: "disabled" }), {}, async url => {
    const response = await fetch(`${url}/yms?${query()}`);
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.equal(body.error.code, "YMS_DISABLED");
    assert.equal(body.snapshotComplete, false);
  });
});


test("Y13 frontend consome YMS somente por opt-in e preserva consolidacao atual", () => {
  const indexPath = path.resolve(__dirname, "../../index.html");
  const source = fs.readFileSync(indexPath, "utf8");

  assert.equal(source.includes('ymsPath: normalizeAutomaticPath(input.ymsPath, "yms")'), true);
  assert.equal(source.includes("ymsEnabled: input.ymsEnabled === true"), true);
  assert.equal(source.includes("data.baseYmsAutomatica = [];"), true);
  assert.equal(source.includes("window.fetchYmsSnapshot = fetchYmsSnapshot;"), true);
  assert.equal(source.includes("window.ymsAutomaticRows = () =>"), true);
  assert.equal(source.includes('new CustomEvent("painel:yms-data"'), true);

  const rebuildStart = source.indexOf("function rebuildConsolidatedBase");
  const rebuildEnd = source.indexOf("function automaticSecondsToClock", rebuildStart);
  const rebuildSource = source.slice(rebuildStart, rebuildEnd);

  assert.equal(rebuildSource.includes("baseYmsAutomatica"), false);
  assert.equal(rebuildSource.includes("baseOperacionalAutomatica"), true);
  assert.equal(rebuildSource.includes("baseAduanaAutomatica"), true);
});


test("Y14 previa visual YMS e opt-in e nao altera a base consolidada", () => {
  const indexPath = path.resolve(__dirname, "../../index.html");
  const source = fs.readFileSync(indexPath, "utf8");

  assert.equal(source.includes("ymsPreview: input.ymsPreview === true"), true);
  assert.equal(source.includes('id = "ymsPreviewPanel"'), true);
  assert.equal(source.includes("Somente homologacao"), true);
  assert.equal(source.includes("Zona YMS"), true);
  assert.equal(source.includes("window.renderYmsPreview = renderYmsPreview;"), true);
  assert.equal(source.includes("function ymsPreviewEscape"), true);

  const rebuildStart = source.indexOf("function rebuildConsolidatedBase");
  const rebuildEnd = source.indexOf("function automaticSecondsToClock", rebuildStart);
  const rebuildSource = source.slice(rebuildStart, rebuildEnd);

  assert.equal(rebuildSource.includes("baseYmsAutomatica"), false);
});


test("Y15 bootstrap da previa local existe somente para localhost", () => {
  const indexPath = path.resolve(__dirname, "../../index.html");
  const source = fs.readFileSync(indexPath, "utf8");

  assert.equal(source.includes("function bootstrapLocalPreviewConfig()"), true);
  assert.equal(source.includes('const ymsPreview = params.get("ymsPreview") === "1";'), true);
  assert.equal(source.includes('const automationPreview = params.get("automationPreview") === "1";'), true);
  assert.equal(source.includes('hostname === "localhost"'), true);
  assert.equal(source.includes('hostname === "127.0.0.1"'), true);
  assert.equal(source.includes('"http://127.0.0.1:8787"'), true);
  assert.equal(source.includes("ymsEnabled: ymsPreview"), true);
  assert.equal(source.includes("bootstrapLocalPreviewConfig();"), true);
});

test("Y16 preview home continua mock YMS e sem credenciais corporativas", () => {
  const scriptPath = path.resolve(__dirname, "../scripts/home-preview.js");
  const source = fs.readFileSync(scriptPath, "utf8");
  const packagePath = path.resolve(__dirname, "../package.json");
  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));

  assert.equal(packageJson.scripts["preview:home"], "node scripts/home-preview.js");
  assert.equal(source.includes('process.env.GATEWAY_MODE = process.env.GATEWAY_MODE || "mock"'), true);
  assert.equal(source.includes('process.env.AUTH_MODE = process.env.AUTH_MODE || "unconfigured"'), true);
  assert.equal(source.includes('const previewMode = process.argv.includes("--recovery")'), true);
  assert.equal(source.includes('process.argv.includes("--flow") ? "flow" : "yms"'), true);
  assert.equal(source.includes('previewMode === "yms" ? "mock" : "disabled"'), true);
  assert.equal(source.includes("ymsPreview=1"), true);
  assert.equal(source.includes("authorization"), false);
  assert.equal(source.includes("cookie"), false);
  assert.equal(source.includes("token"), false);
});


test("Y17 comparacao de fontes identifica mesma doca e etapas diferentes sem escolher autoridade", () => {
  const result = buildSourceComparison({
    operacional: [{
      route_name: "VJ3_AM1",
      process: "waiting_customs",
      dock_number: 2
    }],
    aduana: [{
      route_name: "VJ3_AM1",
      process: "customs_in_progress",
      status: "in_progress"
    }],
    yms: [{
      route_name: "VJ3_AM1",
      lifecycle_stage: "dispatched",
      loading_zone_name: "02",
      dispatch_confirmed: true,
      terminal_exception: false
    }]
  });

  assert.equal(result.summary.total_routes, 1);
  assert.equal(result.summary.all_three, 1);
  assert.equal(result.summary.dock_comparable, 1);
  assert.equal(result.summary.dock_same, 1);
  assert.equal(result.summary.dock_different, 0);
  assert.equal(result.summary.stage_mixed, 1);

  const route = result.routes[0];
  assert.equal(route.route_name, "VJ3_AM1");
  assert.equal(route.source_count, 3);
  assert.equal(route.dock_comparison, "same");
  assert.equal(route.stage_comparison, "mixed");
  assert.deepEqual(route.observed_stages, [
    "waiting_customs",
    "customs_in_progress",
    "dispatched"
  ]);
  assert.equal("authority" in route, false);
  assert.equal("winner" in route, false);
});

test("Y18 comparacao de doca distingue diferenca e falta de evidencia", () => {
  assert.equal(dockComparison("2", "02"), "same");
  assert.equal(dockComparison(2, "12"), "different");
  assert.equal(dockComparison("", "12"), "insufficient");
  assert.equal(dockComparison("2", ""), "insufficient");
});

test("Y19 snapshot combinado YMS inclui diagnostico de comparacao", async () => {
  await withGateway(testConfig({ ymsMode: "mock" }), {}, async url => {
    const response = await fetch(`${url}/snapshot?${query()}`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.ok(body.comparison);
    assert.ok(body.comparison.summary);
    assert.ok(Array.isArray(body.comparison.routes));

    const vj3 = body.comparison.routes.find(row => row.route_name === "VJ3_AM1");
    assert.ok(vj3);
    assert.equal(vj3.source_count, 3);
    assert.equal(vj3.dock_comparison, "same");
    assert.equal(vj3.stage_comparison, "mixed");

    const serialized = JSON.stringify(body.comparison);
    assert.equal(serialized.includes("PROCESSO-MOCK"), false);
    assert.equal(serialized.includes("434014897"), false);
    assert.equal(serialized.includes("503226595004"), false);
  });
});

test("Y20 frontend mantem comparacao somente na sessao de homologacao", () => {
  const indexPath = path.resolve(__dirname, "../../index.html");
  const source = fs.readFileSync(indexPath, "utf8");

  assert.equal(source.includes("data.baseComparisonAutomatica = null;"), true);
  assert.equal(source.includes("window.ymsSourceComparison = () =>"), true);
  assert.equal(source.includes("COMPARACAO DE FONTES"), true);
  assert.equal(source.includes("delete payload.baseComparisonAutomatica;"), true);

  const rebuildStart = source.indexOf("function rebuildConsolidatedBase");
  const rebuildEnd = source.indexOf("function automaticSecondsToClock", rebuildStart);
  const rebuildSource = source.slice(rebuildStart, rebuildEnd);

  assert.equal(rebuildSource.includes("baseComparisonAutomatica"), false);
  assert.equal(rebuildSource.includes("baseYmsAutomatica"), false);
});


test("Y21 mock comparativo cobre os principais diagnosticos de homologacao", async () => {
  await withGateway(testConfig({ ymsMode: "mock" }), {}, async url => {
    const response = await fetch(`${url}/snapshot?${query()}`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.yms.length, 6);

    assert.deepEqual(body.comparison.summary, {
      total_routes: 6,
      with_dispatch: 3,
      with_aduana: 1,
      with_yms: 6,
      all_three: 1,
      stage_comparable: 3,
      stage_all_equal: 1,
      stage_mixed: 2,
      dock_comparable: 3,
      dock_same: 2,
      dock_different: 1,
      yms_ahead: 1,
      dispatch_ahead: 1,
      aligned_dispatch_yms: 1,
      missing_source: 5,
      yms_terminal_exception: 1
    });

    const vj3 = body.comparison.routes.find(row => row.route_name === "VJ3_AM1");
    const vt9 = body.comparison.routes.find(row => row.route_name === "VT9_AM1");
    const vt12 = body.comparison.routes.find(row => row.route_name === "VT12_AM1");
    const vv8 = body.comparison.routes.find(row => row.route_name === "VV8_AM1");

    assert.equal(vj3.lead_observation, "yms_ahead");
    assert.equal(vj3.dock_comparison, "same");
    assert.equal(vj3.diagnostic_flags.includes("yms_ahead"), true);

    assert.equal(vt9.lead_observation, "aligned");
    assert.equal(vt9.dock_comparison, "different");
    assert.equal(vt9.diagnostic_flags.includes("dock_divergence"), true);

    assert.equal(vt12.lead_observation, "dispatch_ahead");
    assert.equal(vt12.dock_comparison, "same");
    assert.equal(vt12.diagnostic_flags.includes("dispatch_ahead"), true);

    assert.equal(vv8.diagnostic_flags.includes("yms_terminal_exception"), true);
    assert.equal(vv8.diagnostic_flags.includes("missing_source"), true);
  });
});

test("Y22 previa visual explica que etapa posterior e heuristica", () => {
  const indexPath = path.resolve(__dirname, "../../index.html");
  const source = fs.readFileSync(indexPath, "utf8");

  assert.equal(source.includes("YMS em etapa posterior"), true);
  assert.equal(source.includes("Dispatch em etapa posterior"), true);
  assert.equal(source.includes("Doca divergente"), true);
  assert.equal(source.includes("Fonte sem registro"), true);
  assert.equal(source.includes("comparacao heuristica"), true);
  assert.equal(source.includes("nao define qual fonte esta correta"), true);
});


test("Y23 linha do tempo diagnostica permanece somente na sessao", () => {
  const indexPath = path.resolve(__dirname, "../../index.html");
  const source = fs.readFileSync(indexPath, "utf8");

  assert.equal(source.includes("data.baseDiagnosticHistory = [];"), true);
  assert.equal(source.includes("AUTOMATIC_DIAGNOSTIC_HISTORY_MAX = 240"), true);
  assert.equal(source.includes("recordAutomaticDiagnosticSnapshot"), true);
  assert.equal(source.includes("LINHA DO TEMPO DA SESSAO"), true);
  assert.equal(source.includes("nao e timestamp oficial das fontes"), true);
  assert.equal(source.includes("window.ymsDiagnosticHistory = () =>"), true);
  assert.equal(source.includes("delete payload.baseDiagnosticHistory;"), true);

  const rebuildStart = source.indexOf("function rebuildConsolidatedBase");
  const rebuildEnd = source.indexOf("function automaticSecondsToClock", rebuildStart);
  const rebuildSource = source.slice(rebuildStart, rebuildEnd);

  assert.equal(rebuildSource.includes("baseDiagnosticHistory"), false);
});

test("Y24 defasagem observada usa somente mudancas da sessao", () => {
  const indexPath = path.resolve(__dirname, "../../index.html");
  const source = fs.readFileSync(indexPath, "utf8");

  assert.equal(source.includes("DIAGNOSTIC_HISTORY_SOURCES"), true);
  assert.equal(source.includes("diagnosticChangedSources"), true);
  assert.equal(source.includes("item.changed_sources = diagnosticChangedSources(previous, item);"), true);
  assert.equal(source.includes("calculateObservedSourceLag"), true);
  assert.equal(source.includes("observed_spread_seconds"), true);
  assert.equal(source.includes("DEFASAGEM OBSERVADA"), true);
  assert.equal(source.includes("nao prova que as fontes registraram o mesmo evento"), true);
  assert.equal(source.includes("window.ymsObservedSourceLag = () =>"), true);

  const rebuildStart = source.indexOf("function rebuildConsolidatedBase");
  const rebuildEnd = source.indexOf("function automaticSecondsToClock", rebuildStart);
  const rebuildSource = source.slice(rebuildStart, rebuildEnd);

  assert.equal(rebuildSource.includes("calculateObservedSourceLag"), false);
  assert.equal(rebuildSource.includes("changed_sources"), false);
});

test("Y25 padrao da sessao resume primeira mudanca e intervalos", () => {
  const indexPath = path.resolve(__dirname, "../../index.html");
  const source = fs.readFileSync(indexPath, "utf8");

  assert.equal(source.includes("first_change_at"), true);
  assert.equal(source.includes("first_observed_sources"), true);
  assert.equal(source.includes("initial_observed_spread_seconds"), true);
  assert.equal(source.includes("diagnosticNumericStats"), true);
  assert.equal(source.includes("calculateObservedSourceSessionStats"), true);
  assert.equal(source.includes("PADRAO DA SESSAO"), true);
  assert.equal(source.includes("Primeira mudanca observada"), true);
  assert.equal(source.includes("Estatistica observacional desta sessao"), true);
  assert.equal(source.includes("Nao mede desempenho, latencia oficial ou autoridade das fontes"), true);
  assert.equal(source.includes("window.ymsObservedSessionStats = () =>"), true);

  const rebuildStart = source.indexOf("function rebuildConsolidatedBase");
  const rebuildEnd = source.indexOf("function automaticSecondsToClock", rebuildStart);
  const rebuildSource = source.slice(rebuildStart, rebuildEnd);

  assert.equal(rebuildSource.includes("calculateObservedSourceSessionStats"), false);
  assert.equal(rebuildSource.includes("first_observed_sources"), false);
});

test("Y26 padroes recorrentes contam episodios e evitam duplicidade", () => {
  const indexPath = path.resolve(__dirname, "../../index.html");
  const source = fs.readFileSync(indexPath, "utf8");

  assert.equal(source.includes("RECURRING_DIAGNOSTIC_FLAGS"), true);
  assert.equal(source.includes("calculateRecurringDiagnosticPatterns"), true);
  assert.equal(source.includes("previousActiveKeys"), true);
  assert.equal(source.includes("episode_count >= 2"), true);
  assert.equal(source.includes('flags.includes("yms_ahead") || flags.includes("dispatch_ahead")'), true);
  assert.equal(source.includes('flags = flags.filter(flag => flag !== "stage_divergence")'), true);
  assert.equal(source.includes("PADROES RECORRENTES"), true);
  assert.equal(source.includes("Persistencia continua conta como um unico episodio"), true);
  assert.equal(source.includes("recorrencia nao implica causa, falha ou fonte incorreta"), true);
  assert.equal(source.includes("window.ymsRecurringDiagnosticPatterns = () =>"), true);

  const rebuildStart = source.indexOf("function rebuildConsolidatedBase");
  const rebuildEnd = source.indexOf("function automaticSecondsToClock", rebuildStart);
  const rebuildSource = source.slice(rebuildStart, rebuildEnd);

  assert.equal(rebuildSource.includes("calculateRecurringDiagnosticPatterns"), false);
  assert.equal(rebuildSource.includes("episode_count"), false);
});

test("A16 groupId fica restrito a allowlist do gateway", async () => {
  const denied = await jsonRequest(
    "/snapshot?facilityId=SSP15&siteId=MLB&groupId=NAO_AUTORIZADO&cycle=AM1&timezone=America%2FSao_Paulo&waves=1,2,3,4,5"
  );
  assert.equal(denied.response.status, 400);
  assert.equal(denied.body.error.code, "INVALID_QUERY");
  assert.match(denied.body.error.message, /groupId nao autorizado/);

  const cloudMock = createConfig({
    NODE_ENV: "production",
    GATEWAY_MODE: "mock",
    PANEL_ALLOWED_ORIGIN: "https://painel.example"
  });
  assert.deepEqual([...cloudMock.allowedGroupIds], ["TESTE"]);
});

test("A17 configuracao publica usa homologacao segura e sem segredo", () => {
  const root = path.resolve(__dirname, "../..");
  const configSource = fs.readFileSync(path.join(root, "automation-config.js"), "utf8");
  const indexSource = fs.readFileSync(path.join(root, "index.html"), "utf8");

  assert.equal(indexSource.includes('<script src="./automation-config.js"></script>'), true);
  assert.equal(configSource.includes("https://painel-docas-am1-gateway.vercel.app"), true);
  assert.equal(configSource.includes('snapshotPath: "snapshot"'), true);
  assert.equal(configSource.includes("homologation: true"), true);
  assert.equal(configSource.includes("ymsEnabled: false"), true);
  assert.equal(configSource.includes("ymsPreview: false"), true);
  assert.equal(configSource.includes("enabled: true"), true);
  assert.equal(configSource.includes("envios.adminml.com"), false);
  assert.equal(/authorization\s*:/i.test(configSource), false);
  assert.equal(/cookie\s*:/i.test(configSource), false);
  assert.equal(/token\s*:/i.test(configSource), false);
  assert.equal(/password\s*:/i.test(configSource), false);
});

test("A18 Vercel production mock usa somente defaults seguros de homologacao", () => {
  const config = createConfig({
    NODE_ENV: "production",
    VERCEL: "1",
    GATEWAY_MODE: "mock"
  });

  assert.equal(config.mode, "mock");
  assert.equal(config.mockScenario, "empty-confirmed");
  assert.equal(config.authMode, "unconfigured");
  assert.equal(config.ymsMode, "disabled");
  assert.deepEqual([...config.allowedOrigins], ["https://muriloliloo.github.io"]);
  assert.deepEqual([...config.allowedGroupIds], ["TESTE"]);
});

test("A19 modo real na Vercel continua exigindo configuracao corporativa explicita", () => {
  assert.throws(
    () => createConfig({
      NODE_ENV: "production",
      VERCEL: "1",
      GATEWAY_MODE: "real"
    }),
    /PANEL_ALLOWED_ORIGIN/
  );
});

test("G18 sequencia operacional mock evolui a mesma rota pelo polling", async () => {
  await withGateway(testConfig({
    mockScenario: "operational-sequence",
    ymsMode: "disabled"
  }), {}, async url => {
    const snapshots = [];

    for (let index = 0; index < 5; index += 1) {
      const response = await fetch(`${url}/snapshot?${query()}`);
      assert.equal(response.status, 200);
      snapshots.push(await response.json());
    }

    const processes = snapshots.map(snapshot => snapshot.operacional[0]?.process || "");
    assert.deepEqual(processes, [
      "waiting_customs",
      "customs_in_progress",
      "loading_packages",
      "dispatched",
      "dispatched"
    ]);

    assert.equal(snapshots.every(snapshot => snapshot.snapshotComplete === true), true);
    assert.equal(snapshots.every(snapshot => snapshot.operacional[0]?.route_name === "G5_AM1"), true);
    assert.equal(snapshots.every(snapshot => snapshot.operacional[0]?.dock_number === 6), true);
    assert.equal(snapshots[0].aduana.length, 0);
    assert.equal(snapshots[1].aduana[0]?.process, "customs_in_progress");
    assert.equal(snapshots[2].aduana[0]?.process, "customs_completed");
    assert.equal(snapshots[3].aduana[0]?.process, "customs_completed");
    assert.equal("yms" in snapshots[0], false);
  });
});

test("G19 preview flow local usa polling sem YMS", () => {
  const root = path.resolve(__dirname, "../..");
  const homeSource = fs.readFileSync(path.join(root, "gateway/scripts/home-preview.js"), "utf8");
  const indexSource = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "gateway/package.json"), "utf8"));

  assert.equal(packageJson.scripts["preview:flow"], "node scripts/home-preview.js --flow");
  assert.equal(homeSource.includes('"operational-sequence"'), true);
  assert.equal(homeSource.includes('"automation-config.js"'), true);
  assert.equal(homeSource.includes("?automationPreview=1"), true);
  assert.equal(indexSource.includes('const automationPreview = params.get("automationPreview") === "1";'), true);
  assert.equal(indexSource.includes("ymsEnabled: ymsPreview"), true);
  assert.equal(indexSource.includes("intervalMs: automationPreview ? 15000 : 30000"), true);
  assert.equal(indexSource.includes("function normalizeCustomsState(value)"), true);
  assert.equal(indexSource.includes('return "Aduana em andamento";'), true);
  assert.equal(indexSource.includes('return "Concluída";'), true);
});

test("G20 sequencia recovery falha uma vez e depois recupera", async () => {
  await withGateway(testConfig({
    mockScenario: "operational-recovery",
    ymsMode: "disabled"
  }), {}, async url => {
    const first = await fetch(`${url}/snapshot?${query()}`);
    const firstBody = await first.json();
    assert.equal(first.status, 200);
    assert.equal(firstBody.operacional[0]?.route_name, "G5_AM1");
    assert.equal(firstBody.operacional[0]?.process, "waiting_customs");

    const second = await fetch(`${url}/snapshot?${query()}`);
    const secondBody = await second.json();
    assert.equal(second.status, 200);
    assert.equal(secondBody.operacional[0]?.process, "customs_in_progress");

    const third = await fetch(`${url}/snapshot?${query()}`);
    const thirdBody = await third.json();
    assert.equal(third.status, 200);
    assert.equal(thirdBody.operacional[0]?.process, "loading_packages");

    const failure = await fetch(`${url}/snapshot?${query()}`);
    const failureBody = await failure.json();
    assert.equal(failure.status, 502);
    assert.equal(failureBody.snapshotComplete, false);
    assert.equal(failureBody.emptyConfirmed, false);
    assert.equal(failureBody.sources.dispatch, "error");
    assert.equal(failureBody.sources.aduana, "ok");

    const recovered = await fetch(`${url}/snapshot?${query()}`);
    const recoveredBody = await recovered.json();
    assert.equal(recovered.status, 200);
    assert.equal(recoveredBody.operacional[0]?.route_name, "G5_AM1");
    assert.equal(recoveredBody.operacional[0]?.process, "dispatched");

    const stable = await fetch(`${url}/snapshot?${query()}`);
    const stableBody = await stable.json();
    assert.equal(stable.status, 200);
    assert.equal(stableBody.operacional[0]?.process, "dispatched");
  });
});

test("G21 preview recovery fica offline e sem YMS", () => {
  const root = path.resolve(__dirname, "../..");
  const homeSource = fs.readFileSync(path.join(root, "gateway/scripts/home-preview.js"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "gateway/package.json"), "utf8"));

  assert.equal(packageJson.scripts["preview:recovery"], "node scripts/home-preview.js --recovery");
  assert.equal(homeSource.includes('process.argv.includes("--recovery")'), true);
  assert.equal(homeSource.includes('"operational-recovery"'), true);
  assert.equal(homeSource.includes('previewMode === "yms" ? "mock" : "disabled"'), true);
});

