-- Diagnostico de doca canonica e dos processos AM1 sem eventos no dia.
-- Somente leitura.
DECLARE facility_filter STRING DEFAULT 'SSP15';
DECLARE cycle_filter STRING DEFAULT 'AM1';
DECLARE timezone_name STRING DEFAULT 'America/Sao_Paulo';
DECLARE operation_date_filter DATE DEFAULT CURRENT_DATE(timezone_name);

CREATE TEMP TABLE day_processes AS
WITH cs AS (
  SELECT
    CYCLE_SUMMARY_ID,
    LOGISTIC_CENTER_ID AS facility_id,
    DATE(CYCLE_SCHEDULED_TO) AS operation_date,
    CYCLE_NAME AS cycle_name,
    SAFE_CAST(POSITION AS INT64) AS wave_number
  FROM `meli-bi-data.WHOWNER.BT_CYCLE_SUMMARY_LM`
  WHERE LOGISTIC_CENTER_ID = facility_filter
    AND CYCLE_NAME = cycle_filter
    AND DATE(CYCLE_SCHEDULED_TO) = operation_date_filter
)
SELECT DISTINCT
  cs.facility_id,
  cs.operation_date,
  cs.cycle_name,
  cs.wave_number,
  plm.PROCESS_ID AS process_id,
  plm.JOURNEY_ID AS journey_id,
  NULLIF(CAST(plm.EXECUTED_ROUTE_ID AS STRING), '') AS process_executed_route_id,
  NULLIF(CAST(plm.ROUTE_PLAN_ID AS STRING), '') AS process_planned_route_id,
  plm.CLUSTER_ROUTE_NAME AS cluster_route_name,
  CAST(plm.CARRIER_ID AS STRING) AS process_carrier_id
FROM cs
JOIN `meli-bi-data.WHOWNER.BT_LOADING_ZONES_PROCESS_LM` plm
  ON plm.CYCLE_SUMMARY_ID = cs.CYCLE_SUMMARY_ID
WHERE plm.PROCESS_ID IS NOT NULL;

CREATE TEMP TABLE journey_route AS
SELECT
  jp.JOURNEY_ID AS journey_id,
  (
    SELECT NULLIF(CAST(p.ROUTE.PLAN_ID AS STRING), '')
    FROM UNNEST(jp.PURPOSES) p
    WHERE p.MILE = 'last_mile'
      AND p.ROUTE.PLAN_ID IS NOT NULL
    LIMIT 1
  ) AS purpose_planned_route_id,
  (
    SELECT NULLIF(CAST(p.ROUTE.EXECUTED_ID AS STRING), '')
    FROM UNNEST(jp.PURPOSES) p
    WHERE p.MILE = 'last_mile'
      AND p.ROUTE.EXECUTED_ID IS NOT NULL
    LIMIT 1
  ) AS purpose_executed_route_id,
  jp.JOURNEY_STATUS AS journey_status,
  CAST(jp.CARRIER.CARRIER_ID AS STRING) AS journey_carrier_id
FROM `meli-bi-data.WHOWNER.BT_YMS_JOURNEY_PLANNER` jp
WHERE jp.JOURNEY_ID IN (
  SELECT DISTINCT journey_id
  FROM day_processes
  WHERE journey_id IS NOT NULL
)
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY jp.JOURNEY_ID
  ORDER BY jp.JOURNEY_ID
) = 1;

CREATE TEMP TABLE process_keys AS
SELECT
  p.*,
  COALESCE(p.process_planned_route_id, j.purpose_planned_route_id) AS planned_route_id,
  COALESCE(p.process_executed_route_id, j.purpose_executed_route_id) AS executed_route_id,
  j.journey_status,
  j.journey_carrier_id
FROM day_processes p
LEFT JOIN journey_route j
  ON j.journey_id = p.journey_id;

CREATE TEMP TABLE latest_loading_zone AS
SELECT
  PROCESS_ID AS process_id,
  ARRAY_AGG(
    STRUCT(
      CREATED_AT AS event_at,
      LOADING_ZONE_NAME AS loading_zone_name,
      LOADING_ZONE_ID AS loading_zone_id,
      EVENT_NAME AS event_name,
      STATUS AS status,
      PURPOSE_STATUS AS purpose_status
    )
    ORDER BY CREATED_AT DESC
    LIMIT 1
  )[OFFSET(0)] AS latest_event,
  ARRAY_AGG(
    LOADING_ZONE_NAME IGNORE NULLS
    ORDER BY CREATED_AT DESC
    LIMIT 1
  )[SAFE_OFFSET(0)] AS latest_loading_zone_name,
  ARRAY_AGG(
    LOADING_ZONE_ID IGNORE NULLS
    ORDER BY CREATED_AT DESC
    LIMIT 1
  )[SAFE_OFFSET(0)] AS latest_loading_zone_id,
  COUNT(*) AS event_rows_today
