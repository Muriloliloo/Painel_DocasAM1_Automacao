"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const gatewayRoot = path.resolve(__dirname, "..");

function listJavaScriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.name !== "node_modules")
    .flatMap(entry => {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) return listJavaScriptFiles(absolutePath);
      return entry.isFile() && entry.name.endsWith(".js") ? [absolutePath] : [];
    });
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: gatewayRoot,
    stdio: "inherit",
    ...options
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

const files = listJavaScriptFiles(gatewayRoot).sort();
for (const file of files) {
  run(process.execPath, ["--check", file]);
}

run(process.execPath, ["--test"]);
console.log(`Verificacao concluida: ${files.length} arquivos JS e testes aprovados.`);
