-- Descoberta de chave de rota e divergencia de carrier para o caso AM1 validado.
-- Nao altera dados. Executar no BigQuery e trazer somente o resultado.

DECLARE facility_filter STRING DEFAULT 'SSP15';
DECLARE operation_date_filter DATE DEFAULT '2026-09-02';
DECLARE process_id_filter STRING DEFAULT '9e79df59-fb2e-59d4-9f00-da8e80299f59';
DECLARE journey_id_filter STRING DEFAULT '8a323362-6c09-46b0-a7d9-af9c7154d891';
DECLARE plate_filter STRING DEFAULT 'SDD-UEO6I01';

-- A) Descobrir campos relacionados a rota/cluster/placa/journey/carrier
-- nas tabelas que ja fazem parte da solucao.
SELECT
  table_name,
  field_path,
  data_type
FROM `meli-bi-data.WHOWNER.INFORMATION_SCHEMA.COLUMN_FIELD_PATHS`
WHERE table_name IN (
  'BT_LOADING_ZONES_PROCESS_LM',
  'BT_YMS_JOURNEY_PLANNER',
  'BT_PRECHECKIN_TRACEABILITY_LM',
  'BT_CYCLE_ROUTE',
  'BT_YMS_PLANIFICATION_OPERATIVE_LM'
)
AND REGEXP_CONTAINS(
  UPPER(field_path),
  r'(ROUTE|CLUSTER|PLATE|JOURNEY|CARRIER|PROCESS)'
)
ORDER BY table_name, field_path;

-- B) Comparar carrier do processo vs carrier do journey.
WITH process_carrier AS (
  SELECT DISTINCT
    CAST(CARRIER_ID AS STRING) AS carrier_id,
    JOURNEY_ID AS journey_id,
    CLUSTER_ROUTE_NAME AS cluster_route_name
  FROM `meli-bi-data.WHOWNER.BT_LOADING_ZONES_PROCESS_LM`
  WHERE PROCESS_ID = process_id_filter
),
journey_carrier AS (
  SELECT
    JOURNEY_ID AS journey_id,
    CAST(CARRIER.CARRIER_ID AS STRING) AS carrier_id,
    (
      SELECT v.VEHICLE_PLATE
      FROM UNNEST(VEHICLES) v
      WHERE SAFE_CAST(v.VEHICLE_SEQUENCE AS INT64) = 1
      LIMIT 1
    ) AS plate
  FROM `meli-bi-data.WHOWNER.BT_YMS_JOURNEY_PLANNER`
  WHERE JOURNEY_ID = journey_id_filter
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY JOURNEY_ID
    ORDER BY JOURNEY_ID
  ) = 1
),
carrier_ids AS (
  SELECT carrier_id, 'process' AS carrier_source FROM process_carrier
  UNION ALL
  SELECT carrier_id, 'journey' AS carrier_source FROM journey_carrier
),
carrier_names AS (
  SELECT
    CAST(CARRIER_ID AS STRING) AS carrier_id,
    ARRAY_AGG(
      CARRIER_NAME IGNORE NULLS
      ORDER BY ROUTE_DATE DESC
      LIMIT 1
    )[SAFE_OFFSET(0)] AS carrier_name
  FROM `meli-bi-data.WHOWNER.BT_PRECHECKIN_TRACEABILITY_LM`
  WHERE FACILITY_ID = facility_filter
    AND DATE(ROUTE_DATE)
        BETWEEN DATE_SUB(operation_date_filter, INTERVAL 3 DAY)
            AND DATE_ADD(operation_date_filter, INTERVAL 1 DAY)
  GROUP BY CAST(CARRIER_ID AS STRING)
)
SELECT
  ci.carrier_source,
  ci.carrier_id,
  cn.carrier_name,
  pc.journey_id AS process_journey_id,
  pc.cluster_route_name,
  jc.plate
FROM carrier_ids ci
LEFT JOIN carrier_names cn
  ON cn.carrier_id = ci.carrier_id
CROSS JOIN process_carrier pc
CROSS JOIN journey_carrier jc
ORDER BY ci.carrier_source;

-- C) Confirmar se a placa aparece no cycle route em uma janela maior.
SELECT
  FACILITY_ID AS facility_id,
  DATE(CYCLE_DATE) AS operation_date,
  CYCLE_NAME AS cycle_name,
  SAFE_CAST(WAVE_NUMBER AS INT64) AS wave_number,
  ROUTE_NAME AS route_name,
  VEHICLE_PLATE_ID AS plate,
  DOCK_USE_TYPE AS dock_use_type
FROM `meli-bi-data.WHOWNER.BT_CYCLE_ROUTE`
WHERE FACILITY_ID = facility_filter
  AND VEHICLE_PLATE_ID = plate_filter
  AND DATE(CYCLE_DATE)
      BETWEEN DATE_SUB(operation_date_filter, INTERVAL 7 DAY)
          AND DATE_ADD(operation_date_filter, INTERVAL 7 DAY)
ORDER BY operation_date, cycle_name, wave_number, route_name;
