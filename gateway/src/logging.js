"use strict";

const SENSITIVE_LOG_KEY = /authorization|cookies?|tokens?|secrets?|passwords?|csrf|api[-_]?keys?|apikey|client[-_]?secrets?|credentials?|headers?/i;
const REDACTED = "[REDACTED]";

function redactForLog(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map(item => redactForLog(item, seen));
  }

  return Object.fromEntries(Object.entries(value).map(([key, nestedValue]) => [
    key,
    SENSITIVE_LOG_KEY.test(key) ? REDACTED : redactForLog(nestedValue, seen)
  ]));
}

function createSafeLogger(target = console) {
  const safeCall = method => (...values) => {
    if (typeof target?.[method] !== "function") return;
    target[method](...values.map(value => redactForLog(value)));
  };

  return Object.freeze({
    info: safeCall("info"),
    warn: safeCall("warn"),
    error: safeCall("error")
  });
}

module.exports = { REDACTED, createSafeLogger, redactForLog };
