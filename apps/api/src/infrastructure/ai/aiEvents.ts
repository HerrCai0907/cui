import { getStringProperty, getTextFields } from "./jsonFields.js";
import type { AiHarness } from "../../types.js";
import {
  extractAssistantResponseText,
  formatHarnessMessages,
  isTraceHarnessMessage,
  normalizeHarnessEvent,
  type HarnessMessage,
} from "./harnessMessages.js";

export function parseJsonLine(line: string): unknown | undefined {
  const trimmed = line.trim();

  if (!trimmed) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return { type: "stdout", text: trimmed };
  }
}

export function extractThreadId(events: unknown[]): string | undefined {
  for (const event of events) {
    if (
      event &&
      typeof event === "object" &&
      "type" in event &&
      event.type === "thread.started" &&
      "thread_id" in event &&
      typeof event.thread_id === "string"
    ) {
      return event.thread_id;
    }

    if (event && typeof event === "object" && "payload" in event) {
      const payload = event.payload;

      if (payload && typeof payload === "object") {
        const sessionMetaId = getStringProperty(payload, "id");
        const threadId = getStringProperty(payload, "thread_id");

        if (getStringProperty(event, "type") === "session_meta" && sessionMetaId) {
          return sessionMetaId;
        }

        if (threadId) {
          return threadId;
        }
      }
    }
  }

  return undefined;
}

export function extractResponseDeltas(event: unknown, harness?: AiHarness): string[] {
  const eventType = getEventType(event);

  // Codex exec may repeat assistant snapshots across started/updated/completed
  // item events. Only completed items are stable enough to stream as response.
  if (harness === "codex" && (eventType === "item.started" || eventType === "item.updated")) {
    return [];
  }

  const message = normalizeHarnessEvent(event, harness);

  if (message.type !== "assistant_response") {
    return [];
  }

  return message.final ? [`${message.text}\n\n`] : extractAssistantResponseText(message);
}

export function shouldIncludeEventInTrace(event: unknown, harness?: AiHarness): boolean {
  return isTraceHarnessMessage(normalizeHarnessEvent(event, harness));
}

export function formatRawEvents(events: unknown[]): string {
  return events.map((event) => JSON.stringify(event)).join("\n");
}

export function formatTraceEvents(events: unknown[], harness?: AiHarness): string {
  return formatHarnessMessages(
    events.map((event) => normalizeHarnessEvent(event, harness)).filter(isTraceHarnessMessage),
  );
}

export function toTraceEvent(event: unknown, harness?: AiHarness): HarnessMessage | undefined {
  const message = normalizeHarnessEvent(event, harness);

  return isTraceHarnessMessage(message) ? message : undefined;
}

export function extractFinalResponse(events: unknown[]): string | undefined {
  for (const event of events.slice().reverse()) {
    if (getEventType(event) === "item.completed") {
      const item = (event as Record<string, unknown>).item;
      if (item && typeof item === "object" && getStringProperty(item, "type") === "agent_message") {
        return getStringProperty(item, "text");
      }
    }
  }
  return undefined;
}

export function extractProcessError(events: unknown[], failedExit: boolean): string | undefined {
  for (const event of events.slice().reverse()) {
    const type = getEventType(event);
    if (type === "turn.failed" || (failedExit && type === "error")) {
      const record = event as Record<string, unknown>;
      const error = record.error;
      return (
        (typeof error === "string" ? error : undefined) ||
        (error && typeof error === "object" ? getStringProperty(error, "message") : undefined) ||
        getStringProperty(record, "message") ||
        "AI turn failed"
      );
    }
  }
  return undefined;
}

function getEventType(event: unknown): string | undefined {
  return event && typeof event === "object" ? getStringProperty(event, "type") : undefined;
}
