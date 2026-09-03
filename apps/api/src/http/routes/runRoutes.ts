import { Router } from "express";
import type { RunStreamEvent } from "../../domain/runs/runEvents.js";
import type { SessionService } from "../../domain/sessions/SessionService.js";
import { filterSessionViewTraceMessages } from "../../domain/sessions/sessionViews.js";
import { isTraceEventVisible, type TraceMessageType } from "../../domain/sessions/traceMessages.js";
import { parseRunEventsQuery } from "../validation/requestParsers.js";
import { writeSse } from "../sse/writeSse.js";

export function createRunRouter(sessionService: SessionService): Router {
  const router = Router();

  router.get("/api/v1/runs/:runId/events", async (request, response, next) => {
    const parsed = parseRunEventsQuery(request.query);

    if (!parsed.ok) {
      response.status(400).json({ error: parsed.error });
      return;
    }

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

    const visibleTraceTypes = parsed.value.traceMessageTypes
      ? new Set(parsed.value.traceMessageTypes)
      : undefined;
    const unsubscribe = sessionService.subscribeToRun(request.params.runId, (event) => {
      const filteredEvent = filterRunStreamEvent(event, visibleTraceTypes);

      if (!filteredEvent) {
        return;
      }

      writeSse(response, filteredEvent.type, filteredEvent);

      if (
        filteredEvent.type === "run.succeeded" ||
        filteredEvent.type === "run.failed" ||
        filteredEvent.type === "run.cancelled"
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

function filterRunStreamEvent(
  event: RunStreamEvent,
  visibleTraceTypes: Set<TraceMessageType> | undefined,
): RunStreamEvent | undefined {
  if (!visibleTraceTypes) {
    return event;
  }

  if (event.type === "run.trace") {
    return isTraceEventVisible(event.event, visibleTraceTypes) ? event : undefined;
  }

  if (event.type === "session.updated" || event.type === "run.succeeded") {
    return {
      ...event,
      session: filterSessionViewTraceMessages(event.session, [...visibleTraceTypes]),
    };
  }

  return event;
}
