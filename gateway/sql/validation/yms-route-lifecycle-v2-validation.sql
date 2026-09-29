-- YMS / BigQuery lifecycle V2 para automacao do Painel Docas AM1.
-- Objetivo: uma linha por PROCESS_ID, preservando data operacional e marcos fisicos.
-- BigQuery Standard SQL. A resolucao de rota prioriza IDs executados/planejados validados no schema real.

DECLARE facility_filter STRING DEFAULT 'SSP15';
DECLARE cycle_filter STRING DEFAULT 'AM1';
DECLARE date_from DATE DEFAULT '2026-09-02';
DECLARE date_to DATE DEFAULT '2026-09-02';

CREATE TEMP TABLE final_result AS
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
    AND DATE(CYCLE_SCHEDULED_TO) BETWEEN date_from AND date_to
),

process_base_raw AS (
  SELECT
    cs.facility_id,
    cs.operation_date,
    cs.cycle_name,
    cs.wave_number,
    plm.PROCESS_ID AS process_id,
    plm.JOURNEY_ID AS journey_id,
    plm.CLUSTER_ROUTE_NAME AS cluster_route_name,
    NULLIF(CAST(plm.EXECUTED_ROUTE_ID AS STRING), '') AS process_executed_route_id,
    NULLIF(CAST(plm.ROUTE_PLAN_ID AS STRING), '') AS process_planned_route_id,
    CAST(plm.CARRIER_ID AS STRING) AS process_carrier_id
  FROM cycle_summary cs
  JOIN `meli-bi-data.WHOWNER.BT_LOADING_ZONES_PROCESS_LM` plm
    ON plm.CYCLE_SUMMARY_ID = cs.CYCLE_SUMMARY_ID
  WHERE plm.PROCESS_ID IS NOT NULL
),

process_base_ranked AS (
  SELECT
    pbr.*,
    COUNT(*) OVER (PARTITION BY process_id) AS process_source_row_count,
    ROW_NUMBER() OVER (
      PARTITION BY process_id
      ORDER BY operation_date DESC, wave_number ASC, journey_id DESC
    ) AS process_rank
  FROM process_base_raw pbr
),

process_base AS (
  SELECT * EXCEPT(process_rank)
  FROM process_base_ranked
  WHERE process_rank = 1
),

jp_prep AS (
  SELECT
    JOURNEY_ID AS journey_id,
    CAST(CARRIER.CARRIER_ID AS STRING) AS journey_carrier_id,
    (
      SELECT v.VEHICLE_PLATE
      FROM UNNEST(VEHICLES) v
      WHERE SAFE_CAST(v.VEHICLE_SEQUENCE AS INT64) = 1
      LIMIT 1
    ) AS plate,
    (
      SELECT d.DRIVER_ID
      FROM UNNEST(PURPOSES) p, UNNEST(p.DRIVER) d
      WHERE p.MILE = 'last_mile'
        AND SAFE_CAST(d.DRIVER_SEQUENCE AS INT64) = 1
      LIMIT 1
    ) AS driver_id,
    (
      SELECT NULLIF(CAST(p.ROUTE.PLAN_ID AS STRING), '')
      FROM UNNEST(PURPOSES) p
      WHERE p.MILE = 'last_mile'
        AND p.ROUTE.PLAN_ID IS NOT NULL
      LIMIT 1
    ) AS purpose_planned_route_id,
    (
      SELECT NULLIF(CAST(p.ROUTE.EXECUTED_ID AS STRING), '')
      FROM UNNEST(PURPOSES) p
      WHERE p.MILE = 'last_mile'
        AND p.ROUTE.EXECUTED_ID IS NOT NULL
      LIMIT 1
    ) AS purpose_executed_route_id
  FROM `meli-bi-data.WHOWNER.BT_YMS_JOURNEY_PLANNER`
  WHERE JOURNEY_ID IN (
    SELECT DISTINCT journey_id
    FROM process_base
    WHERE journey_id IS NOT NULL
  )
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY JOURNEY_ID
    ORDER BY JOURNEY_ID
  ) = 1
),

