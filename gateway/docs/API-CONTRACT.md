# Contrato das APIs operacionais

Este documento registra apenas o contrato conhecido e os campos necessarios ao painel. A autenticacao oficial continua fora deste documento e do frontend.

## Dispatch

```text
GET https://envios.adminml.com/logistics/last-mile/monitoring/frm-provider/api/dispatch
```

Parametros:

- `facilityId`
- `groupId` — aceito somente quando estiver na allowlist `ALLOWED_GROUP_IDS` do gateway
- `siteId`
- `wave`

Campos utilizados depois da sanitizacao:

- `route_name`
- `route_id`
- `process`
- `dock_number`
- `start_time`
- `total_elapsed_time`

Processos ja conhecidos:

- `waiting_customs`
- `customs_in_progress`
- `loading_packages`
- `dispatched`

Na regra atual do painel, `dispatched` significa que a saida/expedicao foi concluida.

## Aduana

```text
GET https://envios.adminml.com/logistics/audit/api/audits/search
```

Parametros:

- `auditType=driver`
- `timezone=America/Sao_Paulo`

Campos publicos necessarios depois da sanitizacao:

- `route_name`
- `route_id`
- `status`
- `process`
- `operator_name`
- `audit_time`
- `aduanaUnidades`
- `aduanaBipadas`
- `driver_name`
- `carrier_name`
- `plate`

`route_id` e a chave preferencial de associacao entre as fontes.

No payload bruto conhecido da Aduana, o adapter normaliza `driver.route_id` para `route_id` e `driver.cluster_id` para `route_name`. O formato plano permanece aceito por compatibilidade. IDs internos presentes em `driver`, como `driver_id`, `vehicle_id` e `carrier_id`, e `operator_id` nao fazem parte da resposta publica.

## YMS / BigQuery

A fonte YMS/BigQuery foi validada para SSP15 / AM1 em 02/09/2026 com 124 de 124 rotas resolvidas.

O runtime ainda nao executa BigQuery. Nesta etapa foram adicionados apenas:

- normalizador isolado em `src/adapters/yms.js`;
- sanitizador por allowlist em `src/sanitizers/yms.js`;
- testes unitarios de classificacao e remocao de IDs internos.

Campos publicos previstos depois da sanitizacao:

- `facility_id`
- `operation_date`
- `cycle_name`
- `wave_number`
- `route_name`
- `planned_route_name`
- `route_changed_from_plan`
- `carrier_name`
- `planned_carrier_name`
- `plate`
- `loading_zone_name`
- `parking_area_name`
- `yms_check_in_at`
- `dock_in_at`
- `customs_queue_at`
- `customs_started_at`
- `customs_last_activity_at`
- `loading_started_at`
- `dock_out_at`
- `gate_out_at`
- `latest_event_name`
- `latest_status`
- `latest_purpose_status`
- `latest_event_at`
- `lifecycle_stage`
- `dispatch_confirmed`
- `terminal_exception`

`source_process_id`, IDs de rota YMS, journey/driver IDs e carrier IDs internos nao fazem parte da resposta publica.

Classificacao backend prevista:

- `gate-out / PROCESS_FINISHED` ou `gate_out_at` confirmado -> `dispatched`
- `killed`, `canceled` ou `skipped` -> `terminal_exception`
- `DOING_AUDIT` -> `customs_in_progress`
- `WAITING_FOR_AUDIT` -> `waiting_customs`
- `LOADING_PACKAGES_STARTED` -> `loading_packages`

`terminal_exception` nunca deve ser convertido automaticamente em `dispatched`.


## Exclusoes obrigatorias

O gateway nao deve entregar ao frontend CPF, documento, e-mail, telefone, tokens, cookies ou headers internos. Corpos brutos das fontes nunca devem contornar os sanitizadores por allowlist.
