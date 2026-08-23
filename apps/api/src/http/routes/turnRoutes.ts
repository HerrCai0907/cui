import { Router } from "express";
import type { SessionService } from "../../domain/sessions/SessionService.js";
import { writeSse } from "../sse/writeSse.js";

export function createTurnRouter(sessionService: SessionService): Router {
  const router = Router();

  router.get("/api/turns/:turnId/events", (request, response) => {
    if (!sessionService.hasRunningTurn(request.params.turnId)) {
      response.status(404).json({ error: "Turn not found" });
      return;
    }

    response.writeHead(200, {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
      "X-Accel-Buffering": "no",
    });
    response.flushHeaders?.();

    const unsubscribe = sessionService.subscribeToTurn(request.params.turnId, (event) => {
      writeSse(response, event.type, event);

      if (event.type === "done" || event.type === "failed") {
        response.end();
      }
    });

    request.on("close", unsubscribe);
  });

  return router;
}
