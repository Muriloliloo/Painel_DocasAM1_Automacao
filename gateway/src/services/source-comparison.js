"use strict";

function text(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function routeKey(value) {
  return text(value).toUpperCase();
}

function dockKey(value) {
  const raw = text(value);
  if (!raw) return "";
  if (/^\d+$/.test(raw)) return String(Number(raw));
  return raw.toUpperCase();
}

function stageFromDispatch(row = {}) {
  return text(row.process || row.status).toLowerCase();
}

function stageFromCustoms(row = {}) {
  return text(row.process || row.status).toLowerCase();
}

function stageFromYms(row = {}) {
  return text(row.lifecycle_stage).toLowerCase();
}

const STAGE_RANK = Object.freeze({
  checked_in: 1,
  at_dock: 2,
  waiting_customs: 3,
  customs_in_progress: 4,
  customs_completed: 4.5,
  loading_packages: 5,
  dispatched: 6
});

function canonicalStage(value) {
  const stage = text(value).toLowerCase();
  if (!stage) return "";

  const aliases = {
    waiting_for_audit: "waiting_customs",
    doing_audit: "customs_in_progress",
    in_progress: "customs_in_progress",
    completed: "customs_completed",
    process_finished: "dispatched"
  };

  return aliases[stage] || stage;
}

function comparableStageRank(value) {
  const canonical = canonicalStage(value);
  return Object.prototype.hasOwnProperty.call(STAGE_RANK, canonical)
    ? STAGE_RANK[canonical]
    : null;
}

function leadObservation(dispatchStage, ymsStage) {
  const dispatchRank = comparableStageRank(dispatchStage);
  const ymsRank = comparableStageRank(ymsStage);

  if (dispatchRank === null || ymsRank === null) return "insufficient";
  if (dispatchRank === ymsRank) return "aligned";
  return ymsRank > dispatchRank ? "yms_ahead" : "dispatch_ahead";
}

function diagnosticFlags({ dispatch, customs, yms, stageComparisonValue, dockComparisonValue, leadObservationValue }) {
  const flags = [];

  if ([dispatch.present, customs.present, yms.present].filter(Boolean).length < 3) {
    flags.push("missing_source");
  }
  if (dockComparisonValue === "different") flags.push("dock_divergence");
  if (stageComparisonValue === "mixed") flags.push("stage_divergence");
  if (leadObservationValue === "yms_ahead") flags.push("yms_ahead");
  if (leadObservationValue === "dispatch_ahead") flags.push("dispatch_ahead");
  if (yms.terminal_exception === true) flags.push("yms_terminal_exception");

  if (!flags.length) flags.push("no_divergence_observed");
  return flags;
}

function stageComparison(stages) {
  const values = stages.filter(Boolean);
  if (values.length < 2) return "insufficient";
  return new Set(values).size === 1 ? "all_equal" : "mixed";
}

function dockComparison(dispatchDock, ymsZone) {
  const dispatchKey = dockKey(dispatchDock);
  const ymsKey = dockKey(ymsZone);
  if (!dispatchKey || !ymsKey) return "insufficient";
  return dispatchKey === ymsKey ? "same" : "different";
}

function publicDispatch(row) {
  if (!row) return { present: false, process: "", dock_number: "" };
  return {
    present: true,
    process: text(row.process || row.status),
    dock_number: text(row.dock_number)
  };
}

function publicCustoms(row) {
  if (!row) return { present: false, process: "", status: "" };
  return {
    present: true,
    process: text(row.process),
    status: text(row.status)
  };
}

function publicYms(row) {
  if (!row) {
    return {
      present: false,
      lifecycle_stage: "",
      loading_zone_name: "",
      dispatch_confirmed: false,
      terminal_exception: false
    };
  }

  return {
    present: true,
    lifecycle_stage: text(row.lifecycle_stage),
    loading_zone_name: text(row.loading_zone_name),
    dispatch_confirmed: row.dispatch_confirmed === true,
    terminal_exception: row.terminal_exception === true
  };
}

function indexByRoute(rows = []) {
  const index = new Map();
  for (const row of rows) {
    const key = routeKey(row?.route_name);
    if (!key) continue;
    index.set(key, row);
  }
  return index;
}

function buildSourceComparison({ operacional = [], aduana = [], yms = [] } = {}) {
  const dispatchByRoute = indexByRoute(operacional);
  const customsByRoute = indexByRoute(aduana);
  const ymsByRoute = indexByRoute(yms);

  const keys = new Set([
    ...dispatchByRoute.keys(),
    ...customsByRoute.keys(),
    ...ymsByRoute.keys()
  ]);

  const routes = Array.from(keys)
    .sort((left, right) => left.localeCompare(right))
    .map(key => {
      const dispatchRow = dispatchByRoute.get(key);
      const customsRow = customsByRoute.get(key);
      const ymsRow = ymsByRoute.get(key);

      const dispatch = publicDispatch(dispatchRow);
      const customs = publicCustoms(customsRow);
      const ymsPublic = publicYms(ymsRow);

      const stages = [
        dispatch.present ? stageFromDispatch(dispatchRow) : "",
        customs.present ? stageFromCustoms(customsRow) : "",
        ymsPublic.present ? stageFromYms(ymsRow) : ""
      ].filter(Boolean);

      const stageComparisonValue = stageComparison(stages);
      const dockComparisonValue = dockComparison(dispatch.dock_number, ymsPublic.loading_zone_name);
      const leadObservationValue = leadObservation(
        dispatch.present ? stageFromDispatch(dispatchRow) : "",
        ymsPublic.present ? stageFromYms(ymsRow) : ""
      );

      return {
        route_name: text(
          dispatchRow?.route_name
          || customsRow?.route_name
          || ymsRow?.route_name
          || key
        ),
        source_count: [dispatch.present, customs.present, ymsPublic.present].filter(Boolean).length,
        dispatch,
        aduana: customs,
        yms: ymsPublic,
        stage_comparison: stageComparisonValue,
        observed_stages: Array.from(new Set(stages)),
        dock_comparison: dockComparisonValue,
        lead_observation: leadObservationValue,
        diagnostic_flags: diagnosticFlags({
          dispatch,
          customs,
          yms: ymsPublic,
          stageComparisonValue,
          dockComparisonValue,
          leadObservationValue
        })
      };
    });

  const summary = {
    total_routes: routes.length,
    with_dispatch: routes.filter(row => row.dispatch.present).length,
    with_aduana: routes.filter(row => row.aduana.present).length,
    with_yms: routes.filter(row => row.yms.present).length,
    all_three: routes.filter(row => row.source_count === 3).length,
    stage_comparable: routes.filter(row => row.stage_comparison !== "insufficient").length,
    stage_all_equal: routes.filter(row => row.stage_comparison === "all_equal").length,
    stage_mixed: routes.filter(row => row.stage_comparison === "mixed").length,
    dock_comparable: routes.filter(row => row.dock_comparison !== "insufficient").length,
    dock_same: routes.filter(row => row.dock_comparison === "same").length,
    dock_different: routes.filter(row => row.dock_comparison === "different").length,
    yms_ahead: routes.filter(row => row.lead_observation === "yms_ahead").length,
    dispatch_ahead: routes.filter(row => row.lead_observation === "dispatch_ahead").length,
    aligned_dispatch_yms: routes.filter(row => row.lead_observation === "aligned").length,
    missing_source: routes.filter(row => row.diagnostic_flags.includes("missing_source")).length,
    yms_terminal_exception: routes.filter(row => row.diagnostic_flags.includes("yms_terminal_exception")).length
  };

  return { summary, routes };
}

module.exports = {
  STAGE_RANK,
  canonicalStage,
  comparableStageRank,
  leadObservation,
  buildSourceComparison,
  dockComparison,
  stageComparison
};
