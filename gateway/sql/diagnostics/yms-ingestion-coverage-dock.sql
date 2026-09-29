-- Diagnostico de ingestao, cobertura do dia e docas YMS.
-- Somente leitura.
DECLARE facility_filter STRING DEFAULT 'SSP15';
DECLARE cycle_filter STRING DEFAULT 'AM1';
DECLARE timezone_name STRING DEFAULT 'America/Sao_Paulo';
DECLARE operation_date_filter DATE DEFAULT CURRENT_DATE(timezone_name);

-- 1) Descobrir se a tabela de eventos possui campo de ingestao/atualizacao
-- e qual coluna e usada para particionamento.
SELECT
  column_name,
  data_type,
  is_partitioning_column,
  clustering_ordinal_position
FROM `meli-bi-data.WHOWNER.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name = 'BT_YMS_LOADING_ZONES_EVENTS'
  AND REGEXP_CONTAINS(
    UPPER(column_name),
    r'(CREAT|UPDAT|MODIF|INSERT|INGEST|LOAD|AUDIT|PARTITION|STAMP|TIME|DATE)'
  )
ORDER BY ordinal_position;

-- 2) Ultimos eventos do dia para entender se 10:00 foi fim da operacao
-- ou apenas atraso de disponibilidade.
WITH day_processes AS (
  SELECT DISTINCT plm.PROCESS_ID AS process_id
  FROM `meli-bi-data.WHOWNER.BT_CYCLE_SUMMARY_LM` cs
  JOIN `meli-bi-data.WHOWNER.BT_LOADING_ZONES_PROCESS_LM` plm
    ON plm.CYCLE_SUMMARY_ID = cs.CYCLE_SUMMARY_ID
  WHERE cs.LOGISTIC_CENTER_ID = facility_filter
    AND cs.CYCLE_NAME = cycle_filter
    AND DATE(cs.CYCLE_SCHEDULED_TO) = operation_date_filter
    AND plm.PROCESS_ID IS NOT NULL
)
SELECT
  e.PROCESS_ID AS process_id,
  e.CREATED_AT AS event_at,
  e.EVENT_NAME AS event_name,
  e.STATUS AS status,
  e.PURPOSE_STATUS AS purpose_status,
  e.LOADING_ZONE_NAME AS loading_zone_name
FROM `meli-bi-data.WHOWNER.BT_YMS_LOADING_ZONES_EVENTS` e
JOIN day_processes p
  ON p.process_id = e.PROCESS_ID
WHERE e.MILE = 'last_mile'
  AND DATE(e.CREATED_AT) = operation_date_filter
ORDER BY e.CREATED_AT DESC
LIMIT 30;

-- 3) Volume de eventos por hora no dia.
WITH day_processes AS (
  SELECT DISTINCT plm.PROCESS_ID AS process_id
  FROM `meli-bi-data.WHOWNER.BT_CYCLE_SUMMARY_LM` cs
  JOIN `meli-bi-data.WHOWNER.BT_LOADING_ZONES_PROCESS_LM` plm
    ON plm.CYCLE_SUMMARY_ID = cs.CYCLE_SUMMARY_ID
  WHERE cs.LOGISTIC_CENTER_ID = facility_filter
    AND cs.CYCLE_NAME = cycle_filter
    AND DATE(cs.CYCLE_SCHEDULED_TO) = operation_date_filter
    AND plm.PROCESS_ID IS NOT NULL
)
SELECT
  EXTRACT(HOUR FROM e.CREATED_AT) AS event_hour,
  COUNT(*) AS event_rows,
  COUNT(DISTINCT e.PROCESS_ID) AS processes,
  MIN(e.CREATED_AT) AS first_event_at,
  MAX(e.CREATED_AT) AS last_event_at
FROM `meli-bi-data.WHOWNER.BT_YMS_LOADING_ZONES_EVENTS` e
JOIN day_processes p
  ON p.process_id = e.PROCESS_ID
WHERE e.MILE = 'last_mile'
  AND DATE(e.CREATED_AT) = operation_date_filter
GROUP BY event_hour
ORDER BY event_hour;

-- 4) Processos AM1 do dia que nao possuem nenhum evento no mesmo dia.
WITH day_processes AS (
  SELECT DISTINCT
    plm.PROCESS_ID AS process_id,
    plm.JOURNEY_ID AS journey_id,
    NULLIF(CAST(plm.EXECUTED_ROUTE_ID AS STRING), '') AS process_executed_route_id,
    NULLIF(CAST(plm.ROUTE_PLAN_ID AS STRING), '') AS process_planned_route_id,
    plm.CLUSTER_ROUTE_NAME AS cluster_route_name,
    SAFE_CAST(cs.POSITION AS INT64) AS wave_number
  FROM `meli-bi-data.WHOWNER.BT_CYCLE_SUMMARY_LM` cs
  JOIN `meli-bi-data.WHOWNER.BT_LOADING_ZONES_PROCESS_LM` plm
    ON plm.CYCLE_SUMMARY_ID = cs.CYCLE_SUMMARY_ID
  WHERE cs.LOGISTIC_CENTER_ID = facility_filter
    AND cs.CYCLE_NAME = cycle_filter
    AND DATE(cs.CYCLE_SCHEDULED_TO) = operation_date_filter
    AND plm.PROCESS_ID IS NOT NULL
),
event_coverage AS (
  SELECT
    PROCESS_ID AS process_id,
    COUNT(*) AS event_rows_today,
    MAX(CREATED_AT) AS latest_event_at
  FROM `meli-bi-data.WHOWNER.BT_YMS_LOADING_ZONES_EVENTS`
  WHERE MILE = 'last_mile'
    AND DATE(CREATED_AT) = operation_date_filter
  GROUP BY PROCESS_ID
)
SELECT
  p.wave_number,
  p.process_id,
  p.journey_id,
  p.process_executed_route_id,
  p.process_planned_route_id,
  p.cluster_route_name,
  COALESCE(e.event_rows_today, 0) AS event_rows_today,
  e.latest_event_at
FROM day_processes p
LEFT JOIN event_coverage e
  ON e.process_id = p.process_id
WHERE COALESCE(e.event_rows_today, 0) = 0
ORDER BY p.wave_number, p.process_id;

-- 5) Campos relacionados a doca/loading zone nas tabelas YMS usadas.
SELECT
  table_name,
  field_path,
  data_type
FROM `meli-bi-data.WHOWNER.INFORMATION_SCHEMA.COLUMN_FIELD_PATHS`
WHERE table_name IN (
  'BT_YMS_LOADING_ZONES_EVENTS',
  'BT_LOADING_ZONES_PROCESS_LM',
  'BT_CYCLE_ROUTE',
  'BT_YMS_PLANIFICATION_OPERATIVE_LM'
)
AND REGEXP_CONTAINS(
  UPPER(field_path),
  r'(DOCK|LOADING_ZONE|LOADINGZONE|ZONE_NAME|BAY)'
)
ORDER BY table_name, field_path;
