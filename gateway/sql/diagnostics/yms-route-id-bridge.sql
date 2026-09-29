-- Diagnostico de ponte de IDs de rota para AM1.
-- Caso validado em 02/09/2026.
-- Somente leitura: nao altera dados.

DECLARE facility_filter STRING DEFAULT 'SSP15';
DECLARE operation_date_filter DATE DEFAULT '2026-09-02';
DECLARE process_id_filter STRING DEFAULT '9e79df59-fb2e-59d4-9f00-da8e80299f59';
DECLARE journey_id_filter STRING DEFAULT '8a323362-6c09-46b0-a7d9-af9c7154d891';
DECLARE plate_filter STRING DEFAULT 'SDD-UEO6I01';

-- A) IDs de rota que existem diretamente no processo.
WITH process_route AS (
  SELECT DISTINCT
    PROCESS_ID AS process_id,
    JOURNEY_ID AS journey_id,
    CLUSTER_ROUTE_NAME AS cluster_route_name,
    CAST(EXECUTED_ROUTE_ID AS STRING) AS executed_route_id,
    CAST(ROUTE_PLAN_ID AS STRING) AS route_plan_id,
    CAST(CARRIER_ID AS STRING) AS carrier_id
  FROM `meli-bi-data.WHOWNER.BT_LOADING_ZONES_PROCESS_LM`
  WHERE PROCESS_ID = process_id_filter
)
SELECT *
FROM process_route;

-- B) IDs de rota guardados no PURPOSE last_mile do Journey Planner.
SELECT
  jp.JOURNEY_ID AS journey_id,
  p.MILE AS mile,
  p.PROCESS_TYPE AS process_type,
  CAST(p.ROUTE.PLAN_ID AS STRING) AS purpose_plan_id,
  CAST(p.ROUTE.EXECUTED_ID AS STRING) AS purpose_executed_id,
  p.ROUTE.ROUTE_TYPE AS purpose_route_type,
  CAST(jp.CARRIER.CARRIER_ID AS STRING) AS journey_carrier_id,
  (
    SELECT v.VEHICLE_PLATE
    FROM UNNEST(jp.VEHICLES) v
    WHERE SAFE_CAST(v.VEHICLE_SEQUENCE AS INT64) = 1
    LIMIT 1
  ) AS plate
FROM `meli-bi-data.WHOWNER.BT_YMS_JOURNEY_PLANNER` jp,
UNNEST(jp.PURPOSES) p
WHERE jp.JOURNEY_ID = journey_id_filter
ORDER BY mile, process_type, purpose_plan_id, purpose_executed_id;

-- C) Procurar os IDs candidatos na planificacao.
WITH ids AS (
  SELECT DISTINCT id
  FROM (
    SELECT CAST(EXECUTED_ROUTE_ID AS STRING) AS id
    FROM `meli-bi-data.WHOWNER.BT_LOADING_ZONES_PROCESS_LM`
    WHERE PROCESS_ID = process_id_filter

    UNION ALL

    SELECT CAST(ROUTE_PLAN_ID AS STRING) AS id
    FROM `meli-bi-data.WHOWNER.BT_LOADING_ZONES_PROCESS_LM`
    WHERE PROCESS_ID = process_id_filter

    UNION ALL

    SELECT CAST(p.ROUTE.PLAN_ID AS STRING) AS id
    FROM `meli-bi-data.WHOWNER.BT_YMS_JOURNEY_PLANNER` jp,
         UNNEST(jp.PURPOSES) p
    WHERE jp.JOURNEY_ID = journey_id_filter
      AND p.MILE = 'last_mile'

    UNION ALL

    SELECT CAST(p.ROUTE.EXECUTED_ID AS STRING) AS id
    FROM `meli-bi-data.WHOWNER.BT_YMS_JOURNEY_PLANNER` jp,
         UNNEST(jp.PURPOSES) p
    WHERE jp.JOURNEY_ID = journey_id_filter
      AND p.MILE = 'last_mile'
  )
  WHERE id IS NOT NULL AND id != ''
)
SELECT
  p.FACILITY AS facility_id,
  DATE(p.MODIFICATION_DATE) AS modification_date,
  SAFE_CAST(p.WAVE AS INT64) AS wave_number,
  p.ROUTE AS route_name,
  CAST(p.PLANNED_ROUTE_ID AS STRING) AS planned_route_id,
  p.PLATE AS plate,
  p.JOURNEY_STATUS AS journey_status,
  p.MODIFICATION_DATE AS modification_at
