import { Router } from "express";
import type { SessionService } from "../../domain/sessions/SessionService.js";
import {
  parseCreateRoundReviewRunBody,
  parseCreateRunBody,
  parseCreateSessionBody,
  parseListSessionsQuery,
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
      const session = await sessionService.getSessionView(request.params.sessionId);

      if (!session) {
        response.status(404).json({ error: "Session not found" });
        return;
      }

      response.json({ session });
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
