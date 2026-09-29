"use strict";

const { GatewayError } = require("./errors");

const AUTH_MODES = Object.freeze(["unconfigured", "corporate"]);
const YMS_MODES = Object.freeze(["disabled", "mock", "provider"]);
const UPSTREAM_HOST_ALLOWLIST = Object.freeze(["envios.adminml.com"]);
const DEFAULT_DISPATCH_BASE_URL = "https://envios.adminml.com";
const DEFAULT_CUSTOMS_BASE_URL = "https://envios.adminml.com";
const DEFAULT_DISPATCH_PATH = "/logistics/last-mile/monitoring/frm-provider/api/dispatch";
const DEFAULT_CUSTOMS_PATH = "/logistics/audit/api/audits/search";

function csvValues(value, fallback) {
  return String(value || fallback)
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
}

function positiveInteger(value, fallback, name) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new GatewayError(500, "INVALID_CONFIGURATION", `${name} deve ser um inteiro positivo.`);
  }
  return parsed;
}

function validatedSet(name, values, pattern, maxEntries = 20) {
  const normalized = Array.from(new Set(values));
  if (!normalized.length || normalized.length > maxEntries || normalized.some(value => !pattern.test(value))) {
    throw new GatewayError(500, "INVALID_CONFIGURATION", `${name} possui valores invalidos.`);
  }
  return new Set(normalized);
}

function isSafeCloudMock(env, nodeEnv, mode) {
  const isCloudRuntime = env.VERCEL === "1" || Boolean(env.VERCEL_ENV);
  return nodeEnv === "production" && mode === "mock" && isCloudRuntime;
}

function configuredOrigins(env, overrides, nodeEnv, mode) {
  const safeCloudMock = isSafeCloudMock(env, nodeEnv, mode);
  const values = overrides.allowedOrigins
    ?? (env.PANEL_ALLOWED_ORIGIN
      ? csvValues(env.PANEL_ALLOWED_ORIGIN, "")
      : safeCloudMock
        ? ["https://muriloliloo.github.io"]
        : nodeEnv === "production" ? [] : ["http://localhost:8000"]);

  if (!values.length && nodeEnv === "production") {
    throw new GatewayError(
      500,
      "INVALID_CONFIGURATION",
      "PANEL_ALLOWED_ORIGIN e obrigatorio em production."
    );
  }

  const normalized = values.map(value => {
    if (value === "*") {
      throw new GatewayError(500, "INVALID_CONFIGURATION", "CORS curinga nao e permitido.");
    }
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new GatewayError(500, "INVALID_CONFIGURATION", "PANEL_ALLOWED_ORIGIN possui origem invalida.");
    }
    if (!new Set(["http:", "https:"]).has(url.protocol) || url.origin !== value || url.username || url.password) {
      throw new GatewayError(500, "INVALID_CONFIGURATION", "PANEL_ALLOWED_ORIGIN deve conter somente origens HTTP(S) exatas.");
    }
    return value;
  });

  return new Set(normalized);
}

function validatedUpstreamBaseUrl(name, value, nodeEnv) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw new GatewayError(500, "INVALID_CONFIGURATION", `${name} possui URL invalida.`);
  }

  if (url.username || url.password) {
    throw new GatewayError(500, "INVALID_CONFIGURATION", `${name} nao aceita usuario ou senha na URL.`);
  }
  if (!new Set(["http:", "https:"]).has(url.protocol)) {
    throw new GatewayError(500, "INVALID_CONFIGURATION", `${name} deve usar protocolo HTTP(S).`);
  }
  if (nodeEnv === "production" && url.protocol !== "https:") {
    throw new GatewayError(500, "INVALID_CONFIGURATION", `${name} deve usar HTTPS em production.`);
  }
  if (!UPSTREAM_HOST_ALLOWLIST.includes(url.hostname.toLowerCase())) {
    throw new GatewayError(500, "UPSTREAM_HOST_NOT_ALLOWED", `${name} possui host nao autorizado.`);
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new GatewayError(500, "INVALID_CONFIGURATION", `${name} deve conter somente a origem autorizada.`);
  }

  return url.origin;
}

function validatedUpstreamPath(name, value, expectedPath) {
  const path = String(value || "").trim();
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(path);
  } catch {
    throw new GatewayError(500, "INVALID_CONFIGURATION", `${name} possui caminho invalido.`);
  }

  if (path !== expectedPath || !path.startsWith("/") || path.startsWith("//")
      || path.includes("\\") || path.includes("?") || path.includes("#")
      || decodedPath.split("/").includes("..")) {
    throw new GatewayError(500, "INVALID_CONFIGURATION", `${name} possui caminho nao autorizado.`);
  }
  return path;
}

function validatedBindHost(value) {
  const host = String(value || "127.0.0.1").trim();
  if (!new Set(["127.0.0.1", "0.0.0.0"]).has(host)) {
    throw new GatewayError(500, "INVALID_CONFIGURATION", "BIND_HOST deve ser 127.0.0.1 ou 0.0.0.0.");
  }
  return host;
}

