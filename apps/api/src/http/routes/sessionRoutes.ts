import { Router } from "express";
import type { SessionService } from "../../domain/sessions/SessionService.js";
import {
  parseCreateShellSessionBody,
  parseContinueSessionBody,
  parseCreateSessionBody,
  parseRoundReviewParams,
  parseRoundReviewQuery,
  parseRunShellCommandBody,
  parseUpdateSessionBody,
} from "../validation/requestParsers.js";

export function createSessionRouter(sessionService: SessionService): Router {
  const router = Router();

  router.get("/api/sessions", async (_request, response, next) => {
    try {
      response.json({ sessions: await sessionService.listSessionViews() });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/sessions/:sessionId", async (request, response, next) => {
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

  router.get("/api/sessions/:sessionId/rounds/:round/review", async (request, response, next) => {
    try {
      const parsedParams = parseRoundReviewParams(request.params);

      if (!parsedParams.ok) {
        response.status(400).json({ error: parsedParams.error });
        return;
      }

      const parsedQuery = parseRoundReviewQuery(request.query);

      if (!parsedQuery.ok) {
        response.status(400).json({ error: parsedQuery.error });
        return;
      }

      const includeAtomicReview = parsedQuery.value.mode !== "full";
      const models = parsedQuery.value.atomicReviewModel
        ? { atomicReview: parsedQuery.value.atomicReviewModel }
        : undefined;
      const review = await sessionService.getRoundReview(
        parsedParams.value.sessionId,
        parsedParams.value.round,
        {
          includeAtomicReview,
          models,
        },
      );

      if (!review) {
        response.status(404).json({ error: "Round review not found" });
        return;
      }

      response.json({ review });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/api/sessions/:sessionId", async (request, response, next) => {
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

  router.post("/api/sessions", async (request, response, next) => {
    try {
      const parsed = parseCreateSessionBody(request.body);

      if (!parsed.ok) {
        response.status(400).json({ error: parsed.error });
        return;
      }

      const submittedTurn = await sessionService.beginCreateSession(parsed.value);

      response.status(202).json({ status: "ok", ...submittedTurn });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/shell-sessions", async (request, response, next) => {
    try {
      const parsed = parseCreateShellSessionBody(request.body);

      if (!parsed.ok) {
        response.status(400).json({ error: parsed.error });
        return;
      }

      const submittedTurn = await sessionService.beginCreateShellSession(parsed.value);

      response.status(202).json({ status: "ok", ...submittedTurn });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/sessions/:sessionId/messages", async (request, response, next) => {
    try {
      const parsed = parseContinueSessionBody(request.body);

      if (!parsed.ok) {
        response.status(400).json({ error: parsed.error });
        return;
      }

      const submittedTurn = await sessionService.beginContinueSession(
        request.params.sessionId,
        parsed.value,
      );

      response.status(202).json({ status: "ok", ...submittedTurn });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/sessions/:sessionId/shell", async (request, response, next) => {
    try {
      const parsed = parseRunShellCommandBody(request.body);

      if (!parsed.ok) {
        response.status(400).json({ error: parsed.error });
        return;
      }

      const submittedTurn = await sessionService.beginRunShellCommand(
        request.params.sessionId,
        parsed.value,
      );

      response.status(202).json({ status: "ok", ...submittedTurn });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/sessions/:sessionId/stop", async (request, response, next) => {
    try {
      await sessionService.cancelRunningTurn(request.params.sessionId);
      response.status(202).json({ status: "ok" });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
