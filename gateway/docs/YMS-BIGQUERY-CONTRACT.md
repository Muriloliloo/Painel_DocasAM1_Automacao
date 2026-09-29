# YMS / BigQuery — contrato da fonte de lifecycle

## Objetivo

Esta fonte futura complementa o gateway do Painel Docas AM1 com a linha do tempo física da rota/veículo. Ela não substitui Dispatch ou Aduana nesta etapa e ainda não está ligada ao runtime.

Arquivo SQL de referência:

`gateway/sql/yms-route-lifecycle-v2.sql`

## Arquitetura pretendida

```text
Dispatch ─┐
Aduana ───┼─> Gateway -> snapshot consolidado -> Painel
YMS/BQ ───┘
```

Responsabilidades previstas:

- **Dispatch:** status operacional atual da rota.
- **Aduana:** auditoria, status de conclusão e quantidade auditada.
- **YMS/BigQuery:** entrada na base, doca, início de carregamento, dock-out, gate-out, estacionamento, reconciliação e histórico.

Nenhuma credencial BigQuery, service account, token ou chave deve existir no frontend.

## Granularidade

A Query V2 foi desenhada para entregar **uma linha por `process_id`**.

Validação obrigatória antes da integração:

```sql
SELECT COUNT(*) AS total_rows,
       COUNT(DISTINCT process_id) AS distinct_processes
FROM final_result;
```

Os dois valores devem ser equivalentes para a janela validada. A query também contém, ao final, um diagnóstico comentado para listar `process_id` duplicado.

Não usar `SELECT DISTINCT` para esconder duplicidade sem investigar a origem.

## Chave de associação

`route_id` oficial ainda **não foi identificado com segurança nas tabelas usadas por esta query**.

Status atual:

```text
route_id_status = não identificado nesta query
```

Até confirmação, a chave técnica de rastreabilidade é:

```text
operation_date + cycle_name + wave_number + route_name + process_id
```

`process_id` e `journey_id` são campos internos do backend. Não são destinados ao navegador.

## Campos de saída

Identificação operacional:

- `facility_id`
- `operation_date`
- `cycle_name`
- `wave_number`
- `process_id`
- `journey_id`
- `executed_route_id` (ID interno da fonte YMS/Precheckin; não equivale automaticamente ao route_id do Dispatch)
- `planned_route_id`
- `cycle_route_id`
- `executed_route_name`
- `planned_route_name`
- `route_changed_from_plan`
- `route_name` (rota operacional resolvida; prioriza a executada)
- `carrier_id`
- `carrier_name`
- `plate`

Localização:

- `loading_zone_name`
- `parking_area_name`

Linha do tempo:

- `yms_check_in_at`
- `dock_in_at`
- `loading_started_at`
- `dock_out_at`
- `gate_out_at`
- `customs_queue_at`
- `customs_started_at`
- `customs_last_activity_at`

Último estado YMS conhecido:

- `latest_event_name`
- `latest_status`
- `latest_purpose_status`
- `latest_event_at`

## Semântica dos marcos

### Entrada YMS

`yms_check_in_at` usa o primeiro evento compatível com:

- `check-in-without-prior-assignment`; ou
- `updated` + `WAITING_LOADING_ZONE`, respeitando a data operacional local.

### Entrada em doca

`dock_in_at` usa o primeiro evento com:

`STATUS = 'UN-LOAD_STARTED'`

A grafia foi preservada exatamente como na fonte já conhecida e precisa ser validada no BigQuery real.

### Início de carregamento

`loading_started_at`:

- `EVENT_NAME = 'update_purpose_status'`
- `PURPOSE_STATUS = 'LOADING_PACKAGES_STARTED'`

### Saída de doca

`dock_out_at`:

`EVENT_NAME = 'check-out'`

### Saída física

`gate_out_at`:

`EVENT_NAME = 'gate-out'`

Esse campo é candidato forte para confirmação física de saída e para o cálculo futuro do OOT.

## Aduana no YMS

A Query V2 **não chama o último `DOING_AUDIT` de fim da Aduana**.

Campos seguros:

- `customs_queue_at`: primeiro `WAITING_FOR_AUDIT`;
- `customs_started_at`: primeiro `DOING_AUDIT`;
- `customs_last_activity_at`: último `DOING_AUDIT`.

A API Aduana atual continua sendo a autoridade para conclusão da auditoria e quantidade auditada até existir um evento de conclusão explicitamente confirmado no YMS.

