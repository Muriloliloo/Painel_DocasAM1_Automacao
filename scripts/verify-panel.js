"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const indexPath = path.join(root, "index.html");
const configPath = path.join(root, "automation-config.js");
const pagesPath = path.join(root, ".github", "workflows", "pages.yml");

const html = fs.readFileSync(indexPath, "utf8");
const config = fs.readFileSync(configPath, "utf8");
const pages = fs.readFileSync(pagesPath, "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(!html.includes('src="firebase-config.js"'), "index.html nao pode carregar firebase-config.js.");
assert(!pages.includes("cp firebase-config.js"), "GitHub Pages nao pode publicar firebase-config.js.");
assert(config.includes("window.PAINEL_AUTOMATION_STANDALONE = true"), "Modo standalone da automacao ausente.");
assert(html.includes('id="automationStatusBadge"'), "Badge de status da automacao ausente.");
assert(html.includes("async function refreshPanelSmart()"), "Atualizacao inteligente ausente.");
assert(html.includes("function renderAutomaticStatusBadge("), "Renderizador de status automatico ausente.");
assert(html.includes("const localOnly = automationStandaloneMode() || Boolean(options.localOnly);"), "Persistencia local de contingencia ausente.");

const inlineScripts = [];
const scriptRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let match;
while ((match = scriptRegex.exec(html))) {
  if (/\bsrc\s*=/.test(match[1])) continue;
  inlineScripts.push(match[2]);
}

assert(inlineScripts.length > 0, "Nenhum script inline encontrado para validar.");

inlineScripts.forEach((source, index) => {
  try {
    new Function(source);
  } catch (error) {
    throw new Error(`Script inline ${index + 1} possui erro de sintaxe: ${error.message}`);
  }
});

for (const [file, source] of [
  ["automation-config.js", config],
  ["closure-status.js", fs.readFileSync(path.join(root, "closure-status.js"), "utf8")],
  ["app.js", fs.readFileSync(path.join(root, "app.js"), "utf8")]
]) {
  try {
    new Function(source);
  } catch (error) {
    throw new Error(`${file} possui erro de sintaxe: ${error.message}`);
  }
}

console.log(`Painel validado: ${inlineScripts.length} script(s) inline, modo standalone ativo e Firebase fora do runtime.`);
