# Publicar Gateway na Vercel

Use o link abaixo para importar somente a pasta `gateway` deste repositório como um projeto Vercel independente:

https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FMuriloliloo%2FPainel_DocasAM1_Automacao%2Ftree%2Fmain%2Fgateway&project-name=painel-docas-am1-gateway&repository-name=painel-docas-am1-gateway

Nome sugerido do projeto:

`painel-docas-am1-gateway`

O primeiro deploy deve permanecer em homologação segura (`GATEWAY_MODE=mock`).

Depois do deploy, valide:

- `/health`
- `/ready`
- `/snapshot`

Somente depois de validar o gateway HTTPS o painel deve trocar a URL de homologação estática pela URL da Vercel.

Nunca adicionar credenciais, cookies, Authorization, CSRF ou tokens ao repositório ou ao frontend.