## Associação de rota

A precedência usada é:

1. BT_CYCLE_ROUTE, com facility + data + ciclo + onda + placa;
2. planificação YMS mais recente aplicável à operação/data;
3. `CLUSTER_ROUTE_NAME` do processo.

A Query V2 não usa `MIN(ROUTE_NAME)` atravessando vários dias.

Em BT_CYCLE_ROUTE, se houver mais de um nome de rota para a mesma chave diária, o match é tratado como ambíguo e não é escolhido alfabeticamente.

## Planificação

A planificação é associada por:

- placa;
- facility;
- onda;
- data aplicável ao processo.

A janela aceita D-1 até o dia operacional e escolhe o registro com `MODIFICATION_DATE` mais recente.

Isso evita usar `MIN(ROUTE)` em uma janela histórica extensa.

## Transportadora

`carrier_id` e `carrier_name` são campos separados.

Nunca colocar ID dentro de `carrier_name`. Se o lookup do nome não existir, `carrier_name` deve permanecer nulo/vazio e o ID continua disponível apenas como identificador técnico.

## Timezone

Timezone operacional:

`America/Sao_Paulo`

Validação real em 26/09/2026 confirmou que `BT_YMS_LOADING_ZONES_EVENTS.CREATED_AT` é `DATETIME`, não `TIMESTAMP`.

Por isso, a Query V2 usa `DATE(CREATED_AT)` diretamente. `DATETIME` não carrega informação de fuso; a consulta não deve aplicar `DATE(datetime, timezone)`. A semântica operacional local ainda deve ser confirmada com exemplos próximos da meia-noite.

## Janela de eventos

A consulta de eventos cobre conceitualmente:

`D-2 até D+1`

Isso evita perder um `gate-out` ou outro evento que ocorra após meia-noite em relação ao dia operacional.

## Latência a validar

Antes de usar BigQuery/YMS como fonte de tempo real, medir:

1. horário real do evento;
2. horário em que o mesmo evento passa a ser consultável no BigQuery;
3. diferença entre os dois.

A classificação da fonte só deve ocorrer após esse teste:

- **tempo real / operacional**, se a latência for compatível com monitoramento;
- **reconciliação / histórico / fechamento**, se houver atraso significativo.

Não assumir que BigQuery é realtime.

## Uso futuro para OOT

Regra conceitual futura:

```text
gate_out_at <= deadline da onda
=> saída dentro do prazo

gate_out_at > deadline da onda
=> saída após o prazo

deadline passou + gate_out_at IS NULL
=> saída ainda não confirmada por esta fonte
```

O cálculo OOT ainda não está implementado.

## Segurança

Não expor no contrato público do navegador:

- `driver_id`;
- IDs internos de motorista/operador/veículo;
- CPF;
- documento;
- e-mail;
- telefone;
- tokens;
- cookies;
- headers internos;
- credenciais BigQuery.

Placa deve continuar sob revisão do contrato do gateway antes de exposição pública.


## Descoberta de identificadores de rota

A inspeção real do schema confirmou identificadores de rota que não estavam na Query V2 inicial:

- `BT_LOADING_ZONES_PROCESS_LM.EXECUTED_ROUTE_ID`
- `BT_LOADING_ZONES_PROCESS_LM.ROUTE_PLAN_ID`
- `BT_YMS_JOURNEY_PLANNER.PURPOSES.ROUTE.EXECUTED_ID`
- `BT_YMS_JOURNEY_PLANNER.PURPOSES.ROUTE.PLAN_ID`
- `BT_YMS_PLANIFICATION_OPERATIVE_LM.PLANNED_ROUTE_ID`
- `BT_PRECHECKIN_TRACEABILITY_LM.ROUTE_ID`
- `BT_PRECHECKIN_TRACEABILITY_LM.PLANNED_ROUTE_ID`
- `BT_CYCLE_ROUTE.ROUTE_ID`
- `BT_CYCLE_ROUTE.ROUTE_PLANNED_ID`
- `BT_CYCLE_ROUTE.MOV_ROUTE_ID`

Também foram confirmados `BT_PRECHECKIN_TRACEABILITY_LM.CLUSTER_ID`, `BT_CYCLE_ROUTE.ROUTE_ORIGINAL_NAME` e os campos de placa.

