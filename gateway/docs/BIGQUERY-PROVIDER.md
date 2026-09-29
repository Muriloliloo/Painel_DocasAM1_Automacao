# Provider YMS / BigQuery

Este documento descreve o ponto de integracao entre o gateway e um executor BigQuery aprovado pela infraestrutura.

## Estado atual

A consulta YMS foi validada em SSP15 / AM1 para 02/09/2026 com:

- 124 linhas;
- 124 process_id distintos;
- 124 rotas resolvidas;
- 111 resolvidas pela rota executada do Precheckin;
- 13 resolvidas pela rota planejada do Cycle Route;
- nenhuma rota ambigua ou nao resolvida.

O SQL de runtime fica em:

`gateway/sql/yms-route-lifecycle-runtime.sql`

Ele usa somente parametros nomeados:

- `@facility_id`
- `@cycle_name`
- `@operation_date`

Nenhuma credencial existe no SQL ou no repositorio.

## Contrato do executor

O gateway fornece `createBigQueryYmsProvider()` em:

`gateway/src/providers/bigquery-yms-provider.js`

A infraestrutura deve fornecer uma funcao `queryExecutor` com o seguinte contrato:

```js
async function queryExecutor({ sql, params, signal }) {
  // executar a consulta no BigQuery usando o metodo corporativo aprovado
  // e retornar um array de linhas ou payload compativel com o adapter YMS.
}
```

O provider chama o executor com:

```js
{
  sql,
  params: {
    facility_id: "SSP15",
    cycle_name: "AM1",
    operation_date: "YYYY-MM-DD"
  },
  signal
}
```

A data operacional e resolvida no timezone informado pelo snapshot quando nao e fornecida explicitamente.

## Seguranca

Nao colocar no repositorio:

- service account JSON;
- client secret;
- access token;
- refresh token;
- cookie;
- header Authorization;
- credencial extraida do navegador;
- certificado privado.

A autenticacao deve ser resolvida pela infraestrutura autorizada, por exemplo por identidade de workload, conta de servico provisionada fora do Git, proxy corporativo ou outro metodo oficial.

O executor deve receber somente o SQL, os parametros e o AbortSignal. Credenciais nao devem atravessar o contrato publico do gateway.

## Modos

`YMS_MODE=disabled`

Preserva o snapshot atual de Dispatch + Aduana sem nenhuma dependencia do YMS.

`YMS_MODE=mock`

Adiciona uma fonte YMS ficticia para homologacao local.

`YMS_MODE=provider`

Exige provider real configurado. Sem executor aprovado, `/ready` retorna indisponivel e o snapshot falha fechado com `YMS_PROVIDER_NOT_CONFIGURED`.

## Proxima etapa de homologacao

Quando o metodo corporativo estiver disponivel:

1. implementar ou injetar o `queryExecutor`;
2. manter os parametros permitidos em SSP15 / AM1;
3. executar `npm run verify`;
4. testar `/ready`;
5. validar o snapshot com YMS ativo;
6. conferir que IDs internos nao aparecem no navegador;
7. somente depois habilitar o consumo YMS no frontend.