process_vehicle AS (
  SELECT
    pb.*,
    jp.journey_carrier_id,
    jp.plate,
    REGEXP_REPLACE(UPPER(jp.plate), r'[^A-Z0-9]', '') AS plate_normalized,
    jp.driver_id,
    COALESCE(pb.process_executed_route_id, jp.purpose_executed_route_id) AS executed_route_id,
    COALESCE(pb.process_planned_route_id, jp.purpose_planned_route_id) AS planned_route_id,
    jp.purpose_executed_route_id,
    jp.purpose_planned_route_id
  FROM process_base pb
  LEFT JOIN jp_prep jp
    ON jp.journey_id = pb.journey_id
),

carrier_lookup AS (
  SELECT
    CAST(CARRIER_ID AS STRING) AS carrier_id,
    ARRAY_AGG(
      CARRIER_NAME IGNORE NULLS
      ORDER BY ROUTE_DATE DESC
      LIMIT 1
    )[SAFE_OFFSET(0)] AS carrier_name
  FROM `meli-bi-data.WHOWNER.BT_PRECHECKIN_TRACEABILITY_LM`
  WHERE CARRIER_NAME IS NOT NULL
    AND FACILITY_ID = facility_filter
    AND DATE(ROUTE_DATE)
        BETWEEN DATE_SUB(date_from, INTERVAL 7 DAY)
            AND DATE_ADD(date_to, INTERVAL 1 DAY)
  GROUP BY CAST(CARRIER_ID AS STRING)
),

precheckin_route_ranked AS (
  SELECT
    FACILITY_ID AS facility_id,
    ROUTE_DATE AS source_route_date,
    COALESCE(DATE(ROUTE_INIT_DATE), ROUTE_DATE) AS route_effective_date,
    CAST(ROUTE_ID AS STRING) AS executed_route_id,
    NULLIF(CAST(PLANNED_ROUTE_ID AS STRING), '') AS planned_route_id,
    CLUSTER_ID AS route_name,
    VEHICLE_PLATE_ID AS plate,
    REGEXP_REPLACE(UPPER(VEHICLE_PLATE_ID), r'[^A-Z0-9]', '') AS plate_normalized,
    CAST(CARRIER_ID AS STRING) AS carrier_id,
    CARRIER_NAME AS carrier_name,
    ROUTE_INIT_DATE AS route_init_at,
    ROUTE_FINISH_DATE AS route_finish_at,
    ROW_NUMBER() OVER (
      PARTITION BY FACILITY_ID, CAST(ROUTE_ID AS STRING)
      ORDER BY
        COALESCE(ROUTE_FINISH_DATE, ROUTE_INIT_DATE) DESC,
        ROUTE_INIT_DATE DESC,
        ROUTE_DATE DESC
    ) AS route_rank
  FROM `meli-bi-data.WHOWNER.BT_PRECHECKIN_TRACEABILITY_LM`
  WHERE FACILITY_ID = facility_filter
    AND ROUTE_DATE
        BETWEEN DATE_SUB(date_from, INTERVAL 1 DAY)
            AND DATE_ADD(date_to, INTERVAL 1 DAY)
    AND ROUTE_ID IS NOT NULL
),

precheckin_route_prep AS (
  SELECT * EXCEPT(route_rank)
  FROM precheckin_route_ranked
  WHERE route_rank = 1
),

cycle_route_id_ranked AS (
  SELECT
    FACILITY_ID AS facility_id,
    DATE(CYCLE_DATE) AS operation_date,
    CYCLE_NAME AS cycle_name,
    SAFE_CAST(WAVE_NUMBER AS INT64) AS wave_number,
    CAST(ROUTE_ID AS STRING) AS cycle_route_id,
    NULLIF(CAST(ROUTE_PLANNED_ID AS STRING), '') AS planned_route_id,
    NULLIF(CAST(MOV_ROUTE_ID AS STRING), '') AS moved_route_id,
    COALESCE(NULLIF(ROUTE_NAME, ''), NULLIF(ROUTE_ORIGINAL_NAME, '')) AS route_name,
    VEHICLE_PLATE_ID AS plate,
    REGEXP_REPLACE(UPPER(VEHICLE_PLATE_ID), r'[^A-Z0-9]', '') AS plate_normalized,
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
    AND DATE(CYCLE_DATE) BETWEEN date_from AND date_to
    AND DOCK_USE_TYPE = 'last_mile'
    AND ROUTE_PLANNED_ID IS NOT NULL
),

cycle_route_id_prep AS (
  SELECT * EXCEPT(route_rank)
  FROM cycle_route_id_ranked
  WHERE route_rank = 1
),

