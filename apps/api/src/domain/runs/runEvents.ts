import type { ChatSessionView } from "../../types.js";

export type RunStreamEvent =
  | {
      type: "run.output.delta";
      text: string;
    }
  | {
      type: "run.trace";
      event: unknown;
    }
  | {
      type: "session.updated";
      session: ChatSessionView;
    }
  | {
      type: "run.succeeded";
      session: ChatSessionView;
    }
  | {
      type: "run.failed";
      error: string;
    }
  | {
      type: "run.cancelled";
    };

const MAX_STREAM_STRING_LENGTH = 256 * 1024;
const MAX_STREAM_ARRAY_LENGTH = 100;
const MAX_STREAM_OBJECT_KEYS = 100;
const MAX_STREAM_DEPTH = 8;

export function compactRunStreamEvent(event: RunStreamEvent): RunStreamEvent {
  if (event.type === "run.trace") {
    return {
      ...event,
      event: compactStreamValue(event.event, 0),
    };
  }

  if (event.type === "session.updated" || event.type === "run.succeeded") {
    return {
      ...event,
      session: {
        ...event.session,
        messages: event.session.messages.map((message) =>
          message.kind === "trace" && message.content.length > MAX_STREAM_STRING_LENGTH
            ? { ...message, content: truncateStreamString(message.content) }
            : message,
        ),
      },
    };
  }

  if (event.type === "run.output.delta" && event.text.length > MAX_STREAM_STRING_LENGTH) {
    return {
      ...event,
      text: truncateStreamString(event.text),
    };
  }

  return event;
}

function compactStreamValue(value: unknown, depth: number): unknown {
  if (typeof value === "string") {
    return truncateStreamString(value);
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  if (depth >= MAX_STREAM_DEPTH) {
    return "[truncated: nested value]";
  }

  if (Array.isArray(value)) {
    const compacted = value
      .slice(0, MAX_STREAM_ARRAY_LENGTH)
      .map((item) => compactStreamValue(item, depth + 1));

    if (value.length > MAX_STREAM_ARRAY_LENGTH) {
      compacted.push(`[truncated: ${value.length - MAX_STREAM_ARRAY_LENGTH} more items]`);
    }

    return compacted;
  }

  const entries = Object.entries(value).filter(([key]) => key !== "raw");
  const compacted = Object.fromEntries(
    entries
      .slice(0, MAX_STREAM_OBJECT_KEYS)
      .map(([key, item]) => [key, compactStreamValue(item, depth + 1)]),
  );

  if (entries.length > MAX_STREAM_OBJECT_KEYS) {
    compacted.__truncated__ = `${entries.length - MAX_STREAM_OBJECT_KEYS} more fields`;
  }

  return compacted;
}

function truncateStreamString(value: string): string {
  if (value.length <= MAX_STREAM_STRING_LENGTH) {
    return value;
  }

  return `${value.slice(0, MAX_STREAM_STRING_LENGTH)}\n[truncated: ${
    value.length - MAX_STREAM_STRING_LENGTH
  } more characters]`;
}
