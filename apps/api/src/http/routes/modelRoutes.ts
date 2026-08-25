import { Router } from "express";
import type { AiModel } from "../../types.js";

export function createModelRouter(aiModel: AiModel): Router {
  const router = Router();

  router.get("/api/models", async (_request, response, next) => {
    try {
      response.json({ models: await aiModel.listModels() });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