cycle_route_plate_grouped AS (
  SELECT
    FACILITY_ID AS facility_id,
    DATE(CYCLE_DATE) AS operation_date,
    CYCLE_NAME AS cycle_name,
    SAFE_CAST(WAVE_NUMBER AS INT64) AS wave_number,
    REGEXP_REPLACE(UPPER(VEHICLE_PLATE_ID), r'[^A-Z0-9]', '') AS plate_normalized,
    ARRAY_AGG(DISTINCT ROUTE_NAME IGNORE NULLS) AS route_names
  FROM `meli-bi-data.WHOWNER.BT_CYCLE_ROUTE`
  WHERE FACILITY_ID = facility_filter
    AND CYCLE_NAME = cycle_filter
    AND DATE(CYCLE_DATE) BETWEEN date_from AND date_to
    AND DOCK_USE_TYPE = 'last_mile'
  GROUP BY
    FACILITY_ID,
    DATE(CYCLE_DATE),
    CYCLE_NAME,
    SAFE_CAST(WAVE_NUMBER AS INT64),
    REGEXP_REPLACE(UPPER(VEHICLE_PLATE_ID), r'[^A-Z0-9]', '')
),

cycle_route_plate_prep AS (
  SELECT
    facility_id,
    operation_date,
    cycle_name,
    wave_number,
    plate_normalized,
    IF(ARRAY_LENGTH(route_names) = 1, route_names[SAFE_OFFSET(0)], NULL) AS route_name,
    ARRAY_LENGTH(route_names) AS route_candidate_count
  FROM cycle_route_plate_grouped
),

plan_by_id_candidates AS (
  SELECT
    pv.process_id,
    p.ROUTE AS route_name,
    NULLIF(CAST(p.PLANNED_ROUTE_ID AS STRING), '') AS planned_route_id,
    p.MODIFICATION_DATE AS modification_at,
    COUNT(*) OVER (PARTITION BY pv.process_id) AS plan_id_candidate_count,
    ROW_NUMBER() OVER (
      PARTITION BY pv.process_id
      ORDER BY p.MODIFICATION_DATE DESC, p.ROUTE DESC
    ) AS plan_rank
  FROM process_vehicle pv
  JOIN `meli-bi-data.WHOWNER.BT_YMS_PLANIFICATION_OPERATIVE_LM` p
    ON NULLIF(CAST(p.PLANNED_ROUTE_ID AS STRING), '') = pv.planned_route_id
   AND p.FACILITY = pv.facility_id
   AND DATE(p.MODIFICATION_DATE)
       BETWEEN DATE_SUB(pv.operation_date, INTERVAL 1 DAY)
           AND DATE_ADD(pv.operation_date, INTERVAL 1 DAY)
  WHERE pv.planned_route_id IS NOT NULL
),

plan_by_id_prep AS (
  SELECT
    process_id,
    route_name,
    planned_route_id,
    modification_at,
    plan_id_candidate_count
  FROM plan_by_id_candidates
  WHERE plan_rank = 1
),

plan_by_plate_candidates AS (
  SELECT
    pv.process_id,
    p.ROUTE AS route_name,
    p.MODIFICATION_DATE AS modification_at,
    COUNT(*) OVER (PARTITION BY pv.process_id) AS plan_plate_candidate_count,
    ROW_NUMBER() OVER (
      PARTITION BY pv.process_id
      ORDER BY p.MODIFICATION_DATE DESC, p.ROUTE DESC
    ) AS plan_rank
  FROM process_vehicle pv
  JOIN `meli-bi-data.WHOWNER.BT_YMS_PLANIFICATION_OPERATIVE_LM` p
    ON REGEXP_REPLACE(UPPER(p.PLATE), r'[^A-Z0-9]', '') = pv.plate_normalized
   AND p.FACILITY = pv.facility_id
   AND SAFE_CAST(p.WAVE AS INT64) = pv.wave_number
   AND DATE(p.MODIFICATION_DATE)
       BETWEEN DATE_SUB(pv.operation_date, INTERVAL 1 DAY)
           AND pv.operation_date
  WHERE pv.plate_normalized IS NOT NULL
),

plan_by_plate_prep AS (
  SELECT
    process_id,
    route_name,
    modification_at,
    plan_plate_candidate_count
  FROM plan_by_plate_candidates
  WHERE plan_rank = 1
),

