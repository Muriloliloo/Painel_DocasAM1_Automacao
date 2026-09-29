# Gateway intermediario do Painel_DocasAM1

Gateway HTTP somente leitura que separa o painel publico dos sistemas internos. O modo mock usa somente dados ficticios; o modo real permanece fechado ate a TI implementar o provider corporativo oficial.

## Requisitos

- Node.js 22 ou superior.
- `npm install` para instalar o cliente oficial `@google-cloud/bigquery`.
- Em `YMS_MODE=provider`, o runtime deve possuir Application Default Credentials (ADC) ou identidade de workload com acesso somente leitura ao BigQuery.

## Iniciar

No PowerShell, a partir desta pasta:

```powershell
$env:PORT = "8787"
$env:NODE_ENV = "development"
$env:PANEL_ALLOWED_ORIGIN = "http://localhost:8000"
$env:GATEWAY_MODE = "mock"
$env:AUTH_MODE = "unconfigured"
$env:MOCK_SCENARIO = "normal"
$env:YMS_MODE = "disabled"
npm start
```

O gateway escuta apenas em `127.0.0.1` nesta etapa. Para consultar:

```text
GET http://localhost:8787/health
GET http://localhost:8787/ready
GET http://localhost:8787/snapshot?facilityId=SSP15&siteId=MLB&groupId=TESTE&cycle=AM1&waves=1,2,3,4,5&timezone=America%2FSao_Paulo
GET http://localhost:8787/dispatch?facilityId=SSP15&siteId=MLB&groupId=TESTE&cycle=AM1&wave=1&timezone=America%2FSao_Paulo
GET http://localhost:8787/customs?facilityId=SSP15&siteId=MLB&groupId=TESTE&cycle=AM1&timezone=America%2FSao_Paulo
GET http://localhost:8787/yms?facilityId=SSP15&siteId=MLB&groupId=TESTE&cycle=AM1&waves=1,2,3,4,5&timezone=America%2FSao_Paulo
```

## Cenarios mock

Em `development` e `GATEWAY_MODE=mock`, acrescente `scenario` a query:

- `normal`
- `loading`
- `dispatched`
- `customs-in-progress`
- `customs-complete`
- `empty-unconfirmed`
- `empty-confirmed`
- `failure-dispatch`
- `failure-customs`
- `timeout`

A query de cenario e rejeitada fora de `development/mock`. Para testar o frontend sem mudar sua configuracao, selecione o mesmo cenario pela variavel `MOCK_SCENARIO` antes de iniciar o gateway.

## Fonte YMS / BigQuery

`YMS_MODE` e opt-in e aceita:

- `disabled`: padrao; preserva exatamente o snapshot anterior com Dispatch + Aduana;
- `mock`: adiciona uma fonte YMS ficticia ao snapshot para testes locais e libera `GET /yms` para homologacao isolada;
- `provider`: usa o executor BigQuery do backend. O bootstrap oficial do gateway cria o cliente `@google-cloud/bigquery` e usa ADC/identidade do runtime; sem identidade autorizada, a consulta falha fechado.

A integracao real nao contem credenciais, tokens ou chaves no repositorio. `GOOGLE_CLOUD_PROJECT` e `BIGQUERY_LOCATION` podem ser definidos pela infraestrutura quando necessarios; eles nao sao segredos. A autenticacao deve vir de ADC, service account vinculada ao runtime ou workload identity aprovada.

## Contrato combinado

```json
{
  "snapshotComplete": true,
  "emptyConfirmed": false,
  "sources": {
    "dispatch": "ok",
    "aduana": "ok"
  },
  "operacional": [],
  "aduana": []
}
```

`emptyConfirmed` somente fica `true` no cenario explicito `empty-confirmed`, depois de todas as fontes ativas responderem com sucesso e vazias. Falha ou timeout de qualquer fonte habilitada impede uma resposta combinada de sucesso.

Quando `YMS_MODE=mock` ou `provider`, o snapshot ganha `sources.yms` e o array `yms`. Com `YMS_MODE=disabled`, o contrato antigo permanece inalterado.

## Seguranca

