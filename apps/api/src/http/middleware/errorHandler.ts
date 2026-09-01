import type express from "express";
import type { AppLogger } from "../../infrastructure/logging/AppLogger.js";
import {
  RoundReviewNotFoundError,
  RunNotFoundError,
  SessionBusyError,
  SessionNotFoundError,
} from "../../domain/sessions/SessionService.js";
import {
  InvalidPathError,
  PathNotDirectoryError,
  PathNotFoundError,
} from "../../domain/paths/pathValidation.js";

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

    if (error instanceof RunNotFoundError) {
      response.status(404).json({ error: "Run not found" });
      return;
    }

    if (error instanceof RoundReviewNotFoundError) {
      response.status(404).json({ error: "Round review not found" });
      return;
    }

    if (error instanceof SessionBusyError) {
      response.status(409).json({ error: "Session already has a running run" });
      return;
    }

    if (error instanceof InvalidPathError || error instanceof PathNotDirectoryError) {
      response.status(400).json({ error: error.message });
      return;
    }

    if (error instanceof PathNotFoundError) {
      response.status(404).json({ error: error.message });
      return;
    }

    response.status(500).json({
      error: error instanceof Error ? error.message : "Internal server error",
    });
  };
}
