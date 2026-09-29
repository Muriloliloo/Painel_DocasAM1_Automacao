"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const { createConfig } = require("../src/config");
const { createRuntimeGateway } = require("../src/runtime-gateway");
const { createYmsQueryExecutor } = require("../src/start");
const { preflight } = require("./preflight-yms");

const PANEL_HOST = "127.0.0.1";
const PANEL_PORT = 8080;
const GATEWAY_HOST = "127.0.0.1";
const GATEWAY_PORT = 8787;
const PANEL_ORIGIN = `http://${PANEL_HOST}:${PANEL_PORT}`;
const PANEL_URL = `${PANEL_ORIGIN}/?liveLocal=1`;
const ROOT = path.resolve(__dirname, "../..");

const MIME = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp"
});

function configureLiveEnvironment() {
  Object.assign(process.env, {
    NODE_ENV: "development",
    PORT: String(GATEWAY_PORT),
    BIND_HOST: GATEWAY_HOST,
    GATEWAY_MODE: "real",
    AUTH_MODE: "unconfigured",
    YMS_MODE: "provider",
    SNAPSHOT_SOURCE_MODE: "yms-primary",
    YMS_SQL_PROFILE: "rich",
    GOOGLE_CLOUD_PROJECT: "meli-bi-data",
    BIGQUERY_LOCATION: "US",
    BIGQUERY_MAXIMUM_BYTES_BILLED: "10737418240",
    PANEL_ALLOWED_ORIGIN: PANEL_ORIGIN,
    ALLOWED_FACILITY_IDS: "SSP15",
    ALLOWED_SITE_IDS: "MLB",
    ALLOWED_CYCLES: "AM1",
    ALLOWED_WAVES: "1,2,3,4,5",
    YMS_QUERY_CACHE_MS: "55000",
    YMS_TIMEOUT_MS: "30000",
    MAX_RESPONSE_BYTES: "1048576"
  });
}

function safeStaticPath(requestUrl) {
  const url = new URL(requestUrl, PANEL_ORIGIN);
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const decoded = decodeURIComponent(requested);

  if (decoded.includes("\\") || decoded.split("/").includes("..")) return null;
  if (decoded === "/gateway" || decoded.startsWith("/gateway/")
      || decoded === "/.git" || decoded.startsWith("/.git/")
      || decoded === "/.github" || decoded.startsWith("/.github/")) {
    return null;
  }

  const absolute = path.resolve(ROOT, "." + decoded);
  if (!absolute.startsWith(ROOT + path.sep)) return null;

  const ext = path.extname(absolute).toLowerCase();
  if (!MIME[ext]) return null;
  return { absolute, contentType: MIME[ext] };
}

function createPanelServer() {
  return http.createServer((request, response) => {
    if (!new Set(["GET", "HEAD"]).has(request.method || "")) {
      response.writeHead(405, { Allow: "GET, HEAD" });
      response.end();
      return;
    }

    let target;
    try {
      target = safeStaticPath(request.url || "/");
    } catch {
      target = null;
    }

    if (!target || !fs.existsSync(target.absolute) || !fs.statSync(target.absolute).isFile()) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Arquivo nao encontrado.");
      return;
    }

    response.writeHead(200, {
      "Content-Type": target.contentType,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    });

    if (request.method === "HEAD") {
      response.end();
      return;
    }

    fs.createReadStream(target.absolute).pipe(response);
  });
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
}

function close(server) {
  return new Promise(resolve => {
    if (!server?.listening) return resolve();
    server.close(() => resolve());
  });
}

function openBrowser(url) {
  try {
    if (process.platform === "win32") {
      const child = spawn("cmd.exe", ["/c", "start", "", url], {
        detached: true,
        stdio: "ignore",
        windowsHide: true
      });
      child.unref();
      return;
    }
    if (process.platform === "darwin") {
      const child = spawn("open", [url], { detached: true, stdio: "ignore" });
      child.unref();
      return;
    }
    const child = spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
    child.unref();
  } catch {
    // A URL continua sendo exibida no terminal.
  }
}

async function main() {
  configureLiveEnvironment();

  const config = createConfig();
  const ymsQueryExecutor = createYmsQueryExecutor(config);

  process.stdout.write("\n[1/3] Validando acesso BigQuery somente leitura...\n");
  try {
    await preflight({ execute: ymsQueryExecutor });
  } catch (error) {
    process.stderr.write(
      "\nNao foi possivel autenticar/ler o BigQuery com ADC neste computador.\n"
      + "Use uma conta corporativa autorizada e execute:\n"
      + "  gcloud auth application-default login\n"
      + "Depois execute INICIAR-LIVE-LOCAL.cmd novamente.\n\n"
      + "Detalhe seguro: " + (error?.message || "falha no preflight") + "\n"
    );
    process.exitCode = 2;
    return;
  }

  process.stdout.write("[2/3] Acesso BigQuery confirmado. Iniciando gateway LIVE...\n");

  const gateway = createRuntimeGateway({ config, ymsQueryExecutor });
  const panel = createPanelServer();

  const shutdown = async () => {
    await Promise.allSettled([close(panel), close(gateway)]);
    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  await listen(gateway, GATEWAY_PORT, GATEWAY_HOST);
  await listen(panel, PANEL_PORT, PANEL_HOST);

  process.stdout.write(
    "[3/3] LIVE ativo.\n"
    + "Painel: " + PANEL_URL + "\n"
    + "Gateway: http://" + GATEWAY_HOST + ":" + GATEWAY_PORT + "\n"
    + "Fonte: BigQuery meli-bi-data / SSP15 / AM1 / dia operacional automatico.\n"
    + "Atualizacao do painel: 60 s. Cache BigQuery: 55 s.\n"
    + "Feche esta janela para encerrar o modo LIVE local.\n\n"
  );

  openBrowser(PANEL_URL);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write("\nFalha ao iniciar LIVE local: " + (error?.message || error) + "\n");
    process.exitCode = 1;
  });
}

module.exports = {
  configureLiveEnvironment,
  safeStaticPath,
  createPanelServer,
  PANEL_URL
};
