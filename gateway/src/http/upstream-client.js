"use strict";

const { validatedAuthContext } = require("../auth");
const { ERROR_CODES, GatewayError } = require("../errors");

function assertAllowedUrl(config, value) {
  let url;
  try {
    url = value instanceof URL ? new URL(value.toString()) : new URL(String(value || ""));
  } catch {
    throw new GatewayError(502, ERROR_CODES.UPSTREAM_HOST_NOT_ALLOWED, "Destino upstream invalido.");
  }

  if (url.username || url.password
      || !new Set(["http:", "https:"]).has(url.protocol)
      || !config.allowedUpstreamHosts.has(url.hostname.toLowerCase())
      || (config.nodeEnv === "production" && url.protocol !== "https:")) {
    throw new GatewayError(502, ERROR_CODES.UPSTREAM_HOST_NOT_ALLOWED, "Destino upstream nao autorizado.");
  }
  return url;
}

function buildUpstreamUrl({ config, baseUrl, path, query = {}, allowedQueryKeys = [] }) {
  const base = assertAllowedUrl(config, baseUrl);
  const rawPath = String(path || "");
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {
    throw new GatewayError(502, ERROR_CODES.UPSTREAM_HOST_NOT_ALLOWED, "Caminho upstream invalido.");
  }

  if (!rawPath.startsWith("/") || rawPath.startsWith("//") || rawPath.includes("\\")
      || rawPath.includes("?") || rawPath.includes("#") || decodedPath.split("/").includes("..")) {
    throw new GatewayError(502, ERROR_CODES.UPSTREAM_HOST_NOT_ALLOWED, "Caminho upstream nao autorizado.");
  }

  const target = assertAllowedUrl(config, new URL(rawPath, `${base.origin}/`));
  if (target.origin !== base.origin) {
    throw new GatewayError(502, ERROR_CODES.UPSTREAM_HOST_NOT_ALLOWED, "Host upstream nao autorizado.");
  }

  const allowed = new Set(allowedQueryKeys);
  for (const [name, value] of Object.entries(query)) {
    if (!allowed.has(name) || value === undefined || value === null || typeof value === "object") {
      throw new GatewayError(502, ERROR_CODES.UPSTREAM_INVALID_RESPONSE, "Parametro upstream invalido.");
    }
    target.searchParams.set(name, String(value));
  }
  return target;
}

async function readLimitedJson(response, maxBytes) {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new GatewayError(502, ERROR_CODES.UPSTREAM_INVALID_RESPONSE, "Resposta upstream excedeu o limite seguro.");
  }

  const chunks = [];
  let totalBytes = 0;
  const reader = response.body?.getReader?.();
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new GatewayError(502, ERROR_CODES.UPSTREAM_INVALID_RESPONSE, "Resposta upstream excedeu o limite seguro.");
      }
      chunks.push(chunk);
    }
  } else {
    const chunk = Buffer.from(await response.arrayBuffer());
    totalBytes = chunk.length;
    if (totalBytes > maxBytes) {
      throw new GatewayError(502, ERROR_CODES.UPSTREAM_INVALID_RESPONSE, "Resposta upstream excedeu o limite seguro.");
    }
    chunks.push(chunk);
  }

  try {
    const payload = JSON.parse(Buffer.concat(chunks, totalBytes).toString("utf8"));
    if (payload === null || typeof payload !== "object") throw new Error("payload invalido");
    return payload;
  } catch (error) {
    if (error instanceof GatewayError) throw error;
    throw new GatewayError(502, ERROR_CODES.UPSTREAM_INVALID_RESPONSE, "Resposta upstream nao contem JSON valido.");
  }
}

function createUpstreamClient({ config, fetchImpl = globalThis.fetch } = {}) {
  if (!config || typeof fetchImpl !== "function") {
    throw new GatewayError(500, "INVALID_CONFIGURATION", "Cliente HTTP upstream nao configurado.");
  }

  return Object.freeze({
    async get({ baseUrl, path, query, allowedQueryKeys, authContext = { headers: {} }, signal }) {
      const url = buildUpstreamUrl({ config, baseUrl, path, query, allowedQueryKeys });
      const authorized = validatedAuthContext(authContext);
      const controller = new AbortController();
      let timedOut = false;
      const cancel = () => controller.abort();
      signal?.addEventListener("abort", cancel, { once: true });
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, config.upstreamTimeoutMs);

      try {
        const options = {
          method: "GET",
          headers: {
            ...authorized.headers,
            accept: "application/json",
            "user-agent": "PainelDocasGateway/0.1"
          },
          redirect: "manual",
          credentials: "omit",
          signal: controller.signal
        };
        if (authorized.dispatcher !== undefined) options.dispatcher = authorized.dispatcher;

        let response;
        try {
          response = await fetchImpl(url.toString(), options);
        } catch {
          if (timedOut) {
            throw new GatewayError(504, ERROR_CODES.UPSTREAM_TIMEOUT, "Tempo limite do upstream excedido.");
          }
          throw new GatewayError(502, ERROR_CODES.UPSTREAM_UNAVAILABLE, "Servico upstream indisponivel.");
        }

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          if (location) {
            const redirectTarget = assertAllowedUrl(config, new URL(location, url));
            if (redirectTarget.origin !== url.origin) {
              throw new GatewayError(502, ERROR_CODES.UPSTREAM_HOST_NOT_ALLOWED, "Redirect upstream para host nao autorizado.");
            }
          }
          throw new GatewayError(502, ERROR_CODES.UPSTREAM_INVALID_RESPONSE, "Redirect upstream nao permitido.");
        }
        if (!response.ok) {
          throw new GatewayError(502, ERROR_CODES.UPSTREAM_UNAVAILABLE, "Servico upstream indisponivel.");
        }

        const contentType = String(response.headers.get("content-type") || "").toLowerCase();
        if (!contentType.startsWith("application/json")) {
          throw new GatewayError(502, ERROR_CODES.UPSTREAM_INVALID_RESPONSE, "Content-Type upstream invalido.");
        }
        return await readLimitedJson(response, config.maxResponseBytes);
      } catch (error) {
        if (error instanceof GatewayError) throw error;
        if (timedOut) {
          throw new GatewayError(504, ERROR_CODES.UPSTREAM_TIMEOUT, "Tempo limite do upstream excedido.");
        }
        throw new GatewayError(502, ERROR_CODES.UPSTREAM_INVALID_RESPONSE, "Resposta upstream invalida.");
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
      }
    }
  });
}

module.exports = { assertAllowedUrl, buildUpstreamUrl, createUpstreamClient, readLimitedJson };
