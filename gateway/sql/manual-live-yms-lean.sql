-- LIVE / TEMPO REAL - SSP15 AM1
-- Data operacional calculada automaticamente em America/Sao_Paulo.
-- Nao altere a data: CURRENT_DATE acompanha o dia atual.
-- Ondas: 1,2,3,4,5.
-- Fonte: quatro tabelas essenciais YMS/BigQuery.

-- YMS primary enxuto para o Painel Docas AM1.
-- Baseado na query operacional validada manualmente para SSP15 / AM1.
-- Parametros: @facility_id STRING, @cycle_name STRING, @operation_date DATE, @wave_numbers ARRAY<INT64>.
-- Objetivo: fornecer somente lifecycle, rota, doca/zona e marcos de tempo necessarios ao painel.

DECLARE facility_filter STRING DEFAULT 'SSP15';
DECLARE cycle_filter STRING DEFAULT 'AM1';
DECLARE operation_filter DATE DEFAULT CURRENT_DATE('America/Sao_Paulo');

CREATE TEMP TABLE live_result AS
WITH cycle_summary AS (
  SELECT
    CYCLE_SUMMARY_ID,
    LOGISTIC_CENTER_ID AS facility_id,
    DATE(CYCLE_SCHEDULED_TO) AS operation_date,
    CYCLE_NAME AS cycle_name,
    SAFE_CAST(POSITION AS INT64) AS wave_number
  FROM `meli-bi-data.WHOWNER.BT_CYCLE_SUMMARY_LM`
  WHERE LOGISTIC_CENTER_ID = facility_filter
    AND CYCLE_NAME = cycle_filter
    AND DATE(CYCLE_SCHEDULED_TO) = operation_filter
    AND SAFE_CAST(POSITION AS INT64) IN UNNEST([1,2,3,4,5])
),

processos_raw AS (
  SELECT
    cs.facility_id,
    cs.operation_date,
    cs.cycle_name,
    cs.wave_number,
    plm.PROCESS_ID AS process_id,
    plm.JOURNEY_ID AS journey_id,
    NULLIF(CAST(plm.ROUTE_PLAN_ID AS STRING), '') AS planned_route_id,
    NULLIF(plm.CLUSTER_ROUTE_NAME, '') AS cluster_route_name
  FROM cycle_summary cs
  JOIN `meli-bi-data.WHOWNER.BT_LOADING_ZONES_PROCESS_LM` plm
    ON plm.CYCLE_SUMMARY_ID = cs.CYCLE_SUMMARY_ID
  WHERE plm.PROCESS_ID IS NOT NULL
),

processos AS (
  SELECT * EXCEPT(rn)
  FROM (
    SELECT
      pr.*,
      ROW_NUMBER() OVER (
        PARTITION BY process_id
        ORDER BY operation_date DESC, wave_number ASC, journey_id DESC
      ) AS rn
    FROM processos_raw pr
  )
  WHERE rn = 1
),

rotas AS (
  SELECT
    FACILITY_ID AS facility_id,
    DATE(CYCLE_DATE) AS operation_date,
    CYCLE_NAME AS cycle_name,
    SAFE_CAST(WAVE_NUMBER AS INT64) AS wave_number,
    NULLIF(CAST(ROUTE_PLANNED_ID AS STRING), '') AS planned_route_id,
    NULLIF(ROUTE_NAME, '') AS route_name,
    ROW_NUMBER() OVER (
      PARTITION BY
        FACILITY_ID,
        DATE(CYCLE_DATE),
        CYCLE_NAME,
        SAFE_CAST(WAVE_NUMBER AS INT64),
        CAST(ROUTE_PLANNED_ID AS STRING)
      ORDER BY ROUTE_LAST_UPDATED_DTTM DESC, ROUTE_CREATED_DTTM DESC
    ) AS rn
  FROM `meli-bi-data.WHOWNER.BT_CYCLE_ROUTE`
  WHERE FACILITY_ID = facility_filter
    AND CYCLE_NAME = cycle_filter
    AND DATE(CYCLE_DATE) = operation_filter
    AND DOCK_USE_TYPE = 'last_mile'
    AND SAFE_CAST(WAVE_NUMBER AS INT64) IN UNNEST([1,2,3,4,5])
),

event_source AS (
  SELECT
    PROCESS_ID AS process_id,
    EVENT_NAME,
    STATUS,
    PURPOSE_STATUS,
    CREATED_AT,
    LOADING_ZONE_NAME
  FROM `meli-bi-data.WHOWNER.BT_YMS_LOADING_ZONES_EVENTS`
  WHERE MILE = 'last_mile'
    AND DATE(CREATED_AT)
      BETWEEN DATE_SUB(operation_filter, INTERVAL 2 DAY)
          AND DATE_ADD(operation_filter, INTERVAL 1 DAY)
),

