import { Router } from "express";
import type { SessionService } from "../../domain/sessions/SessionService.js";
import { writeSse } from "../sse/writeSse.js";

export function createRunRouter(sessionService: SessionService): Router {
  const router = Router();

  router.get("/api/v1/runs/:runId/events", async (request, response, next) => {
    try {
      if (!(await sessionService.hasKnownRun(request.params.runId))) {
        response.status(404).json({ error: "Run not found" });
        return;
      }
    } catch (error) {
      next(error);
      return;
    }

    response.writeHead(200, {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
      "X-Accel-Buffering": "no",
    });
    response.flushHeaders?.();

    const unsubscribe = sessionService.subscribeToRun(request.params.runId, (event) => {
      writeSse(response, event.type, event);

      if (
        event.type === "run.succeeded" ||
        event.type === "run.failed" ||
        event.type === "run.cancelled"
      ) {
        response.end();
      }
    });

    request.on("close", unsubscribe);
  });

  router.post("/api/v1/runs/:runId/cancellation", async (request, response, next) => {
    try {
      await sessionService.cancelRun(request.params.runId);
      response.status(202).json({ status: "ok" });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
