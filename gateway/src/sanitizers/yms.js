"use strict";

const YMS_PUBLIC_FIELDS = Object.freeze([
  "facility_id",
  "operation_date",
  "cycle_name",
  "wave_number",
  "route_name",
  "planned_route_name",
  "route_changed_from_plan",
  "carrier_name",
  "planned_carrier_name",
  "plate",
  "loading_zone_name",
  "parking_area_name",
  "yms_check_in_at",
  "dock_in_at",
  "customs_queue_at",
  "customs_started_at",
  "customs_last_activity_at",
  "loading_started_at",
  "dock_out_at",
  "gate_out_at",
  "latest_event_name",
  "latest_status",
  "latest_purpose_status",
  "latest_event_at",
  "lifecycle_stage",
  "dispatch_confirmed",
  "terminal_exception"
]);

function sanitizeYms(row = {}) {
  return Object.fromEntries(YMS_PUBLIC_FIELDS.map(field => [field, row[field] ?? ""]));
}

module.exports = { YMS_PUBLIC_FIELDS, sanitizeYms };
