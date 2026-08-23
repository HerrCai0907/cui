import type express from "express";
import type { AppLogger } from "../../infrastructure/logging/AppLogger.js";

export function createRequestLogger(logger: AppLogger): express.RequestHandler {
  return (request, response, next) => {
    const start = performance.now();

    response.on("finish", () => {
      void logger.framework.info("http.request", {
        method: request.method,
        path: request.path,
        statusCode: response.statusCode,
        durationMs: Math.round(performance.now() - start),
      });
    });

    next();
  };
}
