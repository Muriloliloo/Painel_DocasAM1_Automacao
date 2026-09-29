"use strict";

const DISPATCH_FIELDS = Object.freeze([
  "route_name",
  "route_id",
  "process",
  "dock_number",
  "start_time",
  "total_elapsed_time"
]);

function sanitizeDispatch(row = {}) {
  return Object.fromEntries(DISPATCH_FIELDS.map(field => [field, row[field] ?? ""]));
}

module.exports = { DISPATCH_FIELDS, sanitizeDispatch };