Esses campos são candidatos para uma ponte de identificação mais robusta do que placa + nome textual. A equivalência entre eles ainda precisa ser comprovada com dados reais antes de promover qualquer um deles a `route_id` canônico do gateway.

O diagnóstico de validação está em:

`gateway/sql/diagnostics/yms-route-id-bridge.sql`



## Validação da ponte de IDs — caso 02/09/2026

O caso real do processo `9e79df59-fb2e-59d4-9f00-da8e80299f59` demonstrou a diferença entre rota planejada e rota executada.

Processo:

- `route_plan_id = 503226595004`
- `executed_route_id` no processo: ausente
- `process_carrier_id = 1590324641`

Journey Planner / last_mile:

- `purpose_plan_id = 503226595004`
- `purpose_executed_id = 434014897`
- `journey_carrier_id = 1788092343`
- placa `SDD-UEO6I01`

Planificação:

- `planned_route_id = 503226595004`
- rota textual genérica `AM1`

Cycle Route:

- `ROUTE_PLANNED_ID = 503226595004`
- `ROUTE_ID = 3611270599`
- rota planejada `A3_AM1`
- carrier planejado `1590324641`
- placa armazenada sem pontuação: `SDDUEO6I01`

Precheckin:

- `ROUTE_ID = 434014897`
- rota executada `VJ3_AM1`
- carrier executado `1788092343`
- `UNICA TRANSPORTES`

Conclusão operacional desta validação:

- `planned_route_id` identifica a rota planejada;
- `purpose_executed_id` do Journey Planner corresponde ao `ROUTE_ID` do Precheckin;
- para o painel operacional, a rota executada tem precedência sobre a rota planejada quando o vínculo por ID existe;
- rota planejada e rota executada podem divergir e devem ser preservadas separadamente;
- `route_changed_from_plan` sinaliza essa divergência quando ambas as rotas estão conhecidas;
- carrier planejado e carrier executado podem divergir e devem ser preservados separadamente;
- placa não deve ser chave primária de resolução de rota;
- quando a placa for usada apenas como fallback, deve ser normalizada removendo hífen e outros caracteres não alfanuméricos.

A Query V2 agora resolve `route_name` nesta ordem:

1. Precheckin pelo `executed_route_id`;
2. Cycle Route pelo `planned_route_id`;
3. Planificação pelo `planned_route_id`;
4. Cycle Route por placa normalizada;
5. Planificação por placa normalizada;
6. `CLUSTER_ROUTE_NAME` do processo.

Os IDs de rota do BigQuery permanecem internos. Ainda não foi provado que qualquer um deles seja o mesmo domínio de `route_id` usado pelo Dispatch; portanto não devem ser enviados ao frontend como se fossem o identificador canônico do Dispatch.


## Pontos a confirmar no BigQuery real

1. semântica local de `BT_YMS_LOADING_ZONES_EVENTS.CREATED_AT` próximo da meia-noite (o tipo `DATETIME` já foi confirmado);
2. grafia e semântica de `UN-LOAD_STARTED`;
3. existência de um evento/status explícito de conclusão da Aduana;
4. presença de um `route_id` oficial em alguma das tabelas já autorizadas;
5. unicidade prática de `PROCESS_ID`;
6. unicidade de `JOURNEY_ID` no planner;
7. latência de ingestão dos eventos;
8. se D-1 é suficiente para planificação de todos os casos AM1;
9. se o `gate-out` observado corresponde de forma estável à saída usada no OOT.

## Validação real de 02/09/2026

A Query V2 foi executada com sucesso no BigQuery corporativo para SSP15 em 02/09/2026.

Resultados observados no retorno completo:

- 232 processos no total considerando todos os ciclos retornados pela versão anterior do teste;
- 232 `process_id` distintos, sem duplicidade;
- 124 processos do ciclo AM1;
- AM1 distribuído nas ondas 1 a 5;
- 98 processos AM1 com `gate_out_at`;
- estados finais AM1 observados: `gate-out`, `killed`, `canceled` e `skipped`;
- 24 linhas AM1 retornaram `route_name = 'AM1'`, valor genérico e inadequado como identificador de rota;
- 7 linhas AM1 ficaram sem rota e sem placa, todas associadas a processos cancelados no conjunto analisado.

A partir dessa validação, a Query V2 passou a:

