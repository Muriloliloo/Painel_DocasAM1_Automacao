"use strict";

const handler = require("./index");

module.exports = function route(pathname) {
  return async function routedGatewayHandler(request, response) {
    const parsed = new URL(request.url || "/", "http://gateway.local");
    const routedRequest = Object.create(request);
    Object.defineProperty(routedRequest, "url", {
      value: pathname + parsed.search,
      enumerable: true,
      configurable: false,
      writable: false
    });
    return handler(routedRequest, response);
  };
};
