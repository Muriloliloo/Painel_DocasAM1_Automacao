"use strict";

const { fetchDispatch } = require("../adapters/dispatch");
const { fetchCustoms } = require("../adapters/customs");
const { fetchYms } = require("../adapters/yms");
const { sanitizeDispatch } = require("../sanitizers/dispatch");
const { sanitizeCustoms } = require("../sanitizers/customs");
const { sanitizeYms } = require("../sanitizers/yms");
const { buildSourceComparison } = require("./source-comparison");
const {
  ymsToOperationalRows,
  ymsToCustomsRows
} = require("./yms-operational-bridge");
const { GatewayError } = require("../errors");

async function withinTimeout(config, operation) {
  const controller = new AbortController();
  let timer;

  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new GatewayError(504, "UPSTREAM_TIMEOUT", "Tempo limite das fontes internas excedido."));
        }, config.upstreamTimeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function sourceFailure(result, sourceName) {
  if (result.status === "fulfilled") return null;
  const reason = result.reason;
  if (reason instanceof GatewayError) return reason;
  return new GatewayError(502, "UPSTREAM_UNAVAILABLE", `Falha segura na fonte ${sourceName}.`);
}

async function acquireSources({
  config,
  scenario,
  waves,
  facilityId,
  groupId,
  siteId,
  cycle,
  timezone,
  dependencies = {}
}) {
  return withinTimeout(config, signal => {
    if (config.snapshotSourceMode === "yms-primary") {
      return Promise.allSettled([
        fetchYms({
          config,
          scenario,
          waves,
          facilityId,
          cycle,
          timezone,
          signal,
          ...dependencies
        })
      ]).then(results => ({ names: ["yms"], results }));
    }

    const names = ["dispatch", "aduana"];
    const tasks = [
      fetchDispatch({
        config,
        scenario,
        waves,
        facilityId,
        groupId,
        siteId,
        signal,
        ...dependencies
      }),
      fetchCustoms({
        config,
        scenario,
        timezone,
        signal,
        ...dependencies
      })
    ];

    if (config.ymsMode !== "disabled") {
      names.push("yms");
      tasks.push(fetchYms({
        config,
        scenario,
        waves,
        facilityId,
        cycle,
        timezone,
        signal,
        ...dependencies
      }));
    }

    return Promise.allSettled(tasks).then(results => ({ names, results }));
  });
}

async function buildSnapshot(options) {
  const { config, scenario } = options;
  const { names, results } = await acquireSources(options);
  const byName = Object.fromEntries(names.map((name, index) => [name, results[index]]));

  const failures = Object.fromEntries(
    names.map(name => [name, sourceFailure(byName[name], name)])
  );
  const primaryFailure = names.map(name => failures[name]).find(Boolean);

  if (primaryFailure) {
    throw new GatewayError(
      primaryFailure.status,
      primaryFailure.code,
      primaryFailure.message,
      {
        sources: Object.fromEntries(
          names.map(name => [name, failures[name] ? "error" : "ok"])
        )
      }
    );
  }

  const ymsEnabled = names.includes("yms");
  const yms = ymsEnabled ? byName.yms.value.map(sanitizeYms) : [];

  if (config.snapshotSourceMode === "yms-primary") {
    const operacional = ymsToOperationalRows(yms);
    const aduana = ymsToCustomsRows(yms);

    return {
      snapshotComplete: true,
      emptyConfirmed: yms.length === 0,
      sourceMode: "yms-primary",
      sources: {
        dispatch: "derived_yms",
        aduana: "derived_yms",
        yms: "ok"
      },
      operacional,
      aduana,
      yms,
      comparison: buildSourceComparison({ operacional, aduana, yms })
    };
  }

  const operacional = byName.dispatch.value.map(sanitizeDispatch);
  const aduana = byName.aduana.value.map(sanitizeCustoms);

  const allActiveSourcesEmpty = operacional.length === 0
    && aduana.length === 0
    && (!ymsEnabled || yms.length === 0);

  const payload = {
    snapshotComplete: true,
    emptyConfirmed: scenario === "empty-confirmed" && allActiveSourcesEmpty,
    sourceMode: "dispatch-customs",
    sources: {
      dispatch: "ok",
      aduana: "ok"
    },
    operacional,
    aduana
  };

  if (ymsEnabled) {
    payload.sources.yms = "ok";
    payload.yms = yms;
    payload.comparison = buildSourceComparison({ operacional, aduana, yms });
  }

  return payload;
}

async function buildDispatchSnapshot({
  config,
  scenario,
  wave,
  facilityId,
  groupId,
  siteId,
  dependencies = {}
}) {
  const rows = await withinTimeout(config, signal => fetchDispatch({
    config,
    scenario,
    waves: [wave],
    facilityId,
    groupId,
    siteId,
    signal,
    ...dependencies
  }));
  const operacional = rows.map(sanitizeDispatch);
  return {
    snapshotComplete: true,
    emptyConfirmed: scenario === "empty-confirmed" && operacional.length === 0,
    sources: { dispatch: "ok" },
    operacional
  };
}

async function buildCustomsSnapshot({ config, scenario, timezone, dependencies = {} }) {
  const rows = await withinTimeout(config, signal => fetchCustoms({
    config,
    scenario,
    timezone,
    signal,
    ...dependencies
  }));
  const aduana = rows.map(sanitizeCustoms);
  return {
    snapshotComplete: true,
    emptyConfirmed: scenario === "empty-confirmed" && aduana.length === 0,
    sources: { aduana: "ok" },
    aduana
  };
}


async function buildYmsSnapshot({
  config,
  scenario,
  waves,
  facilityId,
  cycle,
  timezone,
  dependencies = {}
}) {
  if (config.ymsMode === "disabled") {
    throw new GatewayError(503, "YMS_DISABLED", "Fonte YMS desabilitada.");
  }

  const rows = await withinTimeout(config, signal => fetchYms({
    config,
    scenario,
    waves,
    facilityId,
    cycle,
    timezone,
    signal,
    ...dependencies
  }));

  const yms = rows.map(sanitizeYms);

  return {
    snapshotComplete: true,
    emptyConfirmed: scenario === "empty-confirmed" && yms.length === 0,
    sources: { yms: "ok" },
    yms
  };
}

module.exports = {
  buildSnapshot,
  buildDispatchSnapshot,
  buildCustomsSnapshot,
  buildYmsSnapshot
};
