import cors from "cors";
import express from "express";
import type { AppLogger } from "../infrastructure/logging/AppLogger.js";
import { createErrorHandler } from "../http/middleware/errorHandler.js";
import { createRequestLogger } from "../http/middleware/requestLogger.js";

export function createApp(input: { logger: AppLogger }): express.Express {
  const app = express();

  app.use(cors());
  app.use(createRequestLogger(input.logger));
  app.use((_request, response) => {
    response.status(404).json({
      error: "Use the WebSocket JSON-RPC endpoints at /api/v1/rpc/state or /api/v1/rpc/actions",
    });
  });
  app.use(createErrorHandler(input.logger));

  return app;
}