function createConfig(env = process.env, overrides = {}) {
  const mode = String(overrides.mode ?? env.GATEWAY_MODE ?? "mock").trim().toLowerCase();
  if (!new Set(["mock", "real"]).has(mode)) {
    throw new GatewayError(500, "INVALID_CONFIGURATION", "GATEWAY_MODE deve ser mock ou real.");
  }

  const nodeEnv = String(overrides.nodeEnv ?? env.NODE_ENV ?? "development").trim().toLowerCase();
  const authMode = String(overrides.authMode ?? env.AUTH_MODE ?? "unconfigured").trim().toLowerCase();
  if (!AUTH_MODES.includes(authMode)) {
    throw new GatewayError(500, "INVALID_CONFIGURATION", "AUTH_MODE deve ser unconfigured ou corporate.");
  }

  const mockScenario = String(overrides.mockScenario ?? env.MOCK_SCENARIO ?? "normal").trim().toLowerCase();
  const ymsMode = String(overrides.ymsMode ?? env.YMS_MODE ?? "disabled").trim().toLowerCase();
  if (!YMS_MODES.includes(ymsMode)) {
    throw new GatewayError(500, "INVALID_CONFIGURATION", "YMS_MODE deve ser disabled, mock ou provider.");
  }
  const configuredPort = Number(overrides.port ?? env.PORT ?? 8787);
  if (!Number.isSafeInteger(configuredPort) || configuredPort < 0 || configuredPort > 65535) {
    throw new GatewayError(500, "INVALID_CONFIGURATION", "PORT deve ser uma porta valida.");
  }

  return Object.freeze({
    port: configuredPort,
    bindHost: validatedBindHost(overrides.bindHost ?? env.BIND_HOST ?? "127.0.0.1"),
    nodeEnv,
    mode,
    authMode,
    mockScenario,
    ymsMode,
    allowedUpstreamHosts: new Set(UPSTREAM_HOST_ALLOWLIST),
    dispatchBaseUrl: validatedUpstreamBaseUrl(
      "DISPATCH_BASE_URL",
      overrides.dispatchBaseUrl ?? env.DISPATCH_BASE_URL ?? DEFAULT_DISPATCH_BASE_URL,
      nodeEnv
    ),
    customsBaseUrl: validatedUpstreamBaseUrl(
      "CUSTOMS_BASE_URL",
      overrides.customsBaseUrl ?? env.CUSTOMS_BASE_URL ?? DEFAULT_CUSTOMS_BASE_URL,
      nodeEnv
    ),
    dispatchPath: validatedUpstreamPath(
      "DISPATCH_PATH",
      overrides.dispatchPath ?? env.DISPATCH_PATH ?? DEFAULT_DISPATCH_PATH,
      DEFAULT_DISPATCH_PATH
    ),
    customsPath: validatedUpstreamPath(
      "CUSTOMS_PATH",
      overrides.customsPath ?? env.CUSTOMS_PATH ?? DEFAULT_CUSTOMS_PATH,
      DEFAULT_CUSTOMS_PATH
    ),
    allowedOrigins: configuredOrigins(env, overrides, nodeEnv, mode),
    allowedFacilityIds: validatedSet(
      "ALLOWED_FACILITY_IDS",
      overrides.allowedFacilityIds ?? csvValues(env.ALLOWED_FACILITY_IDS, "SSP15"),
      /^[A-Za-z0-9_-]{1,32}$/
    ),
    allowedSiteIds: validatedSet(
      "ALLOWED_SITE_IDS",
      overrides.allowedSiteIds ?? csvValues(env.ALLOWED_SITE_IDS, "MLB"),
      /^[A-Za-z0-9_-]{1,16}$/
    ),
    allowedGroupIds: validatedSet(
      "ALLOWED_GROUP_IDS",
      overrides.allowedGroupIds ?? (
        env.ALLOWED_GROUP_IDS
          ? csvValues(env.ALLOWED_GROUP_IDS, "")
          : isSafeCloudMock(env, nodeEnv, mode)
            ? ["TESTE"]
            : nodeEnv === "production" ? [] : ["TESTE"]
      ),
      /^[A-Za-z0-9_-]{1,40}$/
    ),
    allowedCycles: validatedSet(
      "ALLOWED_CYCLES",
      overrides.allowedCycles ?? csvValues(env.ALLOWED_CYCLES, "AM1"),
      /^[A-Za-z0-9_-]{1,16}$/
    ),
    allowedWaves: validatedSet(
      "ALLOWED_WAVES",
      overrides.allowedWaves ?? csvValues(env.ALLOWED_WAVES, "1,2,3,4,5"),
      /^[A-Za-z0-9_-]{1,8}$/,
      10
    ),
    upstreamTimeoutMs: positiveInteger(
      overrides.upstreamTimeoutMs ?? env.UPSTREAM_TIMEOUT_MS,
      1000,
      "UPSTREAM_TIMEOUT_MS"
    ),
    maxResponseBytes: positiveInteger(
      overrides.maxResponseBytes ?? env.MAX_RESPONSE_BYTES,
      262144,
      "MAX_RESPONSE_BYTES"
    ),
    mockDelayMs: positiveInteger(overrides.mockDelayMs ?? env.MOCK_DELAY_MS, 5, "MOCK_DELAY_MS"),
    mockTimeoutDelayMs: positiveInteger(
      overrides.mockTimeoutDelayMs ?? env.MOCK_TIMEOUT_DELAY_MS,
      2500,
      "MOCK_TIMEOUT_DELAY_MS"
    )
  });
}

module.exports = {
  AUTH_MODES,
  YMS_MODES,
  UPSTREAM_HOST_ALLOWLIST,
  createConfig,
  validatedUpstreamBaseUrl,
  validatedUpstreamPath,
  validatedBindHost,
  isSafeCloudMock
};
