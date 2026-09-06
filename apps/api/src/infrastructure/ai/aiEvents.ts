import { getStringProperty, getTextFields } from "./jsonFields.js";

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

export function extractResponseDeltas(event: unknown): string[] {
  if (!event || typeof event !== "object") {
    return [];
  }

  const type = getStringProperty(event, "type");

  // Codex exec emits complete message items, not token deltas. Only consume
  // completed items so started/updated snapshots cannot duplicate the text.
  if (type === "item.completed" && "item" in event) {
    const item = event.item;

    if (item && typeof item === "object" && getStringProperty(item, "type") === "agent_message") {
      return getTextFields(item, ["text"]).map((text) => `${text}\n\n`);
    }
  }

  if (type === "text_delta") {
    return getTextFields(event, ["text", "delta"]);
  }

  if (type === "event_msg") {
    const payload = "payload" in event ? event.payload : undefined;

    if (payload && typeof payload === "object") {
      const payloadType = getStringProperty(payload, "type");

      if (payloadType === "agent_message") {
        return getTextFields(payload, ["message"]).map((text) => `${text}\n\n`);
      }

      if (payloadType === "agent_message_delta") {
        return getTextFields(payload, ["text", "delta", "message"]);
      }
    }
  }

  return [];
}

export function formatRawEvents(events: unknown[]): string {
  return events.map((event) => JSON.stringify(event)).join("\n");
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