- filtrar explicitamente `cycle_filter = 'AM1'`;
- não tratar o nome genérico do ciclo (`AM1`) como rota válida;
- retornar `route_source`, `route_resolution_status`, `route_candidate_count` e `plan_candidate_count` para diagnóstico;
- manter rota nula quando não houver evidência suficiente para uma rota concreta.

O caso de resolução de rota genérica deve ser investigado com:

`gateway/sql/diagnostics/yms-route-resolution-am1.sql`

antes de integrar a fonte ao runtime.

## Validação V2 por IDs — 02/09/2026

A versão com resolução por IDs foi executada para SSP15 / AM1 em 02/09/2026 e retornou 124 linhas com 124 `process_id` distintos.

Resumo da resolução de rota:

- 123 de 124 processos com `route_resolution_status = resolved`;
- 110 rotas resolvidas por `precheckin_executed_route_id`;
- 13 processos sem rota executada concluída resolvidos pela rota planejada em `cycle_route_planned_id`;
- 1 processo permaneceu `generic_cycle_name`;
- nenhum processo ficou duplicado.

Resumo de estado YMS:

- 98 `gate-out`;
- 13 `killed`;
- 8 `canceled`;
- 5 `skipped`.

A relação entre rota planejada e executada mostrou 99 processos com `route_changed_from_plan = TRUE` e 25 com `FALSE`. Essa diferença é preservada explicitamente e não deve ser colapsada no backend.

Foram observadas também rotas executadas com sufixos de outros ciclos, como `AMDE`, `CHP` e `SD`, embora o processo esteja no ciclo AM1. Esses casos devem permanecer visíveis como dado executado e ser analisados como movimentação/replanejamento, não corrigidos automaticamente para AM1.

O único processo ainda não resolvido na validação foi:

- `process_id = 6e8e69dc-c158-5e1f-a0aa-0c34961121d1`
- `journey_id = 77479ce0-5d6b-4cd3-b5a1-d87e3b173a34`
- `executed_route_id = 433965323`
- `planned_route_id = 503226587006`
- placa `FXY4E11`
- estado final `gate-out / PROCESS_FINISHED`.

Diagnóstico específico:

`gateway/sql/diagnostics/yms-unresolved-route-433965323.sql`


## Validação do último caso não resolvido

O processo `6e8e69dc-c158-5e1f-a0aa-0c34961121d1` confirmou um comportamento importante do Precheckin:

- `purpose_executed_id = 433965323`;
- `planned_route_id = 503226587006`;
- Cycle Route em 02/09/2026: rota planejada `N3_AM1`, carrier planejado `1025381599`;
- Precheckin do mesmo `executed_route_id = 433965323`: rota executada `C2_AM1`, carrier executado `825655768 / JM Transportes`;
- o registro de Precheckin possui `ROUTE_DATE = 2026-09-03`, mas `ROUTE_INIT_DATE = 2026-09-02 08:15:24`.

Conclusão: `ROUTE_DATE` do Precheckin não pode ser usado sozinho como data operacional de associação. Para resolver a rota executada, a Query V2 passa a usar:

`route_effective_date = COALESCE(DATE(ROUTE_INIT_DATE), ROUTE_DATE)`

A leitura de Precheckin foi ampliada para D-1 até D+1 e o vínculo continua exigindo o `executed_route_id`, com a data efetiva próxima da data operacional. Isso preserva a associação por ID e evita depender apenas da placa.


## Confirmação do último caso — data efetiva do Precheckin

A validação isolada do processo `6e8e69dc-c158-5e1f-a0aa-0c34961121d1` confirmou a correção baseada na data efetiva:

- `source_route_date = 2026-09-03`;
- `route_effective_date = 2026-09-02`;
- `route_init_at = 2026-09-02 08:15:24`;
- rota executada `C2_AM1`;
- rota planejada `N3_AM1`;
- carrier executado `825655768 / JM Transportes`;
- carrier planejado `1025381599`;
- `route_changed_from_plan = TRUE`;
- `resolution_status = resolved`.

Antes de declarar 124/124 resolvidos, a versão completa deve ser reexecutada uma vez com a nova janela do Precheckin para confirmar que não houve regressão nem duplicidade. O script de validação é:

`gateway/sql/validation/yms-route-lifecycle-v2-validation.sql`


## Fechamento da validação AM1 — 02/09/2026