FROM `meli-bi-data.WHOWNER.BT_YMS_LOADING_ZONES_EVENTS`
WHERE MILE = 'last_mile'
  AND DATE(CREATED_AT) = operation_date_filter
GROUP BY PROCESS_ID;

CREATE TEMP TABLE cycle_route_today AS
SELECT
  FACILITY_ID AS facility_id,
  DATE(CYCLE_DATE) AS operation_date,
  CYCLE_NAME AS cycle_name,
  SAFE_CAST(WAVE_NUMBER AS INT64) AS wave_number,
  CAST(ROUTE_ID AS STRING) AS route_id,
  NULLIF(CAST(ROUTE_PLANNED_ID AS STRING), '') AS planned_route_id,
  ROUTE_NAME AS route_name,
  ROUTE_ORIGINAL_NAME AS original_route_name,
  DOCK_NUMBER AS dock_number,
  MOV_DOCK_NUMBER AS moved_dock_number,
  ORIGIN_DOCK_NUMBER AS origin_dock_number,
  CAST(CARRIER_ID AS STRING) AS carrier_id,
  ROW_NUMBER() OVER (
    PARTITION BY
      FACILITY_ID,
      DATE(CYCLE_DATE),
      CYCLE_NAME,
      SAFE_CAST(WAVE_NUMBER AS INT64),
      CAST(ROUTE_PLANNED_ID AS STRING)
    ORDER BY
      ROUTE_LAST_UPDATED_DTTM DESC,
      ROUTE_CREATED_DTTM DESC,
      ROUTE_ID DESC
  ) AS route_rank
FROM `meli-bi-data.WHOWNER.BT_CYCLE_ROUTE`
WHERE FACILITY_ID = facility_filter
  AND CYCLE_NAME = cycle_filter
  AND DATE(CYCLE_DATE) = operation_date_filter
  AND DOCK_USE_TYPE = 'last_mile'
  AND ROUTE_PLANNED_ID IS NOT NULL;

CREATE TEMP TABLE plan_today AS
SELECT
  NULLIF(CAST(PLANNED_ROUTE_ID AS STRING), '') AS planned_route_id,
  ROUTE AS route_name,
  SAFE_CAST(WAVE AS INT64) AS wave_number,
  DOCK_NUMBER AS dock_number,
  DOCK_ID AS dock_id,
  PLATE AS plate,
  JOURNEY_STATUS AS journey_status,
  MODIFICATION_DATE AS modification_at,
  ROW_NUMBER() OVER (
    PARTITION BY CAST(PLANNED_ROUTE_ID AS STRING)
    ORDER BY MODIFICATION_DATE DESC
  ) AS plan_rank
FROM `meli-bi-data.WHOWNER.BT_YMS_PLANIFICATION_OPERATIVE_LM`
WHERE FACILITY = facility_filter
  AND DATE(MODIFICATION_DATE)
      BETWEEN DATE_SUB(operation_date_filter, INTERVAL 1 DAY)
          AND DATE_ADD(operation_date_filter, INTERVAL 1 DAY)
  AND PLANNED_ROUTE_ID IS NOT NULL;