- CORS usa uma lista exata configurada em `PANEL_ALLOWED_ORIGIN`; nao usa curinga.
- Em producao, `PANEL_ALLOWED_ORIGIN` e obrigatorio; sem ele o processo falha fechado.
- Somente `GET` e `OPTIONS` sao aceitos.
- Headers de autenticacao, cookies e CSRF recebidos do cliente sao rejeitados.
- Queries desconhecidas ou valores operacionais fora das listas permitidas sao rejeitados.
- O request target tem limite de 2 KiB e a consulta aceita no maximo 10 ondas previamente autorizadas.
- Respostas usam `no-store`, tipo JSON, headers defensivos e limite de tamanho.
- Sanitizadores trabalham com listas positivas de campos.
- Erros nao incluem stack trace.
- Nao ha cookies, tokens, headers internos, credenciais ou dados pessoais reais.
- Hosts e caminhos upstream sao definidos exclusivamente no servidor e validados por allowlist.
- O cliente upstream aceita somente GET, nao segue redirects e limita timeout, tipo e tamanho da resposta.

## Health e readiness

`GET /health` continua respondendo enquanto o processo estiver ativo e informa apenas `gatewayMode` e `authMode`. `GET /ready` responde `ready=true` em mock. Em `real/unconfigured`, responde HTTP 503 com `ready=false`, sem revelar detalhes de autenticacao.

## Preparado para autenticacao corporativa

O contrato de autenticacao fica isolado em `src/auth/`. `AUTH_MODE` aceita `unconfigured` e `corporate`, mas selecionar `corporate` nao concede acesso: o stub em `src/auth/corporate-provider.js` continua falhando fechado com HTTP 503 e `AUTH_NOT_CONFIGURED` antes de qualquer chamada upstream.

Os adaptadores reais ja montam no servidor as URLs e queries permitidas para Dispatch e Aduana. O YMS usa um provider separado em `src/providers/yms-provider.js`, mantendo BigQuery isolado das duas fontes HTTP. O cliente em `src/http/upstream-client.js` aceita somente destinos da allowlist, usa GET, timeout, limite de resposta, JSON obrigatorio e redirects manuais. Nenhuma requisicao real e feita enquanto a autenticacao permanecer desconfigurada.

Quando o metodo oficial for aprovado, a TI devera implementar somente o provider indicado para entregar o contexto minimo ao cliente upstream. O segredo devera vir da infraestrutura segura ou de um secrets manager, nunca do frontend. Nao copie Cookie, Authorization, CSRF, token ou sessao do navegador. O frontend nunca deve receber credenciais corporativas.

Veja [docs/HANDOFF-TI.md](docs/HANDOFF-TI.md), [docs/IAM-YMS.md](docs/IAM-YMS.md), [docs/API-CONTRACT.md](docs/API-CONTRACT.md), [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) e [docs/AUTHORIZATION.md](docs/AUTHORIZATION.md).

## Testes

```powershell
npm test
npm run verify
npm run smoke:mock
```

`npm run verify` executa os checks sintaticos de todos os arquivos JavaScript e a suite completa. `npm run smoke:mock` inicia um servidor efemero em loopback, valida health, readiness e snapshot 3/1 e encerra o processo.

Para o preflight da futura configuracao corporativa, defina as variaveis de producao e execute `npm run preflight:corporate`. O comando inspeciona somente configuracao e estrutura do provider, sem obter autorizacao ou chamar servicos externos. Enquanto o provider for stub, encerra de forma controlada com `AUTH_NOT_CONFIGURED`.


## Ativacao do painel publicado - fase 1

O arquivo `/automation-config.js` e o unico ponto publico de ativacao do frontend. Ele nao contem segredos e fica inativo enquanto `gatewayBaseUrl` estiver vazio.

Para a primeira versao real:

1. a TI implanta o gateway com HTTPS, autenticacao corporativa oficial e `ALLOWED_GROUP_IDS` configurado;
2. validar `/ready` e `/snapshot` no ambiente autorizado;
3. preencher somente o HTTPS oficial em `automation-config.js`;
4. manter `ymsEnabled: false` e `ymsPreview: false`;
5. publicar e validar polling de Dispatch + Aduana e o fallback manual.

`groupId` pode permanecer vazio no arquivo publico quando o gateway tiver uma unica opcao autorizada; nesse caso o backend aplica o primeiro valor da propria allowlist. Se houver mais de um groupId aprovado, configure explicitamente o correspondente ao painel.

Nenhum token, cookie, senha, Authorization, CSRF, certificado ou segredo pode ser colocado em `automation-config.js`.

## Frontend com YMS em modo opt-in

O frontend da branch `dev-automacao` ja consegue receber o array `yms` do gateway, mas ainda nao usa esses dados para sobrescrever status ou doca da visao consolidada.

Isso e intencional enquanto a autoridade da doca real ainda nao estiver fechada no BigQuery.

Exemplo de configuracao local:

```html
<script>
window.PAINEL_AUTOMATION_CONFIG = {
  gatewayBaseUrl: "http://127.0.0.1:8787",
  mode: "combined",
  snapshotPath: "snapshot",
  ymsPath: "yms",
  ymsEnabled: true,
  ymsPreview: true,
  facilityId: "SSP15",
  siteId: "MLB",
  groupId: "TESTE",
  cycle: "AM1",
  timezone: "America/Sao_Paulo",
  waves: ["1", "2", "3", "4", "5"],
  enabled: true
};
</script>
```

Com `ymsEnabled: true`, os dados YMS ficam disponiveis apenas na sessao atual em `window.ymsAutomaticRows()` e no evento `painel:yms-data`.

Com `ymsPreview: true`, o painel mostra uma janela flutuante de homologacao com rota, onda, Zona YMS, transportadora, placa e o estagio calculado. A nomenclatura `Zona YMS` e intencional: enquanto a validacao BigQuery de autoridade da doca estiver pendente, o frontend nao chama esse campo de doca canonica.

Quando YMS esta ativo no snapshot combinado, o gateway tambem devolve `comparison`, uma leitura observacional por `route_name` entre Dispatch, Aduana e YMS. Ela informa:

- quais fontes possuem a rota;
- etapa informada por cada fonte;
- Doca Dispatch x Zona YMS;
- `dock_comparison = same | different | insufficient`;
- `stage_comparison = all_equal | mixed | insufficient`.

Essa comparacao nao escolhe uma fonte vencedora e nao altera a operacao. Diferencas podem representar tempos de atualizacao distintos entre sistemas e devem ser analisadas antes de qualquer regra de autoridade.

A previa tambem produz diagnosticos observacionais:

- `YMS em etapa posterior`;
- `Dispatch em etapa posterior`;
- `Doca divergente`;
- `Fonte sem registro`;
- `Excecao terminal YMS`.

`YMS em etapa posterior` e `Dispatch em etapa posterior` usam apenas uma ordem heuristica da sequencia operacional conhecida. Eles nao afirmam qual sistema esta correto, nao substituem timestamps reais e nao podem ser usados como regra de autoridade sem validacao adicional.

O mock local foi ampliado para cobrir explicitamente esses cenarios, incluindo uma rota com doca divergente e outra em que Dispatch aparece em etapa posterior ao YMS.

No frontend, a comparacao fica somente na sessao em `window.ymsSourceComparison()` e aparece dentro da janela `YMS • PREVIA`.

A previa agora tambem mantem uma linha do tempo da sessao, acessivel por `window.ymsDiagnosticHistory()`. Ela registra apenas quando alguma rota muda entre dois pollings consecutivos, incluindo os estados observados no Dispatch, Aduana e YMS e os diagnosticos associados.

Essa linha do tempo usa o horario em que o navegador observou a mudanca. Ela nao e o timestamp oficial de processamento ou ingestao de nenhuma fonte e nao deve ser usada como SLA. O limite atual e de 240 mudancas por sessao para evitar crescimento indefinido.

A partir dessa linha do tempo, a previa calcula uma leitura adicional de defasagem observada por rota. Cada registro identifica quais fontes realmente mudaram em relacao a observacao anterior da mesma rota (`changed_sources`). Quando pelo menos duas fontes ja tiveram alguma mudanca observada depois da linha de base inicial, o painel calcula o intervalo entre as ultimas mudancas percebidas e as diferencas par a par entre Dispatch, Aduana e YMS.

Essa leitura fica disponivel em `window.ymsObservedSourceLag()` e aparece recolhida em `DEFASAGEM OBSERVADA` dentro da `YMS • PREVIA`. Ela nao afirma que as mudancas representam o mesmo evento operacional, nao mede latencia oficial, nao e SLA e nao define qual fonte esta correta.

A previa tambem agrega um resumo estatistico da sessao em `window.ymsObservedSessionStats()` e em `PADRAO DA SESSAO`. Para cada rota comparavel, ele usa a primeira mudanca observada de cada fonte depois da linha de base inicial para contar qual fonte apareceu primeiro. Mudancas percebidas no mesmo polling entram como simultaneas. O resumo calcula media e mediana do intervalo inicial entre fontes e tambem dos pares Dispatch-Aduana, Dispatch-YMS e Aduana-YMS.

Esse resumo e somente descritivo do que o navegador observou durante a sessao. Ele nao mede desempenho de sistema, nao representa latencia oficial, nao estabelece causalidade e nao define autoridade entre fontes.