eventos AS (
  SELECT
    p.process_id,

    MIN(CASE
      WHEN e.EVENT_NAME = 'check-in-without-prior-assignment'
        OR e.STATUS = 'WAITING_LOADING_ZONE'
      THEN e.CREATED_AT
    END) AS yms_check_in_at,

    MIN(CASE
      WHEN e.STATUS = 'UN-LOAD_STARTED'
      THEN e.CREATED_AT
    END) AS dock_in_at,

    MIN(CASE
      WHEN e.PURPOSE_STATUS = 'WAITING_FOR_AUDIT'
      THEN e.CREATED_AT
    END) AS customs_queue_at,

    MIN(CASE
      WHEN e.PURPOSE_STATUS = 'DOING_AUDIT'
      THEN e.CREATED_AT
    END) AS customs_started_at,

    MAX(CASE
      WHEN e.PURPOSE_STATUS = 'DOING_AUDIT'
      THEN e.CREATED_AT
    END) AS customs_last_activity_at,

    MIN(CASE
      WHEN e.PURPOSE_STATUS = 'LOADING_PACKAGES_STARTED'
      THEN e.CREATED_AT
    END) AS loading_started_at,

    MIN(CASE
      WHEN e.EVENT_NAME = 'check-out'
      THEN e.CREATED_AT
    END) AS dock_out_at,

    MIN(CASE
      WHEN e.EVENT_NAME = 'gate-out'
      THEN e.CREATED_AT
    END) AS gate_out_at,

    ARRAY_AGG(
      e.LOADING_ZONE_NAME IGNORE NULLS
      ORDER BY e.CREATED_AT DESC
      LIMIT 1
    )[SAFE_OFFSET(0)] AS loading_zone_name,

    ARRAY_AGG(
      IF(
        e.CREATED_AT IS NULL,
        NULL,
        STRUCT(
          e.EVENT_NAME AS event_name,
          e.STATUS AS status,
          e.PURPOSE_STATUS AS purpose_status,
          e.CREATED_AT AS event_at
        )
      )
      IGNORE NULLS
      ORDER BY e.CREATED_AT DESC
      LIMIT 1
    )[SAFE_OFFSET(0)] AS latest_event

  FROM processos p
  LEFT JOIN event_source e
    ON e.process_id = p.process_id
   AND DATE(e.CREATED_AT)
       BETWEEN DATE_SUB(p.operation_date, INTERVAL 1 DAY)
           AND DATE_ADD(p.operation_date, INTERVAL 1 DAY)
  GROUP BY p.process_id
)

SELECT
  p.facility_id,
  p.operation_date,
  p.cycle_name,
  p.wave_number,
  p.process_id,

  CAST(NULL AS STRING) AS executed_route_id,
  p.planned_route_id,

  COALESCE(
    NULLIF(r.route_name, p.cycle_name),
    NULLIF(p.cluster_route_name, p.cycle_name)
  ) AS route_name,

  NULLIF(r.route_name, p.cycle_name) AS planned_route_name,
  FALSE AS route_changed_from_plan,

  CASE
    WHEN r.route_name IS NOT NULL AND r.route_name != p.cycle_name
      THEN 'cycle_route_planned_id'
    WHEN p.cluster_route_name IS NOT NULL AND p.cluster_route_name != p.cycle_name
      THEN 'loading_zones_process'
    ELSE 'unresolved'
  END AS route_resolution_status,

  CAST(NULL AS STRING) AS carrier_name,
  CAST(NULL AS STRING) AS planned_carrier_name,
  CAST(NULL AS STRING) AS plate,
  e.loading_zone_name,
  CAST(NULL AS STRING) AS parking_area_name,

  e.yms_check_in_at,
  e.dock_in_at,
  e.customs_queue_at,
  e.customs_started_at,
  e.customs_last_activity_at,
  e.loading_started_at,
  e.dock_out_at,
  e.gate_out_at,

  e.latest_event.event_name AS latest_event_name,
  e.latest_event.status AS latest_status,
  e.latest_event.purpose_status AS latest_purpose_status,
  e.latest_event.event_at AS latest_event_at

FROM processos p

LEFT JOIN rotas r
  ON r.facility_id = p.facility_id
 AND r.operation_date = p.operation_date
 AND r.cycle_name = p.cycle_name
 AND r.wave_number = p.wave_number
 AND r.planned_route_id = p.planned_route_id
 AND r.rn = 1

LEFT JOIN eventos e
  ON e.process_id = p.process_id

;

SELECT
  live_result.*,
  CASE
    WHEN LOWER(latest_event_name) IN ('killed','canceled','skipped')
      THEN 'terminal_exception'
    WHEN LOWER(latest_event_name) = 'gate-out'
      AND UPPER(latest_status) = 'PROCESS_FINISHED'
      THEN 'dispatched'
    WHEN UPPER(latest_purpose_status) = 'DOING_AUDIT'
      THEN 'customs_in_progress'
    WHEN UPPER(latest_purpose_status) = 'WAITING_FOR_AUDIT'
      THEN 'waiting_customs'
    WHEN UPPER(latest_purpose_status) = 'LOADING_PACKAGES_STARTED'
      THEN 'loading_packages'
    WHEN UPPER(latest_status) = 'UN-LOAD_STARTED'
      THEN 'at_dock'
    ELSE 'unknown'
  END AS lifecycle_calculado
FROM live_result
ORDER BY wave_number, route_name, process_id;
