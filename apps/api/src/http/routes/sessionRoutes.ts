import { Router } from "express";
import type { SessionService } from "../../domain/sessions/SessionService.js";
import {
  parseAtomicDiffFileParams,
  parseCreateRoundReviewRunBody,
  parseCreateRunBody,
  parseCreateSessionBody,
  parseDiffFilePageQuery,
  parseGetSessionMessagesQuery,
  parseGetSessionQuery,
  parseListSessionsQuery,
  parseQueuedPromptParams,
  parseRoundDiffFileParams,
  parseRoundReviewParams,
  parseUpdateSessionBody,
} from "../validation/requestParsers.js";

export function createSessionRouter(sessionService: SessionService): Router {
  const router = Router();

  router.get("/api/v1/sessions", async (request, response, next) => {
    try {
      const parsed = parseListSessionsQuery(request.query);

      if (!parsed.ok) {
        response.status(400).json({ error: parsed.error });
        return;
      }

      response.json(await sessionService.listSessionViews(parsed.value));
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/v1/sessions/:sessionId", async (request, response, next) => {
    try {
      const parsed = parseGetSessionQuery(request.query);

      if (!parsed.ok) {
        response.status(400).json({ error: parsed.error });
        return;
      }

      const session = await sessionService.getSessionView(request.params.sessionId, parsed.value);

      if (!session) {
        response.status(404).json({ error: "Session not found" });
        return;
      }

      response.json({ session });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/v1/sessions/:sessionId/messages", async (request, response, next) => {
    try {
      const parsed = parseGetSessionMessagesQuery(request.query);

      if (!parsed.ok) {
        response.status(400).json({ error: parsed.error });
        return;
      }

      const page = await sessionService.getSessionMessages(request.params.sessionId, parsed.value);

      if (!page) {
        response.status(404).json({ error: "Session not found" });
        return;
      }

      response.json(page);
    } catch (error) {
      next(error);
    }
  });

  router.get(
    "/api/v1/sessions/:sessionId/rounds/:round/review",
    async (request, response, next) => {
      try {
        const parsedParams = parseRoundReviewParams(request.params);

        if (!parsedParams.ok) {
          response.status(400).json({ error: parsedParams.error });
          return;
        }

        const review = await sessionService.getRoundReview(
          parsedParams.value.sessionId,
          parsedParams.value.round,
        );

        if (!review) {
          response.status(404).json({ error: "Round review not found" });
          return;
        }

        response.json({ review });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    "/api/v1/sessions/:sessionId/rounds/:round/diff/files/:fileId",
    async (request, response, next) => {
      try {
        const parsedParams = parseRoundDiffFileParams(request.params);

        if (!parsedParams.ok) {
          response.status(400).json({ error: parsedParams.error });
          return;
        }

        const parsedQuery = parseDiffFilePageQuery(request.query);

        if (!parsedQuery.ok) {
          response.status(400).json({ error: parsedQuery.error });
          return;
        }

        const page = await sessionService.getRoundDiffFilePage(
          parsedParams.value.sessionId,
          parsedParams.value.round,
          parsedParams.value.fileId,
          parsedQuery.value,
        );

        if (!page) {
          response.status(404).json({ error: "Diff file not found" });
          return;
        }

        response.json({ page });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    "/api/v1/sessions/:sessionId/rounds/:round/atomic/items/:itemId/diff/files/:fileId",
    async (request, response, next) => {
      try {
        const parsedParams = parseAtomicDiffFileParams(request.params);

        if (!parsedParams.ok) {
          response.status(400).json({ error: parsedParams.error });
          return;
        }

        const parsedQuery = parseDiffFilePageQuery(request.query);

        if (!parsedQuery.ok) {
          response.status(400).json({ error: parsedQuery.error });
          return;
        }

        const page = await sessionService.getAtomicReviewItemDiffFilePage(
          parsedParams.value.sessionId,
          parsedParams.value.round,
          parsedParams.value.itemId,
          parsedParams.value.fileId,
          parsedQuery.value,
        );

        if (!page) {
          response.status(404).json({ error: "Atomic diff file not found" });
          return;
        }

        response.json({ page });
      } catch (error) {
        next(error);
      }
    },
  );

  router.patch("/api/v1/sessions/:sessionId", async (request, response, next) => {
    try {
      const parsed = parseUpdateSessionBody(request.body);

      if (!parsed.ok) {
        response.status(400).json({ error: parsed.error });
        return;
      }

      const session = await sessionService.updateSession(request.params.sessionId, parsed.value);

      response.json({ session });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/v1/sessions", async (request, response, next) => {
    try {
      const parsed = parseCreateSessionBody(request.body);

      if (!parsed.ok) {
        response.status(400).json({ error: parsed.error });
        return;
      }

      const session = await sessionService.createSessionContainer(parsed.value);

      response.status(201).json({ session });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/v1/sessions/:sessionId/runs", async (request, response, next) => {
    try {
      const parsed = parseCreateRunBody(request.body);

      if (!parsed.ok) {
        response.status(400).json({ error: parsed.error });
        return;
      }

      const submittedRun = await sessionService.createRun(request.params.sessionId, parsed.value);

      response.status(202).json(submittedRun);
    } catch (error) {
      next(error);
    }
  });

  router.delete(
    "/api/v1/sessions/:sessionId/queued-prompts/:queuedPromptId",
    async (request, response, next) => {
      try {
        const parsedParams = parseQueuedPromptParams(request.params);

        if (!parsedParams.ok) {
          response.status(400).json({ error: parsedParams.error });
          return;
        }

        const result = await sessionService.withdrawQueuedPrompts(
          parsedParams.value.sessionId,
          parsedParams.value.queuedPromptId,
        );

        response.json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/api/v1/sessions/:sessionId/rounds/:round/review-runs",
    async (request, response, next) => {
      try {
        const parsedParams = parseRoundReviewParams(request.params);

        if (!parsedParams.ok) {
          response.status(400).json({ error: parsedParams.error });
          return;
        }

        const parsed = parseCreateRoundReviewRunBody(request.body);

        if (!parsed.ok) {
          response.status(400).json({ error: parsed.error });
          return;
        }

        const submittedRun = await sessionService.createRoundReviewRun(
          parsedParams.value.sessionId,
          parsedParams.value.round,
          parsed.value,
        );

        response.status(202).json(submittedRun);
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