event_source AS (
  SELECT
    e.*,
    DATE(e.CREATED_AT) AS event_local_date
  FROM `meli-bi-data.WHOWNER.BT_YMS_LOADING_ZONES_EVENTS` e
  WHERE e.MILE = 'last_mile'
    AND DATE(e.CREATED_AT)
        BETWEEN DATE_SUB(date_from, INTERVAL 2 DAY)
            AND DATE_ADD(date_to, INTERVAL 1 DAY)
),

event_prep AS (
  SELECT
    pb.process_id,

    MIN(CASE
      WHEN e.EVENT_NAME = 'check-in-without-prior-assignment' THEN e.CREATED_AT
      WHEN e.EVENT_NAME = 'updated'
       AND e.STATUS = 'WAITING_LOADING_ZONE'
       AND e.event_local_date = pb.operation_date THEN e.CREATED_AT
    END) AS yms_check_in_at,

    MIN(CASE
      WHEN e.STATUS = 'UN-LOAD_STARTED' THEN e.CREATED_AT
    END) AS dock_in_at,

    MIN(CASE
      WHEN e.EVENT_NAME = 'update_purpose_status'
       AND e.PURPOSE_STATUS = 'LOADING_PACKAGES_STARTED' THEN e.CREATED_AT
    END) AS loading_started_at,

    MIN(CASE
      WHEN e.EVENT_NAME = 'check-out' THEN e.CREATED_AT
    END) AS dock_out_at,

    MIN(CASE
      WHEN e.EVENT_NAME = 'gate-out' THEN e.CREATED_AT
    END) AS gate_out_at,

    MIN(CASE
      WHEN e.PURPOSE_STATUS = 'WAITING_FOR_AUDIT' THEN e.CREATED_AT
    END) AS customs_queue_at,

    MIN(CASE
      WHEN e.PURPOSE_STATUS = 'DOING_AUDIT' THEN e.CREATED_AT
    END) AS customs_started_at,

    MAX(CASE
      WHEN e.PURPOSE_STATUS = 'DOING_AUDIT' THEN e.CREATED_AT
    END) AS customs_last_activity_at,

    ARRAY_AGG(
      e.LOADING_ZONE_NAME IGNORE NULLS
      ORDER BY e.CREATED_AT DESC
      LIMIT 1
    )[SAFE_OFFSET(0)] AS loading_zone_name,

    ARRAY_AGG(
      e.PARKING_AREA_ID IGNORE NULLS
      ORDER BY e.CREATED_AT DESC
      LIMIT 1
    )[SAFE_OFFSET(0)] AS parking_area_id,

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

  FROM process_base pb
  LEFT JOIN event_source e
    ON e.PROCESS_ID = pb.process_id
   AND e.event_local_date
       BETWEEN DATE_SUB(pb.operation_date, INTERVAL 1 DAY)
           AND DATE_ADD(pb.operation_date, INTERVAL 1 DAY)
  GROUP BY pb.process_id
),

parking_lookup AS (
  SELECT
    RESOURCE_ID AS parking_area_id,
    NAME AS parking_area_name
  FROM `meli-bi-data.WHOWNER.BT_SHP_MT_FACILITY_RESOURCE`
  WHERE TYPE = 'parking_area'
    AND STATUS = 'active'
    AND facility_filter IN UNNEST(SPLIT(FACILITIES, ','))
),

