# Handoff TI/Cloud — BigQuery via Vercel OIDC

## Objetivo

Autorizar o gateway cloud do Painel Docas AM1 a consultar somente leitura no BigQuery, sem chave JSON permanente, sem cookie corporativo e sem reutilizar conta humana.

Fluxo:

```text
Vercel OIDC
  -> Google Workload Identity Federation
  -> Service Account dedicada
  -> BigQuery (meli-bi-data / US)
  -> Gateway /snapshot
  -> Painel_DocasAM1_Automacao
```

## Ambiente confirmado

- BigQuery project usado nos jobs manuais: `meli-bi-data`
- BigQuery location: `US`
- Facility: `SSP15`
- Cycle: `AM1`
- Waves: `1,2,3,4,5`
- Vercel team slug: `muriloliloos-projetos`
- Vercel gateway project slug: `painel-docas-am1-gateway`
- Vercel production hostname: `painel-docas-am1-gateway.vercel.app`
- OIDC issuer da Vercel: `https://oidc.vercel.com`

## Identidade solicitada

Criar ou indicar uma Service Account dedicada exclusivamente a consultas do painel.

Permissoes minimas:

### Projeto de execucao

No projeto usado para criar os jobs BigQuery:

```text
roles/bigquery.jobUser
```

### Dados

Leitura somente nas tabelas/dataset aprovados:

```text
roles/bigquery.dataViewer
```

Preferir grant somente no dataset `WHOWNER` ou nas tabelas explicitamente usadas pelo painel.

Nao conceder:

- BigQuery Admin
- BigQuery Data Editor
- BigQuery Data Owner
- Project Editor
- Project Owner
- permissoes de escrita/update/delete

## Workload Identity Federation

Criar um Workload Identity Pool e um OIDC Provider para a Vercel.

Restringir o provider/impersonation ao deployment aprovado. A condicao deve validar, conforme os claims efetivamente emitidos pela Vercel:

- `project_id`: somente o projeto `painel-docas-am1-gateway`
- `owner_id`: somente o time/owner aprovado
- `environment`: somente `production`
- issuer: Vercel OIDC
- audience: valor emitido/aceito pelo provider configurado

Nao autorizar wildcard amplo para todos os projetos/deployments da conta.

Conceder ao principal federado somente:

```text
roles/iam.workloadIdentityUser
```

na Service Account dedicada.

## Identificadores que o gateway precisa

Depois do provisionamento, informar apenas estes valores nao secretos:

```text
GCP_PROJECT_NUMBER=
GCP_SERVICE_ACCOUNT_EMAIL=
GCP_WORKLOAD_IDENTITY_POOL_ID=
GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID=
```

Nao enviar chave privada, JSON de service account, access token, refresh token ou senha.

## Variaveis do gateway

Depois da aprovacao:

```text
GOOGLE_CLOUD_PROJECT=meli-bi-data
BIGQUERY_LOCATION=US
BIGQUERY_MAXIMUM_BYTES_BILLED=10737418240
GATEWAY_MODE=real
AUTH_MODE=unconfigured
YMS_MODE=provider
SNAPSHOT_SOURCE_MODE=yms-primary
YMS_SQL_PROFILE=rich
YMS_QUERY_CACHE_MS=45000
YMS_TIMEOUT_MS=30000
PANEL_ALLOWED_ORIGIN=https://muriloliloo.github.io
ALLOWED_FACILITY_IDS=SSP15
ALLOWED_SITE_IDS=MLB
ALLOWED_CYCLES=AM1
ALLOWED_WAVES=1,2,3,4,5
```

## Validacao antes da virada

Executar no runtime autorizado:

```text
npm run preflight:yms
npm run smoke:yms:provider
npm run smoke:yms:primary
```

Criterio de aceite:

- BigQuery acessivel;
- tabelas obrigatorias somente leitura acessiveis;
- `/ready` = 200;
- `/snapshot` = `snapshotComplete: true`;
- `sourceMode` = `yms-primary`;
- `sources.yms` = `ok`;
- nenhum segredo presente no Git ou frontend;
- nenhuma permissao de escrita concedida.

## Guardrail de custo

O executor aplica `BIGQUERY_MAXIMUM_BYTES_BILLED=10737418240` (10 GiB) por job como protecao inicial e executa com `useQueryCache=false` para que a atualizacao operacional nao dependa de cache oculto do BigQuery. Ajustar o limite somente depois de medir os perfis `rich` e `lean`.

## Perfil SQL

Manter `YMS_SQL_PROFILE=rich` como padrao inicial.

Existe um perfil `lean`, baseado na query operacional validada manualmente e limitado a quatro tabelas essenciais. Ele deve ser habilitado somente depois de comparar cobertura de rotas, lifecycle e bytes processados com o perfil `rich`.
