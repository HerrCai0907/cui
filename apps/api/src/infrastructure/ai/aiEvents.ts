import { getStringProperty, getTextFields } from "./jsonFields.js";
import type { AiHarness } from "../../types.js";
import {
  extractAssistantResponseText,
  formatHarnessMessages,
  isTraceHarnessMessage,
  normalizeHarnessEvent,
  type HarnessMessage,
} from "./harnessMessages.js";

const MAX_TRACE_STRING_LENGTH = 256 * 1024;
const MAX_TRACE_ARRAY_LENGTH = 100;
const MAX_TRACE_OBJECT_KEYS = 100;
const MAX_TRACE_DEPTH = 8;

export type FormatTraceEventsOptions = {
  compact?: boolean;
  includeRaw?: boolean;
};

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
  return Boolean(toTraceEvent(event, harness));
}

export function formatRawEvents(events: unknown[]): string {
  return events.map((event) => JSON.stringify(event)).join("\n");
}

export function formatTraceEvents(
  events: unknown[],
  harness?: AiHarness,
  options: FormatTraceEventsOptions = {},
): string {
  const includeRaw = options.includeRaw ?? true;
  return formatHarnessMessages(
    events
      .map((event) => toTraceEvent(event, harness))
      .map((event) =>
        event && options.compact ? compactTraceMessage(event, { includeRaw }) : event,
      )
      .filter((event): event is HarnessMessage => Boolean(event)),
  );
}

export function toTraceEvent(event: unknown, harness?: AiHarness): HarnessMessage | undefined {
  const message = normalizeTraceEvent(event, harness);

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

function compactTraceMessage(
  event: HarnessMessage,
  options: Required<Pick<FormatTraceEventsOptions, "includeRaw">>,
): HarnessMessage {
  return compactTraceValue(event, 0, options) as HarnessMessage;
}

function compactTraceValue(
  value: unknown,
  depth: number,
  options: Required<Pick<FormatTraceEventsOptions, "includeRaw">>,
): unknown {
  if (typeof value === "string") {
    return truncateTraceString(value);
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  if (depth >= MAX_TRACE_DEPTH) {
    return "[truncated: nested value]";
  }

  if (Array.isArray(value)) {
    const compacted = value
      .slice(0, MAX_TRACE_ARRAY_LENGTH)
      .map((item) => compactTraceValue(item, depth + 1, options));

    if (value.length > MAX_TRACE_ARRAY_LENGTH) {
      compacted.push(`[truncated: ${value.length - MAX_TRACE_ARRAY_LENGTH} more items]`);
    }

    return compacted;
  }

  const entries = Object.entries(value).filter(([key]) => options.includeRaw || key !== "raw");
  const compacted = Object.fromEntries(
    entries
      .slice(0, MAX_TRACE_OBJECT_KEYS)
      .map(([key, item]) => [key, compactTraceValue(item, depth + 1, options)]),
  );

  if (entries.length > MAX_TRACE_OBJECT_KEYS) {
    compacted.__truncated__ = `${entries.length - MAX_TRACE_OBJECT_KEYS} more fields`;
  }

  return compacted;
}

function truncateTraceString(value: string): string {
  if (value.length <= MAX_TRACE_STRING_LENGTH) {
    return value;
  }

  return `${value.slice(0, MAX_TRACE_STRING_LENGTH)}\n[truncated: ${
    value.length - MAX_TRACE_STRING_LENGTH
  } more characters]`;
}

function normalizeTraceEvent(event: unknown, harness?: AiHarness): HarnessMessage {
  if (harness === "traex" && event && typeof event === "object") {
    const eventType = getStringProperty(event, "type");

    if (eventType === "text_delta") {
      return {
        type: "assistant_message",
        text: getTextFields(event, ["text", "delta"]).join(""),
        raw: event,
      };
    }

    if (eventType === "event_msg" && "payload" in event) {
      const payload = event.payload;

      if (
        payload &&
        typeof payload === "object" &&
        getStringProperty(payload, "type") === "agent_message_delta"
      ) {
        return {
          type: "assistant_message",
          text: getTextFields(payload, ["text", "delta", "message"]).join(""),
          raw: event,
        };
      }
    }
  }

  return normalizeHarnessEvent(event, harness);
}
