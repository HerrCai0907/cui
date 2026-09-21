import type express from "express";
import type { RunStreamEvent } from "../../domain/sessions/SessionService.js";

const MAX_EVENTS_PER_TICK = 16;

type QueuedSseEvent = {
  eventName: string;
  event: RunStreamEvent;
  endAfterWrite: boolean;
};

export type SseStreamWriter = {
  enqueue: (
    eventName: string,
    event: RunStreamEvent,
    options?: { endAfterWrite?: boolean },
  ) => boolean;
  close: () => void;
};

export function createSseStreamWriter(response: express.Response): SseStreamWriter {
  const queue: QueuedSseEvent[] = [];
  let drainScheduled = false;
  let closed = false;

  const close = () => {
    closed = true;
    queue.length = 0;
    response.off("drain", scheduleDrain);
  };

  const scheduleDrain = () => {
    if (closed || drainScheduled) {
      return;
    }

    drainScheduled = true;
    setImmediate(drainQueue);
  };

  const drainQueue = () => {
    drainScheduled = false;

    if (closed || response.destroyed || response.writableEnded) {
      close();
      return;
    }

    let written = 0;

    while (written < MAX_EVENTS_PER_TICK && queue.length > 0) {
      const queuedEvent = queue.shift()!;

      if (response.destroyed || response.writableEnded) {
        close();
        return;
      }

      const wrote = response.write(formatSse(queuedEvent.eventName, queuedEvent.event));

      written += 1;

      if (queuedEvent.endAfterWrite) {
        response.end();
        close();
        return;
      }

      if (response.writableNeedDrain) {
        response.once("drain", scheduleDrain);
        return;
      }
    }

    if (queue.length > 0) {
      scheduleDrain();
    }
  };

  return {
    enqueue: (eventName, event, options = {}) => {
      if (closed || response.destroyed || response.writableEnded) {
        return false;
      }

      queue.push({
        eventName,
        event,
        endAfterWrite: Boolean(options.endAfterWrite),
      });
      scheduleDrain();

      return true;
    },
    close,
  };
}

export function writeSse(
  response: express.Response,
  eventName: string,
  event: RunStreamEvent,
): boolean {
  if (response.destroyed || response.writableEnded) {
    return false;
  }

  return response.write(formatSse(eventName, event));
}

function formatSse(eventName: string, event: RunStreamEvent): string {
  return `event: ${eventName}\ndata: ${JSON.stringify(event)}\n\n`;
}
