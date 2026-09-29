-- Diagnostico do unico processo AM1 nao resolvido na validacao de 02/09/2026.
-- Somente leitura.
DECLARE facility_filter STRING DEFAULT 'SSP15';
DECLARE operation_date_filter DATE DEFAULT '2026-09-02';
DECLARE process_id_filter STRING DEFAULT '6e8e69dc-c158-5e1f-a0aa-0c34961121d1';
DECLARE journey_id_filter STRING DEFAULT '77479ce0-5d6b-4cd3-b5a1-d87e3b173a34';
DECLARE executed_route_id_filter STRING DEFAULT '433965323';
DECLARE planned_route_id_filter STRING DEFAULT '503226587006';
DECLARE plate_filter STRING DEFAULT 'FXY4E11';

-- A) Precheckin pelo executed_route_id, sem restringir ao mesmo dia.
SELECT
  'executed_id' AS match_type,
  FACILITY_ID AS facility_id,
  ROUTE_DATE AS route_date,
  CAST(ROUTE_ID AS STRING) AS route_id,
  CAST(PLANNED_ROUTE_ID AS STRING) AS planned_route_id,
  CLUSTER_ID AS route_name,
  VEHICLE_PLATE_ID AS plate,
  CAST(CARRIER_ID AS STRING) AS carrier_id,
  CARRIER_NAME AS carrier_name,
  ROUTE_INIT_DATE AS route_init_at,
  ROUTE_FINISH_DATE AS route_finish_at
FROM `meli-bi-data.WHOWNER.BT_PRECHECKIN_TRACEABILITY_LM`
WHERE FACILITY_ID = facility_filter
  AND CAST(ROUTE_ID AS STRING) = executed_route_id_filter
  AND ROUTE_DATE
      BETWEEN DATE_SUB(operation_date_filter, INTERVAL 7 DAY)
          AND DATE_ADD(operation_date_filter, INTERVAL 7 DAY)

UNION ALL

-- B) Precheckin pela placa, para descobrir eventual divergencia do executed_route_id.
SELECT
  'plate' AS match_type,
  FACILITY_ID AS facility_id,
  ROUTE_DATE AS route_date,
  CAST(ROUTE_ID AS STRING) AS route_id,
  CAST(PLANNED_ROUTE_ID AS STRING) AS planned_route_id,
  CLUSTER_ID AS route_name,
  VEHICLE_PLATE_ID AS plate,
  CAST(CARRIER_ID AS STRING) AS carrier_id,
  CARRIER_NAME AS carrier_name,
  ROUTE_INIT_DATE AS route_init_at,
  ROUTE_FINISH_DATE AS route_finish_at
FROM `meli-bi-data.WHOWNER.BT_PRECHECKIN_TRACEABILITY_LM`
WHERE FACILITY_ID = facility_filter
  AND REGEXP_REPLACE(UPPER(VEHICLE_PLATE_ID), r'[^A-Z0-9]', '')
      = REGEXP_REPLACE(UPPER(plate_filter), r'[^A-Z0-9]', '')
  AND ROUTE_DATE
      BETWEEN DATE_SUB(operation_date_filter, INTERVAL 7 DAY)
          AND DATE_ADD(operation_date_filter, INTERVAL 7 DAY)
ORDER BY route_date, match_type, route_name;

-- C) Cycle Route pelo planned_route_id.
SELECT
  FACILITY_ID AS facility_id,
  DATE(CYCLE_DATE) AS operation_date,
  CYCLE_NAME AS cycle_name,
  SAFE_CAST(WAVE_NUMBER AS INT64) AS wave_number,
  CAST(ROUTE_ID AS STRING) AS route_id,
  CAST(ROUTE_PLANNED_ID AS STRING) AS planned_route_id,
  CAST(MOV_ROUTE_ID AS STRING) AS moved_route_id,
  ROUTE_NAME AS route_name,
  ROUTE_ORIGINAL_NAME AS original_route_name,
  VEHICLE_PLATE_ID AS plate,
  CAST(CARRIER_ID AS STRING) AS carrier_id,
  ROUTE_CREATED_DTTM AS created_at,
  ROUTE_LAST_UPDATED_DTTM AS updated_at
FROM `meli-bi-data.WHOWNER.BT_CYCLE_ROUTE`
WHERE FACILITY_ID = facility_filter
  AND DATE(CYCLE_DATE)
      BETWEEN DATE_SUB(operation_date_filter, INTERVAL 2 DAY)
          AND DATE_ADD(operation_date_filter, INTERVAL 2 DAY)
  AND (
    CAST(ROUTE_PLANNED_ID AS STRING) = planned_route_id_filter
    OR CAST(ROUTE_ID AS STRING) = executed_route_id_filter
    OR CAST(MOV_ROUTE_ID AS STRING) = executed_route_id_filter
  )
ORDER BY operation_date, cycle_name, wave_number, route_name;

-- D) Journey purpose last_mile para confirmar IDs.
SELECT
  jp.JOURNEY_ID AS journey_id,
  p.MILE AS mile,
  p.PROCESS_TYPE AS process_type,
  CAST(p.ROUTE.PLAN_ID AS STRING) AS purpose_plan_id,
  CAST(p.ROUTE.EXECUTED_ID AS STRING) AS purpose_executed_id,
  p.ROUTE.ROUTE_TYPE AS route_type,
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
  AND p.MILE = 'last_mile';

-- E) Planificacao pelo planned_route_id.
SELECT
  FACILITY AS facility_id,
  DATE(MODIFICATION_DATE) AS modification_date,
  SAFE_CAST(WAVE AS INT64) AS wave_number,
  ROUTE AS route_name,
  CAST(PLANNED_ROUTE_ID AS STRING) AS planned_route_id,
  PLATE AS plate,
  JOURNEY_STATUS AS journey_status,
  MODIFICATION_DATE AS modification_at
FROM `meli-bi-data.WHOWNER.BT_YMS_PLANIFICATION_OPERATIVE_LM`
WHERE FACILITY = facility_filter
  AND CAST(PLANNED_ROUTE_ID AS STRING) = planned_route_id_filter
  AND DATE(MODIFICATION_DATE)
      BETWEEN DATE_SUB(operation_date_filter, INTERVAL 2 DAY)
          AND DATE_ADD(operation_date_filter, INTERVAL 2 DAY)
ORDER BY modification_at DESC;
