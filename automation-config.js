"use strict";

(() => {
  // Projeto dedicado exclusivamente a automacao.
  // Firebase nao e fonte operacional neste runtime.
  window.PAINEL_RUNTIME_MODE = "automation";
  window.PAINEL_AUTOMATION_STANDALONE = true;

  // HOMOLOGACAO TEMPORARIA:
  // usa um snapshot vazio confirmado publicado no proprio GitHub Pages.
  // Nenhuma rota ficticia e inserida na operacao.
  // Quando o gateway HTTPS real estiver disponivel, trocar somente gatewayBaseUrl
  // e snapshotPath para o endpoint oficial.
  const gatewayBaseUrl = "https://muriloliloo.github.io/Painel_DocasAM1_Automacao/mock-gateway";

  window.PAINEL_AUTOMATION_CONFIG = Object.freeze({
    gatewayBaseUrl,
    mode: "combined",
    snapshotPath: "snapshot.json",
    dispatchPath: "dispatch",
    customsPath: "customs",
    ymsPath: "yms",

    ymsEnabled: false,
    ymsPreview: false,

    facilityId: "SSP15",
    siteId: "MLB",
    groupId: "TESTE",
    cycle: "AM1",
    timezone: "America/Sao_Paulo",
    waves: ["1", "2", "3", "4", "5"],

    timeoutMs: 12000,
    intervalMs: 30000,
    enabled: true,
    standalone: true,
    homologation: true
  });
})();
