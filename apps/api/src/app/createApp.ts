import cors from "cors";
import express from "express";
import type { AppLogger } from "../infrastructure/logging/AppLogger.js";
import type { SessionService } from "../domain/sessions/SessionService.js";
import { createErrorHandler } from "../http/middleware/errorHandler.js";
import { createRequestLogger } from "../http/middleware/requestLogger.js";
import { createHealthRouter } from "../http/routes/healthRoutes.js";
import { createSessionRouter } from "../http/routes/sessionRoutes.js";
import { createTurnRouter } from "../http/routes/turnRoutes.js";

export function createApp(input: {
  logger: AppLogger;
  sessionService: SessionService;
}): express.Express {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(createRequestLogger(input.logger));
  app.use(createHealthRouter());
  app.use(createSessionRouter(input.sessionService));
  app.use(createTurnRouter(input.sessionService));
  app.use(createErrorHandler(input.logger));

  return app;
}