final_result_cte AS (
  SELECT
    pv.facility_id,
    pv.operation_date,
    pv.cycle_name,
    pv.wave_number,

    pv.process_id,
    pv.journey_id,

    pv.executed_route_id,
    pv.planned_route_id,
    cri.cycle_route_id,

    pre.route_name AS executed_route_name,
    pre.source_route_date AS executed_route_source_date,
    pre.route_effective_date AS executed_route_effective_date,
    pre.route_init_at AS executed_route_init_at,
    pre.route_finish_at AS executed_route_finish_at,
    COALESCE(
      NULLIF(cri.route_name, pv.cycle_name),
      NULLIF(plan_id.route_name, pv.cycle_name)
    ) AS planned_route_name,

    CASE
      WHEN pre.route_name IS NOT NULL
       AND COALESCE(
         NULLIF(cri.route_name, pv.cycle_name),
         NULLIF(plan_id.route_name, pv.cycle_name)
       ) IS NOT NULL
       AND pre.route_name != COALESCE(
         NULLIF(cri.route_name, pv.cycle_name),
         NULLIF(plan_id.route_name, pv.cycle_name)
       )
        THEN TRUE
      ELSE FALSE
    END AS route_changed_from_plan,

    CASE
      WHEN pre.route_name IS NOT NULL AND pre.route_name != pv.cycle_name THEN pre.route_name
      WHEN cri.route_name IS NOT NULL AND cri.route_name != pv.cycle_name THEN cri.route_name
      WHEN plan_id.route_name IS NOT NULL AND plan_id.route_name != pv.cycle_name THEN plan_id.route_name
      WHEN crp.route_name IS NOT NULL AND crp.route_name != pv.cycle_name THEN crp.route_name
      WHEN plan_plate.route_name IS NOT NULL AND plan_plate.route_name != pv.cycle_name THEN plan_plate.route_name
      WHEN pv.cluster_route_name IS NOT NULL AND pv.cluster_route_name != pv.cycle_name THEN pv.cluster_route_name
      ELSE NULL
    END AS route_name,

    CASE
      WHEN pre.route_name IS NOT NULL AND pre.route_name != pv.cycle_name THEN 'precheckin_executed_route_id'
      WHEN cri.route_name IS NOT NULL AND cri.route_name != pv.cycle_name THEN 'cycle_route_planned_id'
      WHEN plan_id.route_name IS NOT NULL AND plan_id.route_name != pv.cycle_name THEN 'planification_planned_id'
      WHEN crp.route_name IS NOT NULL AND crp.route_name != pv.cycle_name THEN 'cycle_route_plate'
      WHEN plan_plate.route_name IS NOT NULL AND plan_plate.route_name != pv.cycle_name THEN 'planification_plate'
      WHEN pv.cluster_route_name IS NOT NULL AND pv.cluster_route_name != pv.cycle_name THEN 'loading_zones_process'
      WHEN crp.route_candidate_count > 1 THEN 'ambiguous'
      WHEN plan_id.plan_id_candidate_count > 0
        OR plan_plate.plan_plate_candidate_count > 0
        OR pv.cluster_route_name = pv.cycle_name THEN 'generic_cycle_name'
      ELSE 'unresolved'
    END AS route_source,

    CASE
      WHEN (
        (pre.route_name IS NOT NULL AND pre.route_name != pv.cycle_name)
        OR (cri.route_name IS NOT NULL AND cri.route_name != pv.cycle_name)
        OR (plan_id.route_name IS NOT NULL AND plan_id.route_name != pv.cycle_name)
        OR (crp.route_name IS NOT NULL AND crp.route_name != pv.cycle_name)
        OR (plan_plate.route_name IS NOT NULL AND plan_plate.route_name != pv.cycle_name)
        OR (pv.cluster_route_name IS NOT NULL AND pv.cluster_route_name != pv.cycle_name)
      ) THEN 'resolved'
      WHEN crp.route_candidate_count > 1 THEN 'ambiguous'
      WHEN plan_id.plan_id_candidate_count > 0
        OR plan_plate.plan_plate_candidate_count > 0
        OR pv.cluster_route_name = pv.cycle_name THEN 'generic_cycle_name'
      ELSE 'unresolved'
    END AS route_resolution_status,

    crp.route_candidate_count,
    plan_id.plan_id_candidate_count,
    plan_plate.plan_plate_candidate_count,

    pre.carrier_id AS executed_carrier_id,
    pre.carrier_name AS executed_carrier_name,
    COALESCE(cri.carrier_id, pv.process_carrier_id) AS planned_carrier_id,
    planned_cl.carrier_name AS planned_carrier_name,

    COALESCE(pre.carrier_id, pv.journey_carrier_id, pv.process_carrier_id) AS carrier_id,
    COALESCE(pre.carrier_name, journey_cl.carrier_name, process_cl.carrier_name) AS carrier_name,

    CASE
      WHEN pre.carrier_id IS NOT NULL THEN 'precheckin_executed_route'
      WHEN pv.journey_carrier_id IS NOT NULL THEN 'journey_planner'
      WHEN pv.process_carrier_id IS NOT NULL THEN 'loading_zones_process'
      ELSE 'unresolved'
    END AS carrier_source,

    CASE
      WHEN pre.carrier_id IS NOT NULL
       AND pv.process_carrier_id IS NOT NULL
       AND pre.carrier_id != pv.process_carrier_id
        THEN 'executed_differs_from_planned'
      WHEN COALESCE(pre.carrier_id, pv.journey_carrier_id, pv.process_carrier_id) IS NOT NULL
        THEN 'resolved'
      ELSE 'unresolved'
    END AS carrier_resolution_status,

    pv.plate,

    ep.loading_zone_name,
    pk.parking_area_name,

    ep.yms_check_in_at,
    ep.dock_in_at,
    ep.loading_started_at,
    ep.dock_out_at,
    ep.gate_out_at,

    ep.customs_queue_at,
    ep.customs_started_at,
    ep.customs_last_activity_at,

    ep.latest_event.event_name AS latest_event_name,
    ep.latest_event.status AS latest_status,
    ep.latest_event.purpose_status AS latest_purpose_status,
    ep.latest_event.event_at AS latest_event_at

  FROM process_vehicle pv

  LEFT JOIN precheckin_route_prep pre
    ON pre.facility_id = pv.facility_id
   AND pre.executed_route_id = pv.executed_route_id
   AND pre.route_effective_date
       BETWEEN DATE_SUB(pv.operation_date, INTERVAL 1 DAY)
           AND DATE_ADD(pv.operation_date, INTERVAL 1 DAY)

  LEFT JOIN cycle_route_id_prep cri
    ON cri.facility_id = pv.facility_id
   AND cri.operation_date = pv.operation_date
   AND cri.cycle_name = pv.cycle_name
   AND cri.wave_number = pv.wave_number
   AND cri.planned_route_id = pv.planned_route_id

  LEFT JOIN plan_by_id_prep plan_id
    ON plan_id.process_id = pv.process_id

  LEFT JOIN cycle_route_plate_prep crp
    ON crp.facility_id = pv.facility_id
   AND crp.operation_date = pv.operation_date
   AND crp.cycle_name = pv.cycle_name
   AND crp.wave_number = pv.wave_number
   AND crp.plate_normalized = pv.plate_normalized

  LEFT JOIN plan_by_plate_prep plan_plate
    ON plan_plate.process_id = pv.process_id

  LEFT JOIN carrier_lookup planned_cl
    ON planned_cl.carrier_id = COALESCE(cri.carrier_id, pv.process_carrier_id)

  LEFT JOIN carrier_lookup journey_cl
    ON journey_cl.carrier_id = pv.journey_carrier_id

  LEFT JOIN carrier_lookup process_cl
    ON process_cl.carrier_id = pv.process_carrier_id

  LEFT JOIN event_prep ep
    ON ep.process_id = pv.process_id

  LEFT JOIN parking_lookup pk
    ON pk.parking_area_id = ep.parking_area_id
)

