# Arquitetura de autorizacao corporativa

Este documento descreve somente a fronteira preparada para uma futura integracao oficialmente autorizada. Nenhum metodo de autenticacao corporativa esta implementado.

## Estado atual

- `AUTH_MODE` aceita `unconfigured` e `corporate`.
- `GATEWAY_MODE=mock` continua operando apenas com fixtures ficticias.
- `GATEWAY_MODE=real` inicia o servidor, mas toda consulta operacional falha com HTTP 503 e `AUTH_NOT_CONFIGURED`.
- `/health` permanece disponivel e `/ready` responde HTTP 503 enquanto o provider nao entregar um contexto valido.

## Separacao de responsabilidades

```text
request validado pelo gateway
  -> provider em src/auth/corporate-provider.js
  -> validacao central em src/auth/index.js
  -> cliente GET em src/http/upstream-client.js
  -> adaptador Dispatch ou Aduana
  -> sanitizador por allowlist
  -> resposta publica
```

Os adaptadores nao conhecem onde um segredo futuro sera armazenado nem como sera obtido. Eles recebem somente o contexto abstrato produzido pelo provider e o repassam ao cliente upstream. O frontend nao participa da autenticacao corporativa e nao escolhe host ou caminho upstream.

## Ponto unico para a TI

`src/auth/corporate-provider.js` e o unico ponto de codigo da autenticacao dentro da aplicacao. O provider retorna somente `{ headers, dispatcher? }`, e `getAuthContext()` sempre encaminha esse retorno a `validatedAuthContext()` antes de qualquer chamada upstream.

`inspectConfiguration()` informa apenas o estado estrutural do provider. Essa funcao nao pode obter autorizacao, ler segredos, abrir certificados ou chamar servicos externos. O runtime e o readiness continuam usando `getAuthContext()` separadamente.

O provider e uma fronteira neutra: nao ha escolha antecipada entre bearer, API key, OAuth ou mTLS. A definicao deve vir da documentacao oficial da TI.

## Regras permanentes

- Nunca copiar credenciais do navegador, DevTools ou perfil do usuario.
- Nunca ler cookies, `localStorage`, `sessionStorage` ou arquivos de sessao.
- Nunca registrar headers completos ou valores de autenticacao.
- Segredos futuros devem vir de infraestrutura segura ou secrets manager.
- Destinos upstream permanecem definidos no servidor e limitados por allowlist.
- Toda resposta passa pelos sanitizadores antes de chegar ao frontend.
- Erros publicos nao incluem stack, corpo bruto upstream, headers ou URLs sensiveis.

Consulte tambem [HANDOFF-TI.md](HANDOFF-TI.md), [API-CONTRACT.md](API-CONTRACT.md) e [DEPLOYMENT.md](DEPLOYMENT.md).
