-- Diagnostico de resolucao de rota YMS/BigQuery para AM1.
-- Caso real identificado na validacao de 02/09/2026:
-- process_id 9e79df59-fb2e-59d4-9f00-da8e80299f59
-- plate SDD-UEO6I01
-- wave 1
-- route_name atual = AM1 (generico)

DECLARE facility_filter STRING DEFAULT 'SSP15';
DECLARE cycle_filter STRING DEFAULT 'AM1';
DECLARE operation_date_filter DATE DEFAULT '2026-09-02';
DECLARE process_id_filter STRING DEFAULT '9e79df59-fb2e-59d4-9f00-da8e80299f59';
DECLARE plate_filter STRING DEFAULT 'SDD-UEO6I01';
DECLARE wave_filter INT64 DEFAULT 1;

-- 1) Processo base e cycle summary.
SELECT
  'process_base' AS source,
  cs.LOGISTIC_CENTER_ID AS facility_id,
  DATE(cs.CYCLE_SCHEDULED_TO) AS operation_date,
  cs.CYCLE_NAME AS cycle_name,
  SAFE_CAST(cs.POSITION AS INT64) AS wave_number,
  plm.PROCESS_ID AS process_id,
  plm.JOURNEY_ID AS journey_id,
  plm.CLUSTER_ROUTE_NAME AS route_candidate,
  CAST(plm.CARRIER_ID AS STRING) AS carrier_id,
  CAST(NULL AS STRING) AS plate,
  CAST(NULL AS DATETIME) AS reference_at
FROM `meli-bi-data.WHOWNER.BT_CYCLE_SUMMARY_LM` cs
JOIN `meli-bi-data.WHOWNER.BT_LOADING_ZONES_PROCESS_LM` plm
  ON plm.CYCLE_SUMMARY_ID = cs.CYCLE_SUMMARY_ID
WHERE cs.LOGISTIC_CENTER_ID = facility_filter
  AND cs.CYCLE_NAME = cycle_filter
  AND DATE(cs.CYCLE_SCHEDULED_TO) = operation_date_filter
  AND plm.PROCESS_ID = process_id_filter;

-- 2) BT_CYCLE_ROUTE: procurar a placa sem impor primeiro o cycle_name/wave.
SELECT
  'cycle_route' AS source,
  FACILITY_ID AS facility_id,
  DATE(CYCLE_DATE) AS operation_date,
  CYCLE_NAME AS cycle_name,
  SAFE_CAST(WAVE_NUMBER AS INT64) AS wave_number,
  CAST(NULL AS STRING) AS process_id,
  CAST(NULL AS STRING) AS journey_id,
  ROUTE_NAME AS route_candidate,
  CAST(NULL AS STRING) AS carrier_id,
  VEHICLE_PLATE_ID AS plate,
  CAST(NULL AS DATETIME) AS reference_at
FROM `meli-bi-data.WHOWNER.BT_CYCLE_ROUTE`
WHERE FACILITY_ID = facility_filter
  AND DATE(CYCLE_DATE)
      BETWEEN DATE_SUB(operation_date_filter, INTERVAL 1 DAY)
          AND DATE_ADD(operation_date_filter, INTERVAL 1 DAY)
  AND VEHICLE_PLATE_ID = plate_filter
ORDER BY operation_date, cycle_name, wave_number, route_candidate;

-- 3) Planificacao: procurar a placa sem impor primeiro a data exata.
SELECT
  'planification' AS source,
  FACILITY AS facility_id,
  DATE(MODIFICATION_DATE) AS operation_date,
  CAST(NULL AS STRING) AS cycle_name,
  SAFE_CAST(WAVE AS INT64) AS wave_number,
  CAST(NULL AS STRING) AS process_id,
  CAST(NULL AS STRING) AS journey_id,
  ROUTE AS route_candidate,
  CAST(NULL AS STRING) AS carrier_id,
  PLATE AS plate,
  MODIFICATION_DATE AS reference_at
FROM `meli-bi-data.WHOWNER.BT_YMS_PLANIFICATION_OPERATIVE_LM`
WHERE FACILITY = facility_filter
  AND PLATE = plate_filter
  AND DATE(MODIFICATION_DATE)
      BETWEEN DATE_SUB(operation_date_filter, INTERVAL 2 DAY)
          AND DATE_ADD(operation_date_filter, INTERVAL 1 DAY)
ORDER BY reference_at DESC;

-- 4) Eventos do processo para confirmar que o process_id e a placa correspondem
-- ao lifecycle observado.
SELECT
  'events' AS source,
  CAST(NULL AS STRING) AS facility_id,
  DATE(CREATED_AT) AS operation_date,
  CAST(NULL AS STRING) AS cycle_name,
  CAST(NULL AS INT64) AS wave_number,
  PROCESS_ID AS process_id,
  CAST(NULL AS STRING) AS journey_id,
  EVENT_NAME AS route_candidate,
  CAST(NULL AS STRING) AS carrier_id,
  CAST(NULL AS STRING) AS plate,
  CREATED_AT AS reference_at
FROM `meli-bi-data.WHOWNER.BT_YMS_LOADING_ZONES_EVENTS`
WHERE PROCESS_ID = process_id_filter
ORDER BY reference_at;
