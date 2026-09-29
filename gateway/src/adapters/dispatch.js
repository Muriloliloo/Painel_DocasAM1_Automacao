"use strict";

const { GatewayError } = require("../errors");
const { createAuthProvider, getAuthContext } = require("../auth");
const { createUpstreamClient } = require("../http/upstream-client");

const DISPATCH_QUERY_KEYS = Object.freeze(["facilityId", "groupId", "siteId", "wave"]);

const DISPATCH_BY_WAVE = Object.freeze({
  "1": {
    route_name: "VT9_AM1",
    route_id: 502731583001,
    process: "loading_packages",
    dock_number: 3,
    start_time: 60,
    total_elapsed_time: 240
  },
  "2": {
    route_name: "VJ3_AM1",
    route_id: 502731583004,
    process: "waiting_customs",
    dock_number: 2,
    start_time: 35,
    total_elapsed_time: 120
  },
  "3": {
    route_name: "VT12_AM1",
    route_id: 502731588003,
    process: "dispatched",
    dock_number: 1,
    start_time: 20,
    total_elapsed_time: 95
  }
});

const FLOW_ROUTE = Object.freeze({
  route_name: "G5_AM1",
  route_id: 599000000001,
  dock_number: 6
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

function dispatchRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  throw new GatewayError(502, "UPSTREAM_INVALID_RESPONSE", "Resposta Dispatch invalida.");
}

function selectRows(scenario, waves) {
  if (new Set(["empty-unconfirmed", "empty-confirmed"]).has(scenario)) return [];

  if (scenario === "flow-waiting") {
    return waves.includes("1") ? [{ ...FLOW_ROUTE, process: "waiting_customs", start_time: 5, total_elapsed_time: 35 }] : [];
  }
  if (scenario === "flow-customs") {
    return waves.includes("1") ? [{ ...FLOW_ROUTE, process: "customs_in_progress", start_time: 12, total_elapsed_time: 47 }] : [];
  }
  if (scenario === "flow-loading") {
    return waves.includes("1") ? [{ ...FLOW_ROUTE, process: "loading_packages", start_time: 18, total_elapsed_time: 65 }] : [];
  }
  if (scenario === "flow-dispatched") {
    return waves.includes("1") ? [{ ...FLOW_ROUTE, process: "dispatched", start_time: 7, total_elapsed_time: 72 }] : [];
  }

  if (scenario === "loading") return [{ ...DISPATCH_BY_WAVE["1"] }];
  if (scenario === "dispatched") return [{ ...DISPATCH_BY_WAVE["3"] }];
  if (new Set(["customs-in-progress", "customs-complete"]).has(scenario)) {
    return [{ ...DISPATCH_BY_WAVE["2"] }];
  }

  return waves.flatMap(wave => DISPATCH_BY_WAVE[wave] ? [{ ...DISPATCH_BY_WAVE[wave] }] : []);
}

async function fetchRealDispatch({
  config,
  facilityId,
  groupId,
  siteId,
  waves,
  signal,
  authProvider,
  upstreamClient
}) {
  const authorized = await getAuthContext(authProvider || createAuthProvider(config));
  const client = upstreamClient || createUpstreamClient({ config });
  const payloads = await Promise.all(waves.map(wave => client.get({
    baseUrl: config.dispatchBaseUrl,
    path: config.dispatchPath,
    query: { facilityId, groupId, siteId, wave },
    allowedQueryKeys: DISPATCH_QUERY_KEYS,
    authContext: authorized,
    signal
  })));
  return payloads.flatMap(dispatchRows);
}

async function fetchDispatch(options) {
  const { config, scenario, waves, signal } = options;
  if (config.mode === "real") return fetchRealDispatch(options);
  if (scenario === "failure-dispatch") {
    throw new GatewayError(502, "DISPATCH_UPSTREAM_FAILURE", "Dispatch indisponivel no cenario mock.");
  }

  const delayMs = scenario === "timeout" ? config.mockTimeoutDelayMs : config.mockDelayMs;
  await delay(delayMs, signal);
  return selectRows(scenario, waves);
}

module.exports = { DISPATCH_QUERY_KEYS, DISPATCH_BY_WAVE, FLOW_ROUTE, dispatchRows, fetchDispatch, fetchRealDispatch };
