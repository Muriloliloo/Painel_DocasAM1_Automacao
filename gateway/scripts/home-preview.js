"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { URL } = require("node:url");

process.env.PORT = process.env.PORT || "8787";
process.env.NODE_ENV = process.env.NODE_ENV || "development";
process.env.GATEWAY_MODE = process.env.GATEWAY_MODE || "mock";
process.env.AUTH_MODE = process.env.AUTH_MODE || "unconfigured";

const previewMode = process.argv.includes("--recovery")
  ? "recovery"
  : process.argv.includes("--flow") ? "flow" : "yms";
process.env.MOCK_SCENARIO = process.env.MOCK_SCENARIO
  || (previewMode === "recovery"
    ? "operational-recovery"
    : previewMode === "flow" ? "operational-sequence" : "normal");
process.env.YMS_MODE = process.env.YMS_MODE
  || (previewMode === "yms" ? "mock" : "disabled");
process.env.PANEL_ALLOWED_ORIGIN = process.env.PANEL_ALLOWED_ORIGIN || "http://localhost:8000";

const { createConfig } = require("../src/config");
const { createGatewayServer } = require("../src/server");

const PANEL_PORT = 8000;
const PANEL_HOST = "127.0.0.1";
const GATEWAY_HOST = "127.0.0.1";
const repoRoot = path.resolve(__dirname, "../..");
const previewUrl = previewMode === "yms"
  ? "http://localhost:8000/?ymsPreview=1"
  : "http://localhost:8000/?automationPreview=1";

const allowedRootFiles = new Set([
  "index.html",
  "closure-status.js",
  "firebase-config.js",
  "automation-config.js",
  "ondas-dados.js",
  "logo-dhl.png",
  "logo-mercado-livre.png"
]);

const contentTypes = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp"
});

function safePanelPath(rawUrl) {
  const url = new URL(rawUrl, "http://localhost");
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }

  if (pathname === "/") pathname = "/index.html";
  if (!pathname.startsWith("/") || pathname.includes("\\") || pathname.split("/").includes("..")) {
    return null;
  }

  const relative = pathname.replace(/^\/+/, "");
  const segments = relative.split("/").filter(Boolean);
  if (!segments.length || segments.some(segment => segment.startsWith("."))) return null;

  if (segments[0] === "gateway") return null;
  if (segments[0] !== "assets" && !allowedRootFiles.has(relative)) return null;

  const filePath = path.resolve(repoRoot, relative);
  const relativeCheck = path.relative(repoRoot, filePath);
  if (relativeCheck.startsWith("..") || path.isAbsolute(relativeCheck)) return null;
  return filePath;
}

function createPanelServer() {
  return http.createServer((request, response) => {
    if (!new Set(["GET", "HEAD"]).has(request.method)) {
      response.writeHead(405, { Allow: "GET, HEAD" });
      response.end();
      return;
    }

    const filePath = safePanelPath(request.url || "/");
    if (!filePath) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Nao encontrado.");
      return;
    }

    fs.stat(filePath, (statError, stat) => {
      if (statError || !stat.isFile()) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Nao encontrado.");
        return;
      }

      const contentType = contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
      response.writeHead(200, {
        "Content-Type": contentType,
        "Cache-Control": "no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer"
      });

      if (request.method === "HEAD") {
        response.end();
        return;
      }

      const stream = fs.createReadStream(filePath);
      stream.on("error", () => response.destroy());
      stream.pipe(response);
    });
  });
}

function openBrowser(url) {
  try {
    let command;
    let args;

    if (process.platform === "win32") {
      command = "cmd";
      args = ["/c", "start", "", url];
    } else if (process.platform === "darwin") {
      command = "open";
      args = [url];
    } else {
      command = "xdg-open";
      args = [url];
    }

    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    child.unref();
  } catch {
    // O link continua sendo exibido no terminal caso a abertura automatica falhe.
  }
}

async function listen(server, port, host) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
}

async function close(server) {
  if (!server.listening) return;
  await new Promise(resolve => server.close(resolve));
}

async function main() {
  const config = createConfig();
  const gateway = createGatewayServer(config);
  const panel = createPanelServer();

  try {
    await listen(gateway, config.port, GATEWAY_HOST);
    await listen(panel, PANEL_PORT, PANEL_HOST);
  } catch (error) {
    await close(gateway);
    await close(panel);
    throw error;
  }

  console.log("");
  console.log(previewMode === "recovery"
    ? "Painel Docas AM1 - homologacao de falha e recuperacao"
    : previewMode === "flow"
      ? "Painel Docas AM1 - homologacao local da automacao"
      : "Painel Docas AM1 - homologacao local YMS");
  console.log("----------------------------------------------");
  console.log("Gateway mock: http://127.0.0.1:8787");
  console.log("Painel local : http://localhost:8000");
  console.log((previewMode === "recovery"
    ? "Recuperacao  : "
    : previewMode === "flow" ? "Fluxo mock   : " : "Previa YMS   : ") + previewUrl);
  console.log("");
  console.log("Nenhuma credencial corporativa esta sendo usada.");
  console.log("Pressione Ctrl+C para encerrar.");
  console.log("");

  openBrowser(previewUrl);

  const shutdown = async () => {
    await close(panel);
    await close(gateway);
    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch(error => {
  console.error("Falha ao iniciar a homologacao local:", error?.message || error);
  process.exitCode = 1;
});
