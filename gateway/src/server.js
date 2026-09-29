"use strict";

const http = require("node:http");
const { URL } = require("node:url");
const { createConfig } = require("./config");
const { createAuthProvider, getAuthContext } = require("./auth");
const { createYmsProvider, isYmsProviderReady } = require("./providers/yms-provider");
const { GatewayError } = require("./errors");
const { createUpstreamClient } = require("./http/upstream-client");
const { createSafeLogger } = require("./logging");
const {
  buildSnapshot,
  buildDispatchSnapshot,
  buildCustomsSnapshot,
  buildYmsSnapshot
} = require("./services/snapshot");

const MOCK_SCENARIOS = new Set([
  "normal",
  "loading",
  "dispatched",
  "customs-in-progress",
  "customs-complete",
  "flow-waiting",
  "flow-customs",
  "flow-loading",
  "flow-dispatched",
  "operational-sequence",
  "operational-recovery",
  "empty-unconfirmed",
  "empty-confirmed",
  "failure-dispatch",
  "failure-customs",
  "timeout"
]);

const MOCK_OPERATIONAL_SEQUENCE = Object.freeze([
  "flow-waiting",
  "flow-customs",
  "flow-loading",
  "flow-dispatched"
]);

const MOCK_RECOVERY_SEQUENCE = Object.freeze([
  "flow-waiting",
  "flow-customs",
  "flow-loading",
  "failure-dispatch",
  "flow-dispatched"
]);

const COMMON_QUERY_KEYS = new Set(["facilityId", "siteId", "groupId", "cycle", "timezone", "scenario"]);
const MAX_REQUEST_TARGET_BYTES = 2048;
const MAX_WAVE_COUNT = 10;
const SENSITIVE_REQUEST_HEADERS = new Set(["authorization", "cookie", "proxy-authorization", "x-csrf-token", "x-xsrf-token"]);

function commonHeaders() {
  return {
    "Cache-Control": "no-store, max-age=0",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
  };
}

function applyCors(request, response, config) {
  const origin = request.headers.origin;
  response.setHeader("Vary", "Origin");
  if (!origin) return;
  if (!config.allowedOrigins.has(origin)) {
    throw new GatewayError(403, "ORIGIN_NOT_ALLOWED", "Origem nao autorizada pelo gateway.");
  }
  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Accept");
  response.setHeader("Access-Control-Expose-Headers", "X-Painel-Gateway-Mode");
  response.setHeader("Access-Control-Max-Age", "600");
}

function rejectSensitiveRequestHeaders(request) {
  for (const header of SENSITIVE_REQUEST_HEADERS) {
    if (request.headers[header] !== undefined) {
      throw new GatewayError(400, "SENSITIVE_HEADER_REJECTED", "Headers sensiveis nao sao aceitos pelo gateway publico.");
    }
  }

  const requestedHeaders = String(request.headers["access-control-request-headers"] || "")
    .split(",")
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
  if (requestedHeaders.some(header => SENSITIVE_REQUEST_HEADERS.has(header))) {
    throw new GatewayError(400, "SENSITIVE_HEADER_REJECTED", "Headers sensiveis nao sao aceitos pelo gateway publico.");
  }
}

function validateRequestTarget(rawTarget) {
  if (!rawTarget || Buffer.byteLength(rawTarget, "utf8") > MAX_REQUEST_TARGET_BYTES) {
    throw new GatewayError(414, "URI_TOO_LONG", "Request target excede o limite seguro.");
  }
  if (!rawTarget.startsWith("/") || rawTarget.startsWith("//") || rawTarget.includes("\\")) {
    throw new GatewayError(400, "INVALID_REQUEST_TARGET", "Request target invalido.");
  }

  const rawPath = rawTarget.split("?", 1)[0];
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {
    throw new GatewayError(400, "INVALID_REQUEST_TARGET", "Request target invalido.");
  }
  if (decodedPath.startsWith("//") || decodedPath.includes("\\") || /[\r\n]/.test(decodedPath)
      || decodedPath.split("/").includes("..")) {
    throw new GatewayError(400, "INVALID_REQUEST_TARGET", "Request target invalido.");
  }
}

function sendJson(response, status, payload, config) {
  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body, "utf8") > config.maxResponseBytes) {
    return sendJson(response, 500, {
      error: { code: "RESPONSE_TOO_LARGE", message: "Resposta excedeu o limite seguro configurado." }
    }, { ...config, maxResponseBytes: Number.MAX_SAFE_INTEGER });
  }
  response.writeHead(status, {
    ...commonHeaders(),
    "X-Painel-Gateway-Mode": config.mode
  });
  response.end(body);
}

function sendError(response, error, config, pathname = "") {
  const safeError = error instanceof GatewayError
    ? error
    : new GatewayError(500, "INTERNAL_ERROR", "Falha interna do gateway.");
  const payload = {
    error: { code: safeError.code, message: safeError.message }
  };

  if (new Set(["/snapshot", "/dispatch", "/customs", "/yms"]).has(pathname)) {
    payload.snapshotComplete = false;
    payload.emptyConfirmed = false;
    payload.sources = safeError.details.sources || {};
  }
  sendJson(response, safeError.status, payload, config);
}

