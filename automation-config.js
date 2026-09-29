"use strict";

(() => {
  // Projeto dedicado exclusivamente a automacao.
  // Firebase nao e fonte operacional neste runtime.
  window.PAINEL_RUNTIME_MODE = "automation";
  window.PAINEL_AUTOMATION_STANDALONE = true;

  const params = new URLSearchParams(window.location.search);
  const hostname = window.location.hostname.toLowerCase();
  const localHost = hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "[::1]";
  const liveLocal = localHost && params.get("liveLocal") === "1";

  // Modo temporario LIVE local:
  // BigQuery autorizado no proprio computador -> gateway 127.0.0.1 -> painel local.
  // Nenhuma credencial e enviada ao GitHub/Vercel.
  //
  // Fora desse modo, permanece a homologacao cloud segura.
  const gatewayBaseUrl = liveLocal
    ? "http://127.0.0.1:8787"
    : "https://painel-docas-am1-gateway.vercel.app";

  window.PAINEL_AUTOMATION_CONFIG = Object.freeze({
    gatewayBaseUrl,
    mode: "combined",
    snapshotPath: "snapshot",
    dispatchPath: "dispatch",
    customsPath: "customs",
    ymsPath: "yms",

    ymsEnabled: liveLocal,
    ymsPreview: false,

    facilityId: "SSP15",
    siteId: "MLB",
    groupId: "",
    cycle: "AM1",
    timezone: "America/Sao_Paulo",
    waves: ["1", "2", "3", "4", "5"],

    timeoutMs: 30000,
    intervalMs: liveLocal ? 60000 : 30000,
    enabled: true,
    standalone: true,
    homologation: !liveLocal
  });
})();
