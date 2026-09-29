"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { GatewayError } = require("../errors");

const RUNTIME_SQL_PATH = path.resolve(__dirname, "../../sql/yms-route-lifecycle-runtime.sql");
const OPERATION_DATE_CACHE_MS = 5 * 60 * 1000;
const OPERATION_DATE_SQL = `
SELECT MAX(DATE(CYCLE_SCHEDULED_TO)) AS operation_date
FROM \`meli-bi-data.WHOWNER.BT_CYCLE_SUMMARY_LM\`
WHERE LOGISTIC_CENTER_ID = @facility_id
  AND CYCLE_NAME = @cycle_name
  AND SAFE_CAST(POSITION AS INT64) IN UNNEST(@wave_numbers)
  AND DATE(CYCLE_SCHEDULED_TO)
      BETWEEN DATE_SUB(@reference_date, INTERVAL 1 DAY)
          AND @reference_date
`;

function loadRuntimeSql() {
  return fs.readFileSync(RUNTIME_SQL_PATH, "utf8");
}

function validateOperationDate(value) {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new GatewayError(400, "INVALID_OPERATION_DATE", "operationDate deve usar YYYY-MM-DD.");
  }
  return text;
}

function currentDateInTimeZone(timezone = "America/Sao_Paulo", now = new Date()) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(now);
  } catch {
    throw new GatewayError(400, "INVALID_QUERY", "timezone invalido para YMS.");
  }

  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return validateOperationDate(`${values.year}-${values.month}-${values.day}`);
}

function validateWaveNumbers(values) {
  const waves = Array.from(new Set((Array.isArray(values) ? values : [])
    .map(value => Number(value))
    .filter(value => Number.isSafeInteger(value) && value > 0)));

  if (!waves.length || waves.length > 10) {
    throw new GatewayError(400, "INVALID_QUERY", "waves invalidas para YMS.");
  }

  return waves;
}

function dateValue(value) {
  if (value && typeof value === "object" && "value" in value) return value.value;
  return value;
}

function createBigQueryYmsProvider({
  queryExecutor,
  sqlLoader = loadRuntimeSql,
  queryCacheMs = 45 * 1000,
  now = () => Date.now()
} = {}) {
  const configured = typeof queryExecutor === "function";
  const operationDateCache = new Map();
  const operationDateInFlight = new Map();
  const queryCache = new Map();
  const queryInFlight = new Map();

  if (!Number.isSafeInteger(queryCacheMs) || queryCacheMs <= 0 || queryCacheMs > 5 * 60 * 1000) {
    throw new GatewayError(
      500,
      "INVALID_CONFIGURATION",
      "YMS_QUERY_CACHE_MS deve ficar entre 1 e 300000 ms."
    );
  }

  function cloneRows(rows) {
    return Array.isArray(rows) ? rows.map(row => ({ ...row })) : rows;
  }

  async function resolveOperationDate({ facilityId, cycle, waves, referenceDate }) {
    const cacheKey = [facilityId, cycle, referenceDate, waves.join(",")].join("|");
    const cached = operationDateCache.get(cacheKey);
    if (cached && now() - cached.cachedAt < OPERATION_DATE_CACHE_MS) {
      return cached.operationDate;
    }

    if (operationDateInFlight.has(cacheKey)) {
      return operationDateInFlight.get(cacheKey);
    }

    const pending = (async () => {
      const rows = await queryExecutor({
        sql: OPERATION_DATE_SQL,
        params: {
          facility_id: String(facilityId),
          cycle_name: String(cycle),
          reference_date: referenceDate,
          wave_numbers: waves
        }
      });

      const resolved = dateValue(Array.isArray(rows) ? rows[0]?.operation_date : null);
      if (!resolved) {
        throw new GatewayError(
          503,
          "YMS_OPERATION_DATE_NOT_FOUND",
          "Nenhum ciclo YMS encontrado entre a data de referencia e D-1."
        );
      }

      const resolvedDate = validateOperationDate(resolved);
      operationDateCache.set(cacheKey, {
        operationDate: resolvedDate,
        cachedAt: now()
      });
      return resolvedDate;
    })();

    operationDateInFlight.set(cacheKey, pending);
    try {
      return await pending;
    } finally {
      operationDateInFlight.delete(cacheKey);
    }
  }

  return Object.freeze({
    mode: "provider",

    inspectConfiguration() {
      return configured
        ? { configured: true, mode: "provider" }
        : { configured: false, mode: "provider", reason: "YMS_PROVIDER_NOT_CONFIGURED" };
    },

    async query({ facilityId, cycle, waves, operationDate, timezone, signal }) {
      if (!configured) {
        throw new GatewayError(
          503,
          "YMS_PROVIDER_NOT_CONFIGURED",
          "Executor BigQuery YMS nao configurado."
        );
      }

      const sql = sqlLoader();
      if (!sql || !sql.includes("@facility_id") || !sql.includes("@operation_date")
          || !sql.includes("@wave_numbers")) {
        throw new GatewayError(
          500,
          "YMS_SQL_INVALID",
          "SQL runtime YMS invalido."
        );
      }

      const waveNumbers = validateWaveNumbers(waves);
      const resolvedOperationDate = operationDate
        ? validateOperationDate(operationDate)
        : await resolveOperationDate({
            facilityId,
            cycle,
            waves: waveNumbers,
            referenceDate: currentDateInTimeZone(timezone)
          });

      const cacheKey = [
        String(facilityId),
        String(cycle),
        resolvedOperationDate,
        waveNumbers.join(",")
      ].join("|");

      const cached = queryCache.get(cacheKey);
      if (cached && now() - cached.cachedAt < queryCacheMs) {
        return cloneRows(cached.rows);
      }

      if (queryInFlight.has(cacheKey)) {
        return cloneRows(await queryInFlight.get(cacheKey));
      }

      const pending = (async () => {
        const rows = await queryExecutor({
          sql,
          params: {
            facility_id: String(facilityId),
            cycle_name: String(cycle),
            operation_date: resolvedOperationDate,
            wave_numbers: waveNumbers
          }
        });

        if (!Array.isArray(rows)) {
          throw new GatewayError(
            502,
            "YMS_INVALID_RESPONSE",
            "Resposta YMS/BigQuery invalida."
          );
        }

        queryCache.set(cacheKey, {
          rows: cloneRows(rows),
          cachedAt: now()
        });
        return rows;
      })();

      queryInFlight.set(cacheKey, pending);
      try {
        return cloneRows(await pending);
      } finally {
        queryInFlight.delete(cacheKey);
      }
    }
  });
}

module.exports = {
  RUNTIME_SQL_PATH,
  OPERATION_DATE_SQL,
  OPERATION_DATE_CACHE_MS,
  loadRuntimeSql,
  validateOperationDate,
  validateWaveNumbers,
  currentDateInTimeZone,
  dateValue,
  createBigQueryYmsProvider
};
