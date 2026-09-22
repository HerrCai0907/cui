import { Router } from "express";
import type { AiModel } from "../../types.js";
import { parseListModelsQuery } from "../validation/requestParsers.js";

export function createModelRouter(aiModel: AiModel): Router {
  const router = Router();

  router.get("/api/v1/models", async (request, response, next) => {
    try {
      const parsed = parseListModelsQuery(request.query);

      if (!parsed.ok) {
        response.status(400).json({ error: parsed.error });
        return;
      }

      response.json({ models: await aiModel.listModels(parsed.value.harness) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
