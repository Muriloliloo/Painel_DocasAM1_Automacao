# Deploy do gateway na Vercel

Este gateway foi preparado para rodar sem depender de computador pessoal.

## Homologacao segura

Ao importar a pasta `gateway` para a Vercel, o runtime de producao da Vercel inicia em modo `mock` seguro quando nenhuma configuracao corporativa foi fornecida.

Nesse estado:

- `GATEWAY_MODE=mock` por padrao;
- `AUTH_MODE=unconfigured`;
- `YMS_MODE=disabled`;
- CORS permite somente `https://muriloliloo.github.io`;
- `groupId` de homologacao fica restrito a `TESTE`;
- nenhuma credencial corporativa e carregada;
- nenhuma chamada real ao Dispatch ou Aduana e feita.

Endpoints esperados:

- `/health`
- `/ready`
- `/snapshot`
- `/dispatch`
- `/customs`
- `/yms`

## Virada para modo real

A mudanca para `GATEWAY_MODE=real` deve ser feita somente com configuracao corporativa aprovada.

Nesse modo, o gateway volta a falhar fechado se as variaveis obrigatorias nao estiverem definidas. No minimo:

- `PANEL_ALLOWED_ORIGIN=https://muriloliloo.github.io`
- `GATEWAY_MODE=real`
- `AUTH_MODE=corporate`
- `ALLOWED_GROUP_IDS=<valor aprovado>`
- demais identificadores operacionais e provider corporativo aprovados.

Nunca colocar Cookie, Authorization, CSRF, token, senha ou credenciais no repositorio ou no frontend.