SELECT * FROM final_result_cte;

-- RESUMO FINAL DE VALIDACAO
SELECT
  COUNT(*) AS total_rows,
  COUNT(DISTINCT process_id) AS distinct_processes,
  COUNTIF(route_resolution_status = 'resolved') AS resolved_routes,
  COUNTIF(route_resolution_status = 'generic_cycle_name') AS generic_cycle_name_routes,
  COUNTIF(route_resolution_status = 'ambiguous') AS ambiguous_routes,
  COUNTIF(route_resolution_status = 'unresolved') AS unresolved_routes,
  COUNTIF(route_changed_from_plan) AS changed_from_plan,
  COUNTIF(NOT route_changed_from_plan) AS unchanged_from_plan,
  COUNTIF(latest_event_name = 'gate-out') AS gate_out_count,
  COUNTIF(latest_event_name = 'killed') AS killed_count,
  COUNTIF(latest_event_name = 'canceled') AS canceled_count,
  COUNTIF(latest_event_name = 'skipped') AS skipped_count
FROM final_result;

-- FONTES DE RESOLUCAO
SELECT
  route_source,
  route_resolution_status,
  COUNT(*) AS routes
FROM final_result
GROUP BY route_source, route_resolution_status
ORDER BY routes DESC, route_source;

-- SOMENTE PROBLEMAS RESTANTES
SELECT
  process_id,
  journey_id,
  wave_number,
  executed_route_id,
  planned_route_id,
  executed_route_name,
  planned_route_name,
  route_name,
  route_source,
  route_resolution_status,
  plate,
  latest_event_name,
  latest_status
FROM final_result
WHERE route_resolution_status != 'resolved'
ORDER BY wave_number, process_id;

-- DUPLICIDADES
SELECT
  process_id,
  COUNT(*) AS row_count
FROM final_result
GROUP BY process_id
HAVING COUNT(*) > 1
ORDER BY row_count DESC, process_id;