FROM `meli-bi-data.WHOWNER.BT_YMS_PLANIFICATION_OPERATIVE_LM` p
WHERE p.FACILITY = facility_filter
  AND DATE(p.MODIFICATION_DATE)
      BETWEEN DATE_SUB(operation_date_filter, INTERVAL 3 DAY)
          AND DATE_ADD(operation_date_filter, INTERVAL 1 DAY)
  AND (
    CAST(p.PLANNED_ROUTE_ID AS STRING) IN (SELECT id FROM ids)
    OR p.PLATE = plate_filter
  )
ORDER BY modification_at DESC;

-- D) Procurar os IDs candidatos na rastreabilidade e no Cycle Route.
WITH ids AS (
  SELECT DISTINCT id
  FROM (
    SELECT CAST(EXECUTED_ROUTE_ID AS STRING) AS id
    FROM `meli-bi-data.WHOWNER.BT_LOADING_ZONES_PROCESS_LM`
    WHERE PROCESS_ID = process_id_filter

    UNION ALL

    SELECT CAST(ROUTE_PLAN_ID AS STRING) AS id
    FROM `meli-bi-data.WHOWNER.BT_LOADING_ZONES_PROCESS_LM`
    WHERE PROCESS_ID = process_id_filter

    UNION ALL

    SELECT CAST(p.ROUTE.PLAN_ID AS STRING) AS id
    FROM `meli-bi-data.WHOWNER.BT_YMS_JOURNEY_PLANNER` jp,
         UNNEST(jp.PURPOSES) p
    WHERE jp.JOURNEY_ID = journey_id_filter
      AND p.MILE = 'last_mile'

    UNION ALL

    SELECT CAST(p.ROUTE.EXECUTED_ID AS STRING) AS id
    FROM `meli-bi-data.WHOWNER.BT_YMS_JOURNEY_PLANNER` jp,
         UNNEST(jp.PURPOSES) p
    WHERE jp.JOURNEY_ID = journey_id_filter
      AND p.MILE = 'last_mile'
  )
  WHERE id IS NOT NULL AND id != ''
)
SELECT
  'precheckin' AS source,
  FACILITY_ID AS facility_id,
  ROUTE_DATE AS operation_date,
  CAST(ROUTE_ID AS STRING) AS route_id,
  CAST(PLANNED_ROUTE_ID AS STRING) AS planned_route_id,
  CLUSTER_ID AS route_name,
  VEHICLE_PLATE_ID AS plate,
  CAST(CARRIER_ID AS STRING) AS carrier_id,
  CARRIER_NAME AS carrier_name
FROM `meli-bi-data.WHOWNER.BT_PRECHECKIN_TRACEABILITY_LM`
WHERE FACILITY_ID = facility_filter
  AND ROUTE_DATE
      BETWEEN DATE_SUB(operation_date_filter, INTERVAL 7 DAY)
          AND DATE_ADD(operation_date_filter, INTERVAL 1 DAY)
  AND (
    CAST(ROUTE_ID AS STRING) IN (SELECT id FROM ids)
    OR CAST(PLANNED_ROUTE_ID AS STRING) IN (SELECT id FROM ids)
    OR VEHICLE_PLATE_ID = plate_filter
  )

UNION ALL

SELECT
  'cycle_route' AS source,
  FACILITY_ID AS facility_id,
  DATE(CYCLE_DATE) AS operation_date,
  CAST(ROUTE_ID AS STRING) AS route_id,
  CAST(ROUTE_PLANNED_ID AS STRING) AS planned_route_id,
  COALESCE(ROUTE_NAME, ROUTE_ORIGINAL_NAME) AS route_name,
  VEHICLE_PLATE_ID AS plate,
  CAST(CARRIER_ID AS STRING) AS carrier_id,
  CAST(NULL AS STRING) AS carrier_name
FROM `meli-bi-data.WHOWNER.BT_CYCLE_ROUTE`
WHERE FACILITY_ID = facility_filter
  AND DATE(CYCLE_DATE)
      BETWEEN DATE_SUB(operation_date_filter, INTERVAL 7 DAY)
          AND DATE_ADD(operation_date_filter, INTERVAL 1 DAY)
  AND (
    CAST(ROUTE_ID AS STRING) IN (SELECT id FROM ids)
    OR CAST(ROUTE_PLANNED_ID AS STRING) IN (SELECT id FROM ids)
    OR CAST(MOV_ROUTE_ID AS STRING) IN (SELECT id FROM ids)
    OR VEHICLE_PLATE_ID = plate_filter
  )
ORDER BY source, operation_date, route_name;