function rejectUnknownParameters(searchParams, allowedKeys) {
  for (const key of searchParams.keys()) {
    if (!allowedKeys.has(key)) {
      throw new GatewayError(400, "INVALID_QUERY", `Parametro nao permitido: ${key}.`);
    }
  }
}

function configuredValue(searchParams, key, allowedValues, fallback, maxLength) {
  const value = searchParams.has(key) ? searchParams.get(key) : fallback;
  if (!value || value.length > maxLength || !allowedValues.has(value)) {
    throw new GatewayError(400, "INVALID_QUERY", `${key} nao autorizado.`);
  }
  return value;
}

function validateTimezone(value) {
  if (value.length > 64 || !/^[A-Za-z_]+(?:\/[A-Za-z_+-]+)+$/.test(value)) {
    throw new GatewayError(400, "INVALID_QUERY", "timezone invalido.");
  }
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: value }).format();
  } catch {
    throw new GatewayError(400, "INVALID_QUERY", "timezone invalido.");
  }
  return value;
}

function validateScenario(searchParams, config) {
  const scenario = searchParams.get("scenario") || config.mockScenario;
  if (searchParams.has("scenario") && (config.mode !== "mock" || config.nodeEnv === "production")) {
    throw new GatewayError(400, "INVALID_QUERY", "Cenarios por query so sao aceitos em development/mock.");
  }
  if (scenario.length > 40 || !MOCK_SCENARIOS.has(scenario)) {
    throw new GatewayError(400, "INVALID_QUERY", "Cenario mock invalido.");
  }
  return scenario;
}

function dateStampInTimeZone(timezone, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);

  const values = Object.fromEntries(
    parts.filter(part => part.type !== "literal").map(part => [part.type, part.value])
  );
  return `${values.year}${values.month}${values.day}`;
}

function deriveOperationalGroupId({ facilityId, cycle, timezone, now = new Date() }) {
  return `${facilityId}_${dateStampInTimeZone(timezone, now)}_${cycle}_0`;
}

function validateGroupId(searchParams, config, { facilityId, cycle, timezone }) {
  const derived = deriveOperationalGroupId({ facilityId, cycle, timezone });
  const value = searchParams.has("groupId") ? searchParams.get("groupId") : derived;

  if (!value || value.length > 40) {
    throw new GatewayError(400, "INVALID_QUERY", "groupId nao autorizado.");
  }

  if (config.allowedGroupIds.has(value) || value === derived) return value;

  throw new GatewayError(400, "INVALID_QUERY", "groupId nao autorizado.");
}

function validateOperationalQuery(searchParams, config, endpoint) {
  const extraKeys = endpoint === "/snapshot" || endpoint === "/yms"
    ? ["waves"]
    : endpoint === "/dispatch"
      ? ["wave"]
      : [];
  rejectUnknownParameters(searchParams, new Set([...COMMON_QUERY_KEYS, ...extraKeys]));

  const facilityId = configuredValue(searchParams, "facilityId", config.allowedFacilityIds, [...config.allowedFacilityIds][0], 32);
  const siteId = configuredValue(searchParams, "siteId", config.allowedSiteIds, [...config.allowedSiteIds][0], 16);
  const cycle = configuredValue(searchParams, "cycle", config.allowedCycles, [...config.allowedCycles][0], 16);
  const timezone = validateTimezone(searchParams.get("timezone") || "America/Sao_Paulo");
  const groupId = validateGroupId(searchParams, config, { facilityId, cycle, timezone });
  const scenario = validateScenario(searchParams, config);

  let waves = [...config.allowedWaves];
  if (endpoint === "/snapshot" || endpoint === "/yms") {
    const wavesValue = searchParams.has("waves") ? searchParams.get("waves") : waves.join(",");
    if (wavesValue.length > 100) {
      throw new GatewayError(400, "INVALID_QUERY", "waves excede o limite seguro.");
    }
    waves = wavesValue.split(",").map(value => value.trim());
  }
  if (endpoint === "/dispatch") {
    const wave = searchParams.get("wave") || "";
    if (wave.length > 8) throw new GatewayError(400, "INVALID_QUERY", "wave invalida.");
    waves = [wave];
  }
  if (!waves.length || waves.length > MAX_WAVE_COUNT || waves.some(wave => !config.allowedWaves.has(wave))
      || new Set(waves).size !== waves.length) {
    throw new GatewayError(400, "INVALID_QUERY", endpoint === "/dispatch" ? "wave invalida." : "waves invalido.");
  }

  return { facilityId, siteId, groupId, cycle, timezone, scenario, waves };
}

