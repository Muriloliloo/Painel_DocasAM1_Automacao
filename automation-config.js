"use strict";

(() => {
  // Projeto dedicado exclusivamente a automacao.
  // Firebase nao e fonte operacional neste runtime.
  window.PAINEL_RUNTIME_MODE = "automation";
  window.PAINEL_AUTOMATION_STANDALONE = true;

  // HOMOLOGACAO CLOUD:
  // o painel usa somente o gateway HTTPS publicado na Vercel.
  // A fonte real sera BigQuery/YMS por identidade GCP autorizada.
  // Nao ha dependencia de computador pessoal, cookie ou sessao de navegador.
  const gatewayBaseUrl = "https://painel-docas-am1-gateway.vercel.app";

  window.PAINEL_AUTOMATION_CONFIG = Object.freeze({
    gatewayBaseUrl,
    mode: "combined",
    snapshotPath: "snapshot",
    dispatchPath: "dispatch",
    customsPath: "customs",
    ymsPath: "yms",

    ymsEnabled: false,
    ymsPreview: false,

    facilityId: "SSP15",
    siteId: "MLB",
    groupId: "",
    cycle: "AM1",
    timezone: "America/Sao_Paulo",
    waves: ["1", "2", "3", "4", "5"],

    timeoutMs: 35000,
    intervalMs: 30000,
    enabled: true,
    standalone: true,
    homologation: true
  });
})();
