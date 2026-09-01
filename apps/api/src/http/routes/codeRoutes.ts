import { Router } from "express";
import {
  CodeFileTooLargeError,
  CodeFileNotFoundError,
  CodePathNotFileError,
  CodeRangeTooLargeError,
  type CodeQueryService,
} from "../../domain/code/CodeQueryService.js";
import { InvalidPathError } from "../../domain/paths/pathValidation.js";
import { parseCodeRangeQuery } from "../validation/requestParsers.js";

export function createCodeRouter(codeQueryService: CodeQueryService): Router {
  const router = Router();

  router.get("/api/v1/source-files/content", async (request, response, next) => {
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

      if (error instanceof CodeFileTooLargeError) {
        response.status(413).json({ error: "Code file is too large to preview" });
        return;
      }

      if (error instanceof CodeRangeTooLargeError) {
        response.status(400).json({ error: error.message });
        return;
      }

      if (error instanceof InvalidPathError) {
        response.status(400).json({ error: error.message });
        return;
      }

      next(error);
    }
  });

  return router;
}
