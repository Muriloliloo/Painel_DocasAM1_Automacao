# Entrega do gateway para a TI

Este gateway ja esta funcional. A logica do painel, Dispatch, Aduana, sanitizacao e polling ja esta implementada. A fonte YMS/BigQuery foi validada separadamente para SSP15/AM1 e preparada no gateway em modo opt-in.

A responsabilidade da TI e conectar o metodo oficial de autenticacao corporativa das APIs e, quando aprovado, fornecer o executor BigQuery do YMS.

## Pontos de integracao da TI

Autenticacao das APIs HTTP:

`gateway/src/auth/corporate-provider.js`

Executor YMS/BigQuery:

`gateway/src/providers/google-bigquery-executor.js`

Bootstrap do runtime:

`gateway/src/start.js`

O primeiro arquivo continua sendo o ponto de autenticacao de Dispatch/Aduana. O executor YMS agora usa o cliente oficial `@google-cloud/bigquery` e Application Default Credentials (ADC) / identidade de workload do runtime. Nenhuma chave ou token e lido do frontend ou gravado no repositorio. A TI deve obter a documentacao oficial, implementar `getAuthContext()` e retornar o contrato:

```js
{
  headers: { /* headers definidos pelo metodo oficial */ },
  dispatcher: /* opcional, quando o metodo oficial exigir */
}
```

O retorno passa obrigatoriamente por `validatedAuthContext()`. Enquanto esse arquivo permanecer como stub, `GATEWAY_MODE=real` com `AUTH_MODE=corporate` continua respondendo `AUTH_NOT_CONFIGURED`, sem chamar as fontes operacionais.

`inspectConfiguration()` e uma verificacao estrutural sem efeitos. Ela deve mudar para `configured: true` somente quando a implementacao e o provisionamento oficial estiverem prontos; nunca deve buscar token, segredo ou certificado.

Dependendo do metodo oficial, a TI tambem pode precisar provisionar secrets manager, variavel segura, certificado, identidade de workload, biblioteca oficialmente aprovada, reverse proxy e regras de rede/firewall. Essas necessidades de infraestrutura nao mudam o ponto de integracao da aplicacao. Nunca grave segredo no Git, no objeto publico de configuracao ou no frontend.

Para o escopo minimo de acesso BigQuery, seguir `docs/IAM-YMS.md`.

## Sequencia de ativacao

1. Obter a documentacao oficial, implementar `getAuthContext()` no arquivo indicado e atualizar sua inspecao estrutural quando estiver pronto.
2. Configurar os segredos somente na infraestrutura, definir `GATEWAY_MODE=real`, `AUTH_MODE=corporate` e declarar explicitamente `ALLOWED_GROUP_IDS`.
3. Para homologacao isolada, usar `YMS_MODE=mock`.
4. Para o YMS real, provisionar uma identidade de runtime com permissao BigQuery somente leitura, instalar dependencias com `npm install` e configurar `YMS_MODE=provider`. Se necessario, definir `GOOGLE_CLOUD_PROJECT` e `BIGQUERY_LOCATION`.
5. Executar `npm run verify` e `npm run preflight:corporate`.
6. Testar `/health`, `/ready`, Dispatch, Aduana e `/snapshot`, conferindo que a resposta esta sanitizada.
7. Somente depois habilitar a fonte automatica no frontend e validar polling e fallback manual.

## Configuracao publica do frontend

O painel aceita `window.PAINEL_AUTOMATION_CONFIG` no carregamento ou uma chamada explicita a `configureAutomaticSource(config)`. Os campos disponiveis sao:

- `gatewayBaseUrl`: endereco HTTPS publico do gateway, sem credenciais;
- `mode`: `combined` para `/snapshot` ou `split` para chamadas separadas;
- `snapshotPath`, `dispatchPath`, `customsPath`: caminhos relativos opcionais;
- `facilityId`, `siteId`, `groupId`, `cycle`, `timezone` e `waves`: contexto operacional permitido; `groupId` e validado pela allowlist do backend;
- `timeoutMs` e `intervalMs`: limites do cliente;
- `enabled`: somente `true` inicia o polling automatico.

O endereco do gateway e configuracao publica. Nenhum cookie, header de autorizacao, token, senha ou segredo pode existir nessa configuracao.

## Nao alterar

Salvo se houver mudanca comprovada no contrato das APIs, nao alterar:

- `index.html`;
- sanitizadores;
- adaptadores ja validados sem evidencia de mudanca de contrato;
- servico de snapshot fora do ponto de integracao YMS;
- polling;
- Firebase;
- merge manual/automatico.

## Checklist de aceitacao

- [ ] metodo oficial identificado
- [ ] autorizacao apenas leitura
- [ ] `ALLOWED_GROUP_IDS` definido com o escopo aprovado
- [ ] segredo fora do Git
- [ ] `corporate-provider` implementado
- [ ] `npm run verify` aprovado
- [ ] `/health` = HTTP 200
- [ ] `/ready` = `ready: true`
- [ ] Dispatch responde
- [ ] Aduana responde
- [ ] identidade ADC/workload do BigQuery provisionada com acesso somente leitura
- [ ] `YMS_MODE=provider` validado no runtime autorizado
- [ ] quando YMS ativo, `/ready` so fica true com provider configurado
- [ ] snapshot combinado responde
- [ ] nenhum PII indevido no frontend
- [ ] polling testado
- [ ] fallback manual testado
- [ ] logs sem credencial
- [ ] HTTPS em producao
- [ ] CORS limitado ao painel