function createGatewayHandler(config = createConfig(), dependencies = {}) {
  let mockSequenceIndex = 0;

  const resolveMockSequence = (query, pathname) => {
    if (config.mode !== "mock"
        || !new Set(["operational-sequence", "operational-recovery"]).has(query.scenario)) {
      return query;
    }

    const sequence = query.scenario === "operational-recovery"
      ? MOCK_RECOVERY_SEQUENCE
      : MOCK_OPERATIONAL_SEQUENCE;
    const sequenceIndex = pathname === "/snapshot"
      ? mockSequenceIndex++
      : Math.max(0, mockSequenceIndex - 1);

    return {
      ...query,
      scenario: sequence[Math.min(sequenceIndex, sequence.length - 1)]
    };
  };

  const sourceDependencies = Object.freeze({
    authProvider: dependencies.authProvider || createAuthProvider(config),
    upstreamClient: dependencies.upstreamClient || createUpstreamClient({
      config,
      fetchImpl: dependencies.fetchImpl || globalThis.fetch
    }),
    ymsProvider: dependencies.ymsProvider || createYmsProvider(config)
  });

  return async (request, response) => {
    let pathname = "";
    try {
      rejectSensitiveRequestHeaders(request);
      applyCors(request, response, config);

      if (request.method === "OPTIONS") {
        response.writeHead(204, { ...commonHeaders(), Allow: "GET, OPTIONS" });
        response.end();
        return;
      }
      if (request.method !== "GET") {
        response.setHeader("Allow", "GET, OPTIONS");
        throw new GatewayError(405, "METHOD_NOT_ALLOWED", "Metodo nao permitido.");
      }

      if (request.headers["content-length"] && request.headers["content-length"] !== "0"
          || request.headers["transfer-encoding"]) {
        throw new GatewayError(400, "REQUEST_BODY_NOT_ALLOWED", "Corpo de requisicao nao e aceito.");
      }

      validateRequestTarget(request.url);
      const url = new URL(request.url, "http://gateway.local");
      pathname = url.pathname;

      if (pathname === "/health") {
        rejectUnknownParameters(url.searchParams, new Set());
        sendJson(response, 200, {
          status: "ok",
          gatewayMode: config.mode,
          authMode: config.authMode,
          snapshotSourceMode: config.snapshotSourceMode
        }, config);
        return;
      }
      if (pathname === "/ready") {
        rejectUnknownParameters(url.searchParams, new Set());
        let ready = config.mode === "mock";

        if (!ready && config.snapshotSourceMode === "yms-primary") {
          ready = isYmsProviderReady(config, sourceDependencies.ymsProvider);
        } else if (!ready) {
          try {
            await getAuthContext(sourceDependencies.authProvider);
            ready = true;
          } catch {
            ready = false;
          }

          if (ready && !isYmsProviderReady(config, sourceDependencies.ymsProvider)) {
            ready = false;
          }
        }

        sendJson(response, ready ? 200 : 503, {
          ready,
          gatewayMode: config.mode,
          authMode: config.authMode,
          snapshotSourceMode: config.snapshotSourceMode
        }, config);
        return;
      }
      if (pathname === "/snapshot") {
        const query = resolveMockSequence(
          validateOperationalQuery(url.searchParams, config, pathname),
          pathname
        );
        sendJson(response, 200, await buildSnapshot({ config, ...query, dependencies: sourceDependencies }), config);
        return;
      }
      if (pathname === "/dispatch") {
        const query = resolveMockSequence(
          validateOperationalQuery(url.searchParams, config, pathname),
          pathname
        );
        sendJson(response, 200, await buildDispatchSnapshot({
          config,
          ...query,
          wave: query.waves[0],
          dependencies: sourceDependencies
        }), config);
        return;
      }
      if (pathname === "/customs") {
        const query = resolveMockSequence(
          validateOperationalQuery(url.searchParams, config, pathname),
          pathname
        );
        sendJson(response, 200, await buildCustomsSnapshot({
          config,
          ...query,
          dependencies: sourceDependencies
        }), config);
        return;
      }
      if (pathname === "/yms") {
        const query = resolveMockSequence(
          validateOperationalQuery(url.searchParams, config, pathname),
          pathname
        );
        sendJson(response, 200, await buildYmsSnapshot({
          config,
          ...query,
          dependencies: sourceDependencies
        }), config);
        return;
      }

      throw new GatewayError(404, "NOT_FOUND", "Endpoint nao encontrado.");
    } catch (error) {
      if (!response.headersSent) sendError(response, error, config, pathname);
      else response.destroy();
    }
  };
}

function createGatewayServer(config = createConfig(), dependencies = {}) {
  return http.createServer(createGatewayHandler(config, dependencies));
}

if (require.main === module) {
  const config = createConfig();
  const logger = createSafeLogger();
  const server = createGatewayServer(config);
  server.listen(config.port, "127.0.0.1", () => {
    logger.info("Gateway seguro iniciado.", {
      host: "127.0.0.1",
      port: config.port,
      gatewayMode: config.mode,
      authMode: config.authMode
    });
  });
}

module.exports = {
  MOCK_SCENARIOS,
  MOCK_OPERATIONAL_SEQUENCE,
  MOCK_RECOVERY_SEQUENCE,
  createGatewayHandler,
  createGatewayServer,
  validateRequestTarget,
  validateOperationalQuery,
  deriveOperationalGroupId,
  dateStampInTimeZone
};
