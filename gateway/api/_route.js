"use strict";

const handler = require("./index");

module.exports = function route(pathname) {
  return async function routedGatewayHandler(request, response) {
    const parsed = new URL(request.url || "/", "http://gateway.local");
    request.url = pathname + parsed.search;
    return handler(request, response);
  };
};
