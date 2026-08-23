import type express from "express";
import type { AppLogger } from "../../infrastructure/logging/AppLogger.js";
import {
  SessionBusyError,
  SessionNotFoundError,
  SessionNotRunningError,
} from "../../domain/sessions/SessionService.js";

export function createErrorHandler(logger: AppLogger): express.ErrorRequestHandler {
  return (error, request, response, _next) => {
    console.error(error);
    void logger.framework.error("http.error", {
      method: request.method,
      path: request.path,
      error,
    });

    if (error instanceof SessionNotFoundError) {
      response.status(404).json({ error: "Session not found" });
      return;
    }

    if (error instanceof SessionBusyError) {
      response.status(409).json({ error: "Session already has a running turn" });
      return;
    }

    if (error instanceof SessionNotRunningError) {
      response.status(409).json({ error: "Session does not have a running turn" });
      return;
    }

    response.status(500).json({
      error: error instanceof Error ? error.message : "Internal server error",
    });
  };
}