-- 1) COMPARACAO DE DOCA: EVENTO YMS x CYCLE ROUTE x PLANIFICACAO
WITH comparison AS (
  SELECT
    pk.wave_number,
    pk.process_id,
    pk.planned_route_id,
    pk.executed_route_id,
    cr.route_name AS cycle_route_name,
    lz.latest_loading_zone_name,
    SAFE_CAST(lz.latest_loading_zone_name AS INT64) AS yms_loading_zone_number,
    cr.dock_number AS cycle_dock_number,
    cr.moved_dock_number AS cycle_moved_dock_number,
    cr.origin_dock_number AS cycle_origin_dock_number,
    SAFE_CAST(pl.dock_number AS INT64) AS plan_dock_number,
    pl.dock_number AS plan_dock_raw,
    lz.latest_event.event_name AS latest_event_name,
    lz.latest_event.status AS latest_status,
    lz.latest_event.purpose_status AS latest_purpose_status
  FROM process_keys pk
  LEFT JOIN latest_loading_zone lz
    ON lz.process_id = pk.process_id
  LEFT JOIN cycle_route_today cr
    ON cr.facility_id = pk.facility_id
   AND cr.operation_date = pk.operation_date
   AND cr.cycle_name = pk.cycle_name
   AND cr.wave_number = pk.wave_number
   AND cr.planned_route_id = pk.planned_route_id
   AND cr.route_rank = 1
  LEFT JOIN plan_today pl
    ON pl.planned_route_id = pk.planned_route_id
   AND pl.plan_rank = 1
)
SELECT
  COUNT(*) AS processes,
  COUNTIF(yms_loading_zone_number IS NOT NULL) AS with_yms_loading_zone,
  COUNTIF(cycle_dock_number IS NOT NULL) AS with_cycle_dock,
  COUNTIF(plan_dock_number IS NOT NULL) AS with_plan_dock,

  COUNTIF(
    yms_loading_zone_number IS NOT NULL
    AND cycle_dock_number IS NOT NULL
    AND yms_loading_zone_number = cycle_dock_number
  ) AS yms_matches_cycle_dock,

  COUNTIF(
    yms_loading_zone_number IS NOT NULL
    AND cycle_moved_dock_number IS NOT NULL
    AND yms_loading_zone_number = cycle_moved_dock_number
  ) AS yms_matches_moved_dock,

  COUNTIF(
    yms_loading_zone_number IS NOT NULL
    AND plan_dock_number IS NOT NULL
    AND yms_loading_zone_number = plan_dock_number
  ) AS yms_matches_plan_dock,

  COUNTIF(
    yms_loading_zone_number IS NOT NULL
    AND cycle_dock_number IS NOT NULL
    AND yms_loading_zone_number != cycle_dock_number
  ) AS yms_differs_cycle_dock

FROM comparison;

-- 2) SOMENTE DIVERGENCIAS DE DOCA
WITH comparison AS (
  SELECT
    pk.wave_number,
    pk.process_id,
    pk.planned_route_id,
    cr.route_name AS cycle_route_name,
    SAFE_CAST(lz.latest_loading_zone_name AS INT64) AS yms_loading_zone_number,
    cr.dock_number AS cycle_dock_number,
    cr.moved_dock_number AS cycle_moved_dock_number,
    cr.origin_dock_number AS cycle_origin_dock_number,
    SAFE_CAST(pl.dock_number AS INT64) AS plan_dock_number,
    lz.latest_event.event_name AS latest_event_name,
    lz.latest_event.status AS latest_status
  FROM process_keys pk
  LEFT JOIN latest_loading_zone lz
    ON lz.process_id = pk.process_id
  LEFT JOIN cycle_route_today cr
    ON cr.facility_id = pk.facility_id
   AND cr.operation_date = pk.operation_date
   AND cr.cycle_name = pk.cycle_name
   AND cr.wave_number = pk.wave_number
   AND cr.planned_route_id = pk.planned_route_id
   AND cr.route_rank = 1
  LEFT JOIN plan_today pl
    ON pl.planned_route_id = pk.planned_route_id
   AND pl.plan_rank = 1
)
SELECT *
FROM comparison
WHERE yms_loading_zone_number IS NOT NULL
  AND cycle_dock_number IS NOT NULL
  AND yms_loading_zone_number != cycle_dock_number
ORDER BY wave_number, cycle_route_name;

-- 3) OS 5 PROCESSOS SEM EVENTO NO DIA: STATUS E PLANEJAMENTO
SELECT
  pk.wave_number,
  pk.process_id,
  pk.journey_id,
  pk.planned_route_id,
  pk.executed_route_id,
  pk.cluster_route_name,
  pk.journey_status,
  cr.route_name AS cycle_route_name,
  cr.dock_number AS cycle_dock_number,
  cr.moved_dock_number AS cycle_moved_dock_number,
  pl.route_name AS plan_route_name,
  pl.dock_number AS plan_dock_number,
  pl.journey_status AS plan_journey_status,
  COALESCE(lz.event_rows_today, 0) AS event_rows_today
FROM process_keys pk
LEFT JOIN latest_loading_zone lz
  ON lz.process_id = pk.process_id
LEFT JOIN cycle_route_today cr
  ON cr.facility_id = pk.facility_id
 AND cr.operation_date = pk.operation_date
 AND cr.cycle_name = pk.cycle_name
 AND cr.wave_number = pk.wave_number
 AND cr.planned_route_id = pk.planned_route_id
 AND cr.route_rank = 1
LEFT JOIN plan_today pl
  ON pl.planned_route_id = pk.planned_route_id
 AND pl.plan_rank = 1
WHERE COALESCE(lz.event_rows_today, 0) = 0
ORDER BY pk.wave_number, pk.process_id;

-- 4) METADADO DA TABELA DE EVENTOS
SELECT
  table_name,
  creation_time,
  ddl
FROM `meli-bi-data.WHOWNER.INFORMATION_SCHEMA.TABLES`
WHERE table_name = 'BT_YMS_LOADING_ZONES_EVENTS';
