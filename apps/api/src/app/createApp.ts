import cors from "cors";
import express from "express";
import type { AppLogger } from "../infrastructure/logging/AppLogger.js";
import { createOpenApiDocument } from "../contracts/openapi.js";
import type { SessionService } from "../domain/sessions/SessionService.js";
import type { CodeQueryService } from "../domain/code/CodeQueryService.js";
import { createErrorHandler } from "../http/middleware/errorHandler.js";
import { createRequestLogger } from "../http/middleware/requestLogger.js";
import { createCodeRouter } from "../http/routes/codeRoutes.js";
import { createHealthRouter } from "../http/routes/healthRoutes.js";
import { createModelRouter } from "../http/routes/modelRoutes.js";
import { createSessionRouter } from "../http/routes/sessionRoutes.js";
import { createTurnRouter } from "../http/routes/turnRoutes.js";
import type { AiModel } from "../types.js";

export function createApp(input: {
  logger: AppLogger;
  aiModel: AiModel;
  sessionService: SessionService;
  codeQueryService: CodeQueryService;
}): express.Express {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(createRequestLogger(input.logger));
  app.get("/openapi.json", (_request, response) => {
    response.json(createOpenApiDocument());
  });
  app.use(createHealthRouter());
  app.use(createModelRouter(input.aiModel));
  app.use(createCodeRouter(input.codeQueryService));
  app.use(createSessionRouter(input.sessionService));
  app.use(createTurnRouter(input.sessionService));
  app.use(createErrorHandler(input.logger));

  return app;
}
