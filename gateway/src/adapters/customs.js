"use strict";

const { GatewayError } = require("../errors");
const { createAuthProvider, getAuthContext } = require("../auth");
const { createUpstreamClient } = require("../http/upstream-client");

const CUSTOMS_QUERY_KEYS = Object.freeze(["auditType", "timezone"]);

const CUSTOMS_IN_PROGRESS = Object.freeze({
  route_name: "VJ3_AM1",
  route_id: 502731583004,
  status: "in_progress",
  process: "customs_in_progress",
  operator_name: "REP TESTE",
  audit_time: 18,
  aduanaUnidades: 190,
  aduanaBipadas: 3,
  driver_name: "MOTORISTA TESTE",
  carrier_name: "TRANSPORTADORA TESTE",
  plate: "ABC1D23"
});

const FLOW_CUSTOMS_ROUTE = Object.freeze({
  ...CUSTOMS_IN_PROGRESS,
  route_name: "G5_AM1",
  route_id: 599000000001,
  carrier_name: "BASEPEX ENCOM"
});

function delay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      const error = new Error("Operacao cancelada.");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
  });
}

function customsRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.audits)) return payload.audits;
  throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE", "Resposta Aduana invalida.");
}

function normalizeCustomsRow(raw = {}) {
  const hasUnits = Array.isArray(raw.units);
  const units = hasUnits ? raw.units : [];
  const auditedUnits = units.filter(unit => String(unit?.status || "").toLowerCase() === "audited").length;

  return {
    route_name: raw.route_name || raw.routeName || raw.rota
      || raw.driver?.cluster_id || raw.driver?.clusterId || "",
    route_id: raw.route_id || raw.routeId || raw.driver?.route_id || "",
    status: raw.status ?? "",
    process: raw.process ?? "",
    operator_name: raw.operator_name ?? "",
    audit_time: raw.audit_time ?? "",
    aduanaUnidades: raw.aduanaUnidades ?? "",
    aduanaBipadas: raw.aduanaBipadas ?? (hasUnits ? auditedUnits : ""),
    driver_name: raw.driver_name ?? "",
    carrier_name: raw.carrier_name ?? "",
    plate: raw.plate ?? ""
  };
}

function selectRows(scenario) {
  if (new Set(["empty-unconfirmed", "empty-confirmed", "loading", "dispatched", "flow-waiting"]).has(scenario)) return [];
  if (scenario === "flow-customs") {
    return [{ ...FLOW_CUSTOMS_ROUTE }];
  }
  if (new Set(["flow-loading", "flow-dispatched"]).has(scenario)) {
    return [{
      ...FLOW_CUSTOMS_ROUTE,
      status: "completed",
      process: "customs_completed",
      audit_time: 42,
      aduanaBipadas: 190
    }];
  }
  if (scenario === "customs-complete") {
    return [{
      ...CUSTOMS_IN_PROGRESS,
      status: "completed",
      process: "customs_completed",
      audit_time: 42,
      aduanaBipadas: 190
    }];
  }
  return [{ ...CUSTOMS_IN_PROGRESS }];
}

async function fetchRealCustoms({ config, timezone, signal, authProvider, upstreamClient }) {
  const authorized = await getAuthContext(authProvider || createAuthProvider(config));
  const client = upstreamClient || createUpstreamClient({ config });
  const payload = await client.get({
    baseUrl: config.customsBaseUrl,
    path: config.customsPath,
    query: { auditType: "driver", timezone },
    allowedQueryKeys: CUSTOMS_QUERY_KEYS,
    authContext: authorized,
    signal
  });
  return customsRows(payload).map(normalizeCustomsRow);
}

async function fetchCustoms(options) {
  const { config, scenario, signal } = options;
  if (config.mode === "real") return fetchRealCustoms(options);
  if (scenario === "failure-customs") {
    throw new GatewayError(502, "CUSTOMS_UPSTREAM_FAILURE", "Aduana indisponivel no cenario mock.");
  }

  const delayMs = scenario === "timeout" ? config.mockTimeoutDelayMs : config.mockDelayMs;
  await delay(delayMs, signal);
  return selectRows(scenario).map(normalizeCustomsRow);
}

module.exports = {
  CUSTOMS_QUERY_KEYS,
  CUSTOMS_IN_PROGRESS,
  FLOW_CUSTOMS_ROUTE,
  customsRows,
  normalizeCustomsRow,
  fetchCustoms,
  fetchRealCustoms
};