A previa tambem identifica padroes recorrentes em `window.ymsRecurringDiagnosticPatterns()` e no bloco `PADROES RECORRENTES`. Um padrao e definido pela mesma rota, pelo mesmo diagnostico e pela mesma combinacao observada de etapas ou doca/zona. A persistencia continua de uma divergencia conta como um unico episodio; um novo episodio so e contado quando o padrao deixa de estar ativo e depois reaparece. Apenas padroes com dois ou mais episodios entram nessa leitura.

Quando `stage_divergence` aparece junto com `yms_ahead` ou `dispatch_ahead`, o diagnostico generico de etapas diferentes e suprimido nessa contagem para evitar duplicidade do mesmo episodio. Essa recorrencia continua sendo somente observacional e nao implica causa, falha, prioridade operacional ou fonte incorreta.

A comparacao, a linha do tempo, a defasagem observada, o resumo estatistico e os padroes recorrentes nao sao enviados ao Firebase e nao alteram `baseOperacional`, `baseAduana` ou o fallback manual nesta etapa.

## Homologacao em casa sem acesso corporativo

Para validar primeiro o nucleo Dispatch + Aduana sem VPN, use:

```powershell
cd gateway
npm run smoke:flow
```

Esse smoke executa quatro snapshots consecutivos da mesma rota ficticia e valida a progressao:

`waiting_customs -> customs_in_progress -> loading_packages -> dispatched`

Para observar essa evolucao diretamente no painel, use:

```powershell
cd gateway
npm run preview:flow
```

O painel abre em localhost com polling de 15 segundos, `YMS_MODE=disabled` e cenario `operational-sequence`. A rota mock `G5_AM1`, que ja existe no planejamento local da Onda 1, percorre os quatro estados e permanece em `dispatched` no final. Nenhuma VPN, autenticacao corporativa ou dado real e usado nesse modo.

Para validar preservacao do ultimo estado valido quando uma fonte falha temporariamente:

```powershell
cd gateway
npm run smoke:recovery
npm run preview:recovery
```

O cenario `operational-recovery` executa `waiting_customs -> customs_in_progress -> loading_packages -> falha Dispatch -> dispatched`. Durante a falha, o gateway retorna snapshot incompleto e o frontend deve conservar o ultimo snapshot valido. No polling seguinte, a fonte volta e a rota segue para `dispatched`.

Para a homologacao YMS mock que ja existia, continue usando:

```powershell
cd gateway
npm run preview:home
```

Esse comando sobe ao mesmo tempo:

- gateway mock em `127.0.0.1:8787`;
- painel local em `localhost:8000`;
- YMS em modo mock;
- previa visual YMS ativada por `?ymsPreview=1`.

O navegador tenta abrir automaticamente:

`http://localhost:8000/?ymsPreview=1`

Se a abertura automatica falhar, basta copiar esse endereco manualmente.

Nenhuma credencial corporativa e usada nesse modo. Para encerrar os dois servidores, pressione `Ctrl+C`.

Para iniciar somente o gateway, ainda e possivel usar:


```powershell
$env:GATEWAY_MODE = "mock"
$env:AUTH_MODE = "unconfigured"
$env:YMS_MODE = "mock"
$env:PANEL_ALLOWED_ORIGIN = "http://localhost:8000"
npm start
```

Depois consulte `/yms` ou `/snapshot`. O mock YMS inclui exemplos de:

- rota expedida;
- Aduana em andamento;
- carregamento;
- excecao terminal.

Isso permite desenvolver e validar o contrato do frontend fora da rede corporativa sem copiar credenciais, cookies ou tokens.


## Validacao YMS no runtime autorizado

Quando o container estiver em um ambiente com ADC/identidade de workload autorizada para leitura no BigQuery, valide primeiro o acesso estrutural:

```powershell
npm run preflight:yms
```

Esse comando testa o BigQuery e as tabelas obrigatorias sem imprimir rotas, processos ou payload operacional.

Depois execute o smoke ponta a ponta do YMS:

```powershell
npm run smoke:yms:provider
```

O smoke sobe um gateway efemero em loopback, usa `YMS_MODE=provider`, consulta `/yms` e imprime somente um resumo seguro com quantidade de linhas, data operacional e contagem por lifecycle. Ele nao depende de Dispatch/Aduana e nao imprime process_id ou route_name.

Se ambos passarem, o caminho `BigQuery -> provider -> gateway -> /yms` esta funcional no runtime autorizado. A ativacao no painel continua separada e so deve ocorrer depois dessa validacao.
