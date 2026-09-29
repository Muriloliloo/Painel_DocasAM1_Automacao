# Implantacao do gateway

O gateway nao deve ser exposto publicamente sem as protecoes da infraestrutura. O endereco de producao deve ser definido pela TI; este projeto nao presume nem inventa esse endereco.

## Infraestrutura minima

- servico Node.js 22 ou superior;
- servidor interno ou ambiente de execucao corporativo aprovado;
- reverse proxy com HTTPS;
- firewall e regras de rede restritas;
- secrets manager ou identidade de workload para a autenticacao oficial;
- supervisao do processo, logs sanitizados e reinicio controlado.

O navegador que executa o painel precisa conseguir alcancar o endereco HTTPS do gateway. O gateway, por sua vez, deve ter acesso somente leitura aos destinos operacionais aprovados.

## Bind e container

Por padrao o gateway escuta em `127.0.0.1`. Em container ou runtime gerenciado, defina `BIND_HOST=0.0.0.0` e mantenha a exposicao externa sob reverse proxy, ingress ou load balancer autorizado.

O diretorio `gateway/` possui `Dockerfile` baseado em Node 22. A imagem nao contem `.env`, testes, logs ou credenciais. Variaveis e identidade ADC/workload devem ser fornecidas pelo ambiente de execucao.

## CORS

`PANEL_ALLOWED_ORIGIN` deve conter a origem exata do painel, sem caminho e sem curinga. Se o painel continuar no GitHub Pages, configure a origem HTTPS exata correspondente ao site publicado. Nao use `Access-Control-Allow-Origin: *`.

## Configuracao de producao

Antes da implantacao, valide pelo menos:

```text
NODE_ENV=production
GATEWAY_MODE=real
AUTH_MODE=corporate
PANEL_ALLOWED_ORIGIN=<origem HTTPS exata do painel>
ALLOWED_GROUP_IDS=<groupId ou lista de groupIds aprovados>
```

Para YMS real, configure tambem `YMS_MODE=provider` e provisione ADC/identidade de workload com acesso somente leitura ao BigQuery. `GOOGLE_CLOUD_PROJECT` e `BIGQUERY_LOCATION` sao opcionais e podem ser definidos pela infraestrutura quando necessarios.

Tambem devem ser revisadas as allowlists de facility, site, groupId, ciclo e ondas. Em production, `ALLOWED_GROUP_IDS` nao possui fallback implicito e deve ser definido explicitamente. Os hosts e caminhos upstream permanecem fixos e validados no servidor. Segredos nao devem ser adicionados ao `.env.example` nem ao objeto de configuracao do gateway.

Execute `npm run verify` e `npm run preflight:corporate` antes de subir o servico. O preflight e estritamente estrutural: nao obtem autorizacao, nao le segredos e nao chama servicos externos. Enquanto o provider corporativo for stub, ele encerra com `AUTH_NOT_CONFIGURED`.

## Sinais operacionais

- `/health` confirma que o processo esta ativo, mas nao afirma que a autenticacao funciona.
- `/ready` somente responde HTTP 200 e `ready: true` quando o modo mock esta ativo ou quando o provider real entrega um contexto valido.
- `/snapshot` somente deve ser liberado ao painel depois que readiness, sanitizacao e CORS forem validados.
