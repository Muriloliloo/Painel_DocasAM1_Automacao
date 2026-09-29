# Controle de Docas SSP15 - AM1

Painel web para controle de ondas, docas, rotas carregadas, rotas expedidas, justificativas e fechamento operacional.

## Como Publicar no GitHub Pages

1. Crie um repositorio no GitHub.
2. Envie todos os arquivos desta pasta para o repositorio.
3. No GitHub, entre em **Settings > Pages**.
4. Em **Build and deployment**, selecione:
   - Source: **Deploy from a branch**
   - Branch: **main**
   - Folder: **/root**
5. Clique em **Save**.
6. O GitHub vai gerar um link parecido com:
   `https://seu-usuario.github.io/nome-do-repositorio/`

## Arquivos Principais

- `index.html`: painel principal. No GitHub Pages precisa ter esse nome.
- `ondas-dados.js`: dados iniciais do painel.
- `firebase-config.js`: configuracao do Firebase para sincronizar varios computadores.
- `assets/logo-dhl.png`: logo DHL.
- `assets/logo-mercado-livre.png`: logo Mercado Livre.
- `LEIA-ME-CONTROLE-ONDAS.txt`: instrucoes de uso operacional.
- `FIREBASE-DOCAS-AM1.txt`: passo a passo para ativar login, admin/leitor e Firestore.

## Importante

Sem Firebase ligado, os dados ficam salvos no navegador de cada computador.

Com Firebase ligado em `firebase-config.js`, o administrador edita e os computadores leitores acompanham ao vivo.

## Uso

1. Abra o link do GitHub Pages.
2. Clique em **Editar dados**.
3. Cole a **Extracao** com onda, rota, doca e transportadora.
4. Cole a **Base** com as rotas que subiram QR ou com status `Expedida`.
5. Acompanhe o painel, justificativas, resumo por onda e fechamento.

## Perfis com Firebase

O painel ja esta preparado para:

- Administrador: edita dados, base, justificativas e fechamento.
- Leitor: apenas visualiza o painel ao vivo.
