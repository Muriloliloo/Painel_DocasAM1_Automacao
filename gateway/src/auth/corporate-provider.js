"use strict";

const { ERROR_CODES, GatewayError } = require("../errors");

/*
 * UNICO PONTO DE IMPLEMENTACAO DA AUTENTICACAO CORPORATIVA.
 *
 * A) Obtenha aqui a autorizacao pelo mecanismo oficial aprovado pela TI.
 * B) Construa aqui somente os headers e, se necessario, o dispatcher seguro.
 * C) Retorne { headers: { ... }, dispatcher: opcional }.
 * D) Nunca copie sessao do navegador, registre credenciais, coloque segredos no
 *    repositorio/config publico ou desative a validacao central.
 *
 * O retorno sempre passara por validatedAuthContext() em src/auth/index.js.
 * inspectConfiguration() e estritamente estrutural: nao deve obter autorizacao,
 * ler segredos, abrir certificados nem realizar chamadas externas.
 */
function createCorporateAuthProvider() {
  return Object.freeze({
    mode: "corporate",
    inspectConfiguration() {
      return Object.freeze({
        configured: false,
        mode: "corporate",
        reason: ERROR_CODES.AUTH_NOT_CONFIGURED
      });
    },
    async getAuthContext() {
      throw new GatewayError(
        503,
        ERROR_CODES.AUTH_NOT_CONFIGURED,
        "A autenticacao corporativa oficial ainda nao foi configurada."
      );
    }
  });
}

module.exports = { createCorporateAuthProvider };