A execução final confirmou 124 linhas e 124 process_id distintos. Todas as 124 rotas ficaram com route_resolution_status = resolved: 111 por precheckin_executed_route_id e 13 por cycle_route_planned_id. Não restaram generic_cycle_name, ambiguidades ou rotas não resolvidas.

Também foram confirmados 99 casos com rota executada diferente da planejada e 25 sem mudança entre as rotas comparadas. Os estados finais do conjunto foram 98 gate-out, 13 killed, 8 canceled e 5 skipped.

Com isso, a resolução de rota do conjunto AM1 de validação está fechada em 124/124. O próximo contrato do backend deve preservar separadamente rota executada e planejada, não tratar IDs YMS como route_id canônico do Dispatch e nunca converter killed, canceled ou skipped em dispatched.


## Diagnóstico operacional de 26/09/2026

A leitura dos eventos AM1 dos últimos dias confirmou a sequência operacional observável no YMS:

- `WAITING_LOADING_ZONE`;
- `WAITING_FOR_PACKAGES`;
- `WAITING_FOR_AUDIT`;
- `DOING_AUDIT`;
- `LOADING_PACKAGES_STARTED`;
- `check-out / UN-LOAD_FINISHED`;
- `gate-out / PROCESS_FINISHED`.

Também foram observados estados terminais `killed`, `skipped` e `canceled`, reforçando que eles não podem ser tratados como expedição concluída.

No recorte de 26/09/2026, o ciclo AM1 possuía 133 processos distribuídos nas ondas 1 a 5. A consulta de eventos do mesmo dia encontrou 128 processos com eventos, deixando uma diferença de 5 processos que deve ser investigada.

Os valores de `LOADING_ZONE_NAME` são majoritariamente numéricos e cobrem posições compatíveis com docas da operação, incluindo valores como 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 21, 23, 29, 52, 56, 58, 60, 64, 89, 90, 91 e 92. Isso é evidência forte de que o campo representa a loading zone/doca, mas ainda não deve ser declarado canônico até ser comparado com o `dock_number` do Dispatch.

A medição `checked_at - MAX(CREATED_AT)` retornou 68 minutos no teste, mas esse valor não prova atraso de ingestão: `CREATED_AT` é horário do evento de negócio, e a operação pode simplesmente ter terminado antes da consulta. Para medir latência real de disponibilização é necessário encontrar um timestamp de carga/ingestão ou coluna de particionamento da tabela.

Diagnóstico seguinte:

`gateway/sql/diagnostics/yms-ingestion-coverage-dock.sql`


## Descoberta de campos de doca e cobertura — 26/09/2026

O schema confirmou fontes explícitas de doca:

- `BT_CYCLE_ROUTE.DOCK_NUMBER`
- `BT_CYCLE_ROUTE.MOV_DOCK_NUMBER`
- `BT_CYCLE_ROUTE.ORIGIN_DOCK_NUMBER`
- `BT_YMS_PLANIFICATION_OPERATIVE_LM.DOCK_NUMBER`
- `BT_YMS_LOADING_ZONES_EVENTS.LOADING_ZONE_NAME`

Os eventos do dia mostraram `LOADING_ZONE_NAME` numérico em vários processos, enquanto o Cycle Route e a Planificação oferecem campos formais de doca. Antes de escolher um campo canônico para o painel, deve ser medida a aderência entre a loading zone observada e as docas planejada/movida.

Também foram identificados 5 processos AM1 de 26/09/2026 sem eventos no mesmo dia. Eles devem ser classificados por status do Journey Planner/Planificação para distinguir rota apenas planejada, cancelada, não iniciada ou outro caso.

A tabela `BT_YMS_LOADING_ZONES_EVENTS` mostrou `CREATED_AT` e `PURPOSE_STATUS_DATE_TIME`, mas nenhuma coluna de ingestão ficou evidente no primeiro levantamento. Portanto, a diferença entre horário atual e `CREATED_AT` continua não sendo medida confiável de latência de carga.

Diagnóstico seguinte:

`gateway/sql/diagnostics/yms-dock-authority-and-missing-events.sql`


## Estado de integração

Nesta etapa não existem:

- adapter YMS no gateway;
- endpoint YMS;
- sanitizer YMS;
- chamada BigQuery em runtime;
- credencial BigQuery;
- alteração em `server.js`, `snapshot.js` ou `index.html`.

A próxima validação deve executar a Query V2 para **um único dia de AM1** e confrontar rotas reais, placa, onda e timestamps antes de qualquer integração automática.
