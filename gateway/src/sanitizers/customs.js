"use strict";

const CUSTOMS_FIELDS = Object.freeze([
  "route_name",
  "route_id",
  "status",
  "process",
  "operator_name",
  "audit_time",
  "aduanaUnidades",
  "aduanaBipadas",
  "driver_name",
  "carrier_name",
  "plate"
]);

function sanitizeCustoms(row = {}) {
  return Object.fromEntries(CUSTOMS_FIELDS.map(field => [field, row[field] ?? ""]));
}

module.exports = { CUSTOMS_FIELDS, sanitizeCustoms };
