"use strict";

const { GatewayError } = require("../errors");

const TERMINAL_EVENTS = new Set(["killed", "canceled", "skipped"]);

function asText(value) {
  return value === null || value === undefined ? "" : String(value);
}

function asBoolean(value) {
  if (value === true || value === false) return value;
  if (value === 1 || value === "1") return true;
  if (value === 0 || value === "0" || value === "" || value === null || value === undefined) return false;
  return String(value).toLowerCase() === "true";
}

function classifyLifecycleStage(row = {}) {
  const eventName = asText(row.latest_event_name).toLowerCase();
  const latestStatus = asText(row.latest_status).toUpperCase();
  const purposeStatus = asText(row.latest_purpose_status).toUpperCase();

  if (TERMINAL_EVENTS.has(eventName)) return "terminal_exception";
  if (row.gate_out_at || (eventName === "gate-out" && latestStatus === "PROCESS_FINISHED")) {
    return "dispatched";
  }
  if (purposeStatus === "DOING_AUDIT") return "customs_in_progress";
  if (purposeStatus === "WAITING_FOR_AUDIT") return "waiting_customs";
  if (purposeStatus === "LOADING_PACKAGES_STARTED" || row.loading_started_at) return "loading_packages";
  if (row.dock_in_at) return "at_dock";
  if (row.yms_check_in_at) return "checked_in";
  return "unknown";
}

function normalizeYmsRow(raw = {}) {
  const lifecycleStage = classifyLifecycleStage(raw);

  return {
    facility_id: asText(raw.facility_id),
    operation_date: asText(raw.operation_date),
    cycle_name: asText(raw.cycle_name),
    wave_number: raw.wave_number ?? "",
    source_process_id: asText(raw.process_id ?? raw.source_process_id),
    yms_executed_route_id: asText(raw.executed_route_id ?? raw.yms_executed_route_id),
    yms_planned_route_id: asText(raw.planned_route_id ?? raw.yms_planned_route_id),
    route_name: asText(raw.route_name),
    planned_route_name: asText(raw.planned_route_name),
    route_changed_from_plan: asBoolean(raw.route_changed_from_plan),
    route_resolution_status: asText(raw.route_resolution_status),
    carrier_name: asText(raw.carrier_name),
    planned_carrier_name: asText(raw.planned_carrier_name),
    plate: asText(raw.plate),
    loading_zone_name: asText(raw.loading_zone_name),
    parking_area_name: asText(raw.parking_area_name),
    yms_check_in_at: asText(raw.yms_check_in_at),
    dock_in_at: asText(raw.dock_in_at),
    customs_queue_at: asText(raw.customs_queue_at),
    customs_started_at: asText(raw.customs_started_at),
    customs_last_activity_at: asText(raw.customs_last_activity_at),
    loading_started_at: asText(raw.loading_started_at),
    dock_out_at: asText(raw.dock_out_at),
    gate_out_at: asText(raw.gate_out_at),
    latest_event_name: asText(raw.latest_event_name),
    latest_status: asText(raw.latest_status),
    latest_purpose_status: asText(raw.latest_purpose_status),
    latest_event_at: asText(raw.latest_event_at),
    lifecycle_stage: lifecycleStage,
    dispatch_confirmed: lifecycleStage === "dispatched",
    terminal_exception: lifecycleStage === "terminal_exception"
  };
}


function ymsRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.rows)) return payload.rows;
  throw new GatewayError(502, "YMS_INVALID_RESPONSE", "Resposta YMS/BigQuery invalida.");
}

async function fetchYms({
  config,
  scenario,
  facilityId,
  cycle,
  waves,
  timezone,
  operationDate,
  signal,
  ymsProvider
}) {
  if (config.ymsMode === "disabled") return [];

  if (!ymsProvider || typeof ymsProvider.query !== "function") {
    throw new GatewayError(
      503,
      "YMS_PROVIDER_NOT_CONFIGURED",
      "Provider YMS/BigQuery nao configurado."
    );
  }

  const payload = await ymsProvider.query({
    facilityId,
    cycle,
    waves,
    scenario,
    timezone,
    operationDate,
    signal
  });

  return ymsRows(payload).map(normalizeYmsRow);
}

module.exports = {
  TERMINAL_EVENTS,
  classifyLifecycleStage,
  normalizeYmsRow,
  ymsRows,
  fetchYms
};
