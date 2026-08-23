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
