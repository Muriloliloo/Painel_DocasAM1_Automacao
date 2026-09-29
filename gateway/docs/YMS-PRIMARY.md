# YMS / BigQuery como fonte principal

Objetivo:

```text
BigQuery/YMS -> gateway -> /snapshot -> Painel_DocasAM1_Automacao
```

Este modo nao depende de cookie, CSRF ou sessao do `adminml.com`.

## Estado seguro inicial

Manter enquanto a identidade BigQuery nao estiver aprovada:

```text
GATEWAY_MODE=mock
YMS_MODE=disabled
SNAPSHOT_SOURCE_MODE=dispatch-customs
```

## Ativacao real

Somente em runtime autorizado:

```text
GATEWAY_MODE=real
AUTH_MODE=unconfigured
YMS_MODE=provider
SNAPSHOT_SOURCE_MODE=yms-primary
PANEL_ALLOWED_ORIGIN=https://muriloliloo.github.io
ALLOWED_FACILITY_IDS=SSP15
ALLOWED_SITE_IDS=MLB
ALLOWED_CYCLES=AM1
ALLOWED_WAVES=1,2,3,4,5
GOOGLE_CLOUD_PROJECT=<projeto autorizado para executar jobs>
BIGQUERY_LOCATION=<localizacao quando exigida>
```

Em `yms-primary`, Dispatch/Aduana HTTP nao sao consultados. O gateway deriva o formato operacional a partir do lifecycle YMS.

## Validacao antes da virada

Executar no runtime com a identidade aprovada:

```text
npm run preflight:yms
npm run smoke:yms:provider
npm run smoke:yms:primary
```

Critério de aceite:

- BigQuery acessivel;
- oito tabelas obrigatorias somente leitura acessiveis;
- `/ready` = 200;
- `/snapshot` = `snapshotComplete: true`;
- `sourceMode` = `yms-primary`;
- `sources.yms` = `ok`;
- `sources.dispatch` e `sources.aduana` = `derived_yms`;
- nenhuma rota sem nome e enviada para `operacional`;
- nenhuma credencial fica no Git ou frontend.

## Identidade

Preferir identidade de runtime / workload identity. Para Vercel, usar OIDC federado com Google Cloud quando aprovado. Para Cloud Run, usar service account vinculada ao servico e ADC.

Nao usar chave JSON permanente se houver alternativa de identidade federada.

Permissoes minimas permanecem documentadas em `IAM-YMS.md`.
