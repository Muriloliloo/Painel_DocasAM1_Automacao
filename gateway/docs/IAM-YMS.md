# IAM minimo para YMS / BigQuery

Este documento descreve o acesso minimo necessario para o runtime do gateway consultar o YMS no BigQuery.

## Identidade

A execucao manual validada usa:

- projeto BigQuery: `meli-bi-data`
- location: `US`

A automacao nao deve reutilizar a conta humana que executou a consulta manual.

Usar uma identidade de runtime aprovada, como service account vinculada ao servico ou workload identity / ADC.

Para Vercel, o caminho preparado no gateway e OIDC federado. A TI/Cloud precisa provisionar e informar apenas estes identificadores nao secretos:

- `GCP_PROJECT_NUMBER`
- `GCP_SERVICE_ACCOUNT_EMAIL`
- `GCP_WORKLOAD_IDENTITY_POOL_ID`
- `GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID`

O provider de Workload Identity deve aceitar o token OIDC emitido pela Vercel e restringir os principals/claims ao projeto, time e ambiente aprovados.

Nao colocar chave JSON, token, cookie ou credencial no Git, no frontend, no arquivo `.env` ou na imagem Docker.

## Permissoes minimas

### Projeto de execucao da consulta

Conceder:

`roles/bigquery.jobUser`

Objetivo: permitir a criacao do job de consulta BigQuery.

O projeto confirmado para os jobs atuais e `meli-bi-data`, configurado em `GOOGLE_CLOUD_PROJECT`. A location confirmada e `US`, configurada em `BIGQUERY_LOCATION`.

### Dados YMS

Conceder leitura somente nos dados necessarios, preferencialmente no dataset `WHOWNER` ou diretamente nas tabelas permitidas:

`roles/bigquery.dataViewer`

Tabelas utilizadas:

- `meli-bi-data.WHOWNER.BT_CYCLE_SUMMARY_LM`
- `meli-bi-data.WHOWNER.BT_LOADING_ZONES_PROCESS_LM`
- `meli-bi-data.WHOWNER.BT_YMS_JOURNEY_PLANNER`
- `meli-bi-data.WHOWNER.BT_PRECHECKIN_TRACEABILITY_LM`
- `meli-bi-data.WHOWNER.BT_CYCLE_ROUTE`
- `meli-bi-data.WHOWNER.BT_YMS_PLANIFICATION_OPERATIVE_LM`
- `meli-bi-data.WHOWNER.BT_YMS_LOADING_ZONES_EVENTS`
- `meli-bi-data.WHOWNER.BT_SHP_MT_FACILITY_RESOURCE`

Se a politica corporativa permitir grants por tabela, preferir somente essas tabelas. Se a administracao de acesso for feita por dataset, limitar ao dataset `WHOWNER`.

## Nao necessario

Para este gateway, nao solicitar:

- `roles/bigquery.admin`
- `roles/bigquery.dataEditor`
- `roles/bigquery.dataOwner`
- papel Owner ou Editor do projeto
- permissao de escrita, update ou delete nas tabelas

## Validacao apos provisionamento

No runtime autorizado:

```text
npm run preflight:yms
```

O preflight valida acesso ao BigQuery e as oito tabelas obrigatorias.

Depois:

```text
npm run smoke:yms:provider
```

O smoke valida o caminho completo:

`BigQuery -> executor -> provider -> gateway -> /yms`

O resultado mostra somente resumo agregado de linhas, data operacional e lifecycle. Nao imprime process_id ou route_name.

## Criterio de aceite

- preflight YMS: sucesso em BigQuery e nas oito tabelas;
- smoke YMS: `ready=true`, `sources.yms=ok` e linhas retornadas;
- nenhum segredo presente na imagem, Git ou frontend;
- nenhuma permissao de escrita concedida ao runtime;
- `automation-config.js` continua com YMS desativado ate a homologacao real.
