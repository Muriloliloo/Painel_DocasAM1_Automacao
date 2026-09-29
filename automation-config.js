"use strict";

(() => {
  // Este repositorio e dedicado exclusivamente a automacao.
  // Firebase nao e fonte operacional neste projeto.
  // Enquanto o gateway real nao estiver disponivel, o painel usa apenas
  // cache/localStorage e editor manual como contingencia local.
  window.PAINEL_RUNTIME_MODE = "automation";
  window.PAINEL_AUTOMATION_STANDALONE = true;

  // Configuracao publica da automacao.
  // NUNCA colocar token, cookie, senha, Authorization, CSRF ou qualquer segredo aqui.
  //
  // Preencha somente quando a TI fornecer o endereco HTTPS oficial do gateway.
  // Enquanto vazio, a automacao permanece desativada e o painel manual continua normal.
  const gatewayBaseUrl = "";

  if (!gatewayBaseUrl) return;

  window.PAINEL_AUTOMATION_CONFIG = Object.freeze({
    gatewayBaseUrl,
    mode: "combined",
    snapshotPath: "snapshot",
    dispatchPath: "dispatch",
    customsPath: "customs",
    ymsPath: "yms",

    // Fase 1: Dispatch + Aduana.
    // YMS somente deve ser ativado depois do provider BigQuery aprovado.
    ymsEnabled: false,
    ymsPreview: false,

    facilityId: "SSP15",
    siteId: "MLB",
    groupId: "",
    cycle: "AM1",
    timezone: "America/Sao_Paulo",
    waves: ["1", "2", "3", "4", "5"],

    timeoutMs: 12000,
    intervalMs: 30000,
    enabled: true,
    standalone: true
  });
})();
