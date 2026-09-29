"use strict";

function text(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "value" in value) return String(value.value ?? "").trim();
  return String(value).trim();
}

function timestampMs(value) {
  const raw = text(value);
  if (!raw) return null;

  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw)
    ? raw.replace(" ", "T") + "Z"
    : raw;

  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function elapsedSeconds(startValue, endValue, nowMs = Date.now()) {
  const start = timestampMs(startValue);
  if (start === null) return "";

  const explicitEnd = timestampMs(endValue);
  const end = explicitEnd === null ? nowMs : explicitEnd;
  if (!Number.isFinite(end) || end < start) return "";

  return Math.max(0, Math.floor((end - start) / 1000));
}

function dockFromLoadingZone(value) {
  const raw = text(value);
  if (!raw) return "";
  if (/^\d{1,3}$/.test(raw)) return String(Number(raw));

  const match = raw.match(/(?:doca|dock|zona|zone)\s*[-_:]?\s*(\d{1,3})/i);
  return match ? String(Number(match[1])) : "";
}

function operationalProcess(stage) {
  const value = text(stage).toLowerCase();
  return new Set([
    "waiting_customs",
    "customs_in_progress",
    "loading_packages",
    "dispatched"
  ]).has(value) ? value : "";
}

function phaseStart(row) {
  const stage = text(row.lifecycle_stage).toLowerCase();
  if (stage === "waiting_customs") return row.customs_queue_at;
  if (stage === "customs_in_progress") return row.customs_started_at || row.customs_queue_at;
  if (stage === "loading_packages") return row.loading_started_at;
  if (stage === "at_dock") return row.dock_in_at;
  if (stage === "checked_in") return row.yms_check_in_at;
  return "";
}

function ymsToOperationalRow(row = {}, nowMs = Date.now()) {
  const routeName = text(row.route_name);
  if (!routeName) return null;

  const stage = text(row.lifecycle_stage).toLowerCase();
  const completedAt = stage === "dispatched"
    ? (row.gate_out_at || row.dock_out_at || row.latest_event_at)
    : "";

  return {
    route_name: routeName,
    route_id: "",
    process: operationalProcess(stage),
    dock_number: dockFromLoadingZone(row.loading_zone_name),
    start_time: stage === "dispatched"
      ? ""
      : elapsedSeconds(phaseStart(row), "", nowMs),
    total_elapsed_time: elapsedSeconds(
      row.yms_check_in_at || row.dock_in_at,
      completedAt,
      nowMs
    )
  };
}

function ymsToOperationalRows(rows = [], nowMs = Date.now()) {
  return rows
    .map(row => ymsToOperationalRow(row, nowMs))
    .filter(Boolean);
}

function ymsToCustomsRow(row = {}) {
  const routeName = text(row.route_name);
  const stage = text(row.lifecycle_stage).toLowerCase();
  if (!routeName || !new Set(["waiting_customs", "customs_in_progress"]).has(stage)) return null;

  return {
    route_name: routeName,
    route_id: "",
    status: stage === "customs_in_progress" ? "in_progress" : "waiting",
    process: stage,
    operator_name: "",
    audit_time: "",
    aduanaUnidades: "",
    aduanaBipadas: "",
    driver_name: "",
    carrier_name: text(row.carrier_name),
    plate: text(row.plate)
  };
}

function ymsToCustomsRows(rows = []) {
  return rows.map(ymsToCustomsRow).filter(Boolean);
}

module.exports = {
  elapsedSeconds,
  dockFromLoadingZone,
  operationalProcess,
  ymsToOperationalRow,
  ymsToOperationalRows,
  ymsToCustomsRow,
  ymsToCustomsRows
};
