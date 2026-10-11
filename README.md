# Controle de Docas SSP15 - AM1 • Automacao

Projeto dedicado a evolucao automatizada do painel de docas AM1. O repositorio operacional original permanece separado e nao recebe as alteracoes desta versao.\n\nPainel web para controle de ondas, docas, rotas carregadas, rotas expedidas, justificativas e fechamento operacional.



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
