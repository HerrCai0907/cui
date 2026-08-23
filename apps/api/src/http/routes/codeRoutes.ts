import { Router } from "express";
import {
  CodeFileNotFoundError,
  CodePathNotFileError,
  type CodeQueryService,
} from "../../domain/code/CodeQueryService.js";
import { parseCodeRangeQuery } from "../validation/requestParsers.js";

export function createCodeRouter(codeQueryService: CodeQueryService): Router {
  const router = Router();

  router.get("/api/code", async (request, response, next) => {
    try {
      const parsed = parseCodeRangeQuery(request.query);

      if (!parsed.ok) {
        response.status(400).json({ error: parsed.error });
        return;
      }

      const result = await codeQueryService.getCodeRange(parsed.value);

      response.json(result);
    } catch (error) {
      if (error instanceof CodeFileNotFoundError) {
        response.status(404).json({ error: "Code file not found" });
        return;
      }

      if (error instanceof CodePathNotFileError) {
        response.status(400).json({ error: "Code path is not a file" });
        return;
      }

      next(error);
    }
  });

  return router;
}
