-- Diagnostico de prontidao YMS / BigQuery para automacao em tempo quase real.
-- Objetivos:
-- 1) medir defasagem dos eventos;
-- 2) descobrir eventos/status de Aduana;
-- 3) validar nomes de doca/loading zone;
-- 4) observar o comportamento dos ultimos 7 dias de AM1.
-- Somente leitura.

DECLARE facility_filter STRING DEFAULT 'SSP15';
DECLARE cycle_filter STRING DEFAULT 'AM1';
DECLARE timezone_name STRING DEFAULT 'America/Sao_Paulo';
DECLARE date_to DATE DEFAULT CURRENT_DATE(timezone_name);
DECLARE date_from DATE DEFAULT DATE_SUB(date_to, INTERVAL 7 DAY);

CREATE TEMP TABLE scoped_processes AS
SELECT DISTINCT
  plm.PROCESS_ID AS process_id,
  DATE(cs.CYCLE_SCHEDULED_TO) AS operation_date,
  SAFE_CAST(cs.POSITION AS INT64) AS wave_number
FROM `meli-bi-data.WHOWNER.BT_CYCLE_SUMMARY_LM` cs
JOIN `meli-bi-data.WHOWNER.BT_LOADING_ZONES_PROCESS_LM` plm
  ON plm.CYCLE_SUMMARY_ID = cs.CYCLE_SUMMARY_ID
WHERE cs.LOGISTIC_CENTER_ID = facility_filter
  AND cs.CYCLE_NAME = cycle_filter
  AND DATE(cs.CYCLE_SCHEDULED_TO) BETWEEN date_from AND date_to
  AND plm.PROCESS_ID IS NOT NULL;

CREATE TEMP TABLE scoped_events AS
SELECT
  sp.operation_date,
  sp.wave_number,
  e.PROCESS_ID AS process_id,
  e.CREATED_AT,
  e.EVENT_NAME,
  e.STATUS,
  e.PURPOSE_STATUS,
  e.LOADING_ZONE_NAME,
  e.PARKING_AREA_ID
FROM `meli-bi-data.WHOWNER.BT_YMS_LOADING_ZONES_EVENTS` e
JOIN scoped_processes sp
  ON sp.process_id = e.PROCESS_ID
WHERE e.MILE = 'last_mile'
  AND DATE(e.CREATED_AT)
      BETWEEN DATE_SUB(date_from, INTERVAL 1 DAY)
          AND DATE_ADD(date_to, INTERVAL 1 DAY);

-- 1) FRESCOR / LATENCIA DA FONTE
SELECT
  CURRENT_DATETIME(timezone_name) AS checked_at,
  MAX(CREATED_AT) AS latest_event_at,
  DATETIME_DIFF(
    CURRENT_DATETIME(timezone_name),
    MAX(CREATED_AT),
    MINUTE
  ) AS lag_minutes,
  COUNTIF(CREATED_AT >= DATETIME_SUB(CURRENT_DATETIME(timezone_name), INTERVAL 15 MINUTE))
    AS events_last_15m,
  COUNTIF(CREATED_AT >= DATETIME_SUB(CURRENT_DATETIME(timezone_name), INTERVAL 30 MINUTE))
    AS events_last_30m,
  COUNTIF(CREATED_AT >= DATETIME_SUB(CURRENT_DATETIME(timezone_name), INTERVAL 60 MINUTE))
    AS events_last_60m,
  COUNTIF(DATE(CREATED_AT) = CURRENT_DATE(timezone_name))
    AS events_today,
  COUNT(DISTINCT IF(
    DATE(CREATED_AT) = CURRENT_DATE(timezone_name),
    process_id,
    NULL
  )) AS processes_today
FROM scoped_events;

-- 2) EVENTOS / STATUS OBSERVADOS
SELECT
  EVENT_NAME AS event_name,
  STATUS AS status,
  PURPOSE_STATUS AS purpose_status,
  COUNT(*) AS occurrences,
  COUNT(DISTINCT process_id) AS processes,
  MIN(CREATED_AT) AS first_seen_at,
  MAX(CREATED_AT) AS last_seen_at
FROM scoped_events
GROUP BY EVENT_NAME, STATUS, PURPOSE_STATUS
ORDER BY occurrences DESC, event_name, status, purpose_status;

-- 3) EVENTOS RELACIONADOS A ADUANA / AUDITORIA
SELECT
  EVENT_NAME AS event_name,
  STATUS AS status,
  PURPOSE_STATUS AS purpose_status,
  COUNT(*) AS occurrences,
  COUNT(DISTINCT process_id) AS processes,
  MIN(CREATED_AT) AS first_seen_at,
  MAX(CREATED_AT) AS last_seen_at
FROM scoped_events
WHERE REGEXP_CONTAINS(
  UPPER(CONCAT(
    COALESCE(EVENT_NAME, ''), ' ',
    COALESCE(STATUS, ''), ' ',
    COALESCE(PURPOSE_STATUS, '')
  )),
  r'(AUDIT|ADUAN)'
)
GROUP BY EVENT_NAME, STATUS, PURPOSE_STATUS
ORDER BY occurrences DESC, last_seen_at DESC;

-- 4) LOADING ZONE / DOCA OBSERVADA
SELECT
  LOADING_ZONE_NAME AS loading_zone_name,
  COUNT(*) AS event_rows,
  COUNT(DISTINCT process_id) AS processes,
  MIN(CREATED_AT) AS first_seen_at,
  MAX(CREATED_AT) AS last_seen_at
FROM scoped_events
WHERE LOADING_ZONE_NAME IS NOT NULL
  AND TRIM(LOADING_ZONE_NAME) != ''
GROUP BY LOADING_ZONE_NAME
ORDER BY processes DESC, loading_zone_name;

-- 5) VOLUME DE PROCESSOS POR DIA E ONDA
SELECT
  operation_date,
  wave_number,
  COUNT(DISTINCT process_id) AS processes
FROM scoped_processes
GROUP BY operation_date, wave_number
ORDER BY operation_date DESC, wave_number;
