import { Router } from "express";
import type { SessionService } from "../../domain/sessions/SessionService.js";
import { parseCreateSessionBody, parsePrompt } from "../validation/requestParsers.js";

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
      const round = Number(request.params.round);

      if (!Number.isInteger(round) || round < 1) {
        response.status(400).json({ error: "round must be a positive integer" });
        return;
      }

      const includeAtomicReview = request.query.mode !== "full";
      const review = await sessionService.getRoundReview(request.params.sessionId, round, {
        includeAtomicReview,
      });

      if (!review) {
        response.status(404).json({ error: "Round review not found" });
        return;
      }

      response.json({ review });
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

  router.post("/api/sessions/:sessionId/messages", async (request, response, next) => {
    try {
      const prompt = parsePrompt(request.body);

      if (!prompt) {
        response.status(400).json({ error: "prompt must be a non-empty string" });
        return;
      }

      const submittedTurn = await sessionService.beginContinueSession(request.params.sessionId, {
        prompt,
      });

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
