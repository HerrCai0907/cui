import type {
  ExecutionTraceEvent,
  ExecutionTraceItem,
  LegacyEventMessage,
  TodoListTraceItemEntry,
  TokenUsage,
} from "../../../types";

export function parseExecutionTrace(content: string): ExecutionTraceEvent[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseTraceLine);
}

export function encodeExecutionTraceEvent(event: unknown): string | undefined {
  try {
    return JSON.stringify(event);
  } catch {
    return undefined;
  }
}

export function formatExecutionTraceSummary(events: ExecutionTraceEvent[]): string {
  if (events.length === 0) {
    return "No trace output";
  }

  const commandCount = events.filter(
    (event) => event.type === "item.completed" && event.item.type === "command_execution",
  ).length;
  const messageCount = events.filter(
    (event) => event.type === "item.completed" && event.item.type === "agent_message",
  ).length;

  const parts = [`${events.length} ${events.length === 1 ? "event" : "events"}`];

  if (commandCount > 0) {
    parts.push(`${commandCount} ${commandCount === 1 ? "command" : "commands"}`);
  }

  if (messageCount > 0) {
    parts.push(`${messageCount} ${messageCount === 1 ? "message" : "messages"}`);
  }

  return parts.join(" / ");
}

function parseTraceLine(line: string): ExecutionTraceEvent {
  try {
    return normalizeTraceEvent(JSON.parse(line));
  } catch {
    return {
      type: "stdout",
      text: line,
    };
  }
}

function normalizeTraceEvent(raw: unknown): ExecutionTraceEvent {
  if (!isRecord(raw)) {
    return { type: "unknown", raw };
  }

  const type = getString(raw, "type");

  if (isUnifiedHarnessMessageType(type)) {
    return normalizeUnifiedHarnessMessage(raw, type);
  }

  if (type === "thread.started") {
    return {
      type,
      thread_id: getString(raw, "thread_id") ?? "",
    };
  }

  if (type === "turn.started") {
    return { type };
  }

  if (type === "turn.completed") {
    const usage = raw.usage;

    return {
      type,
      ...(isRecord(usage) ? { usage: usage as TokenUsage } : {}),
    };
  }

  if (type === "item.started" || type === "item.updated" || type === "item.completed") {
    return {
      type,
      item: normalizeTraceItem(raw.item),
    };
  }

  if (type === "session_meta" || type === "response_item") {
    const payload = raw.payload;

    return {
      type,
      payload: isRecord(payload) ? payload : {},
    };
  }

  if (type === "event_msg") {
    const payload = raw.payload;

    return {
      type,
      payload: isRecord(payload) ? (payload as LegacyEventMessage) : {},
    };
  }

  if (type === "text_delta") {
    return {
      type,
      text: getString(raw, "text"),
      delta: getString(raw, "delta"),
    };
  }

  if (type === "stdout") {
    return {
      type,
      text: getString(raw, "text") ?? "",
    };
  }

  return { type: "unknown", raw };
}

function normalizeUnifiedHarnessMessage(
  raw: Record<string, unknown>,
  type: UnifiedHarnessMessageType,
): ExecutionTraceEvent {
  if (type === "command_execution") {
    return {
      type: phaseToTraceEventType(getString(raw, "phase")),
      item: {
        id: getString(raw, "id") ?? "",
        type,
        command: getString(raw, "command"),
        aggregated_output: getString(raw, "aggregatedOutput"),
        exit_code: getNumberOrNull(raw, "exitCode"),
        status: getString(raw, "status"),
      },
    };
  }

  if (type === "assistant_message") {
    return {
      type: "item.completed",
      item: {
        id: getString(raw, "id") ?? "",
        type: "agent_message",
        text: getString(raw, "text"),
      },
    };
  }

  if (type === "reasoning") {
    return {
      type: phaseToTraceEventType(getString(raw, "phase")),
      item: {
        id: getString(raw, "id") ?? "",
        type,
        text: getString(raw, "text"),
      },
    };
  }

  if (type === "todo_list") {
    return {
      type: phaseToTraceEventType(getString(raw, "phase")),
      item: {
        id: getString(raw, "id") ?? "",
        type,
        items: normalizeTodoListItems(raw.items),
      },
    };
  }

  if (type === "file_change") {
    return {
      type: phaseToTraceEventType(getString(raw, "phase")),
      item: {
        id: getString(raw, "id") ?? "",
        type: "unknown",
        originalType: type,
        paths: stringArrayValue(raw.paths),
      },
    };
  }

  if (type === "lifecycle") {
    const name = getString(raw, "name") ?? "lifecycle";

    if (name === "thread.started") {
      return {
        type: name,
        thread_id: getString(raw, "threadId") ?? "",
      };
    }

    if (name === "turn.started") {
      return { type: name };
    }

    if (name === "turn.completed") {
      const usage = raw.usage;

      return {
        type: name,
        ...(isRecord(usage) ? { usage: usage as TokenUsage } : {}),
      };
    }

    return {
      type,
      name,
      threadId: getString(raw, "threadId"),
      ...(isRecord(raw.usage) ? { usage: raw.usage as TokenUsage } : {}),
    };
  }

  if (type === "metadata") {
    const payload = raw.payload;

    return {
      type: "response_item",
      payload: isRecord(payload) ? payload : raw,
    };
  }

  if (type === "stdout") {
    return {
      type,
      text: getString(raw, "text") ?? "",
    };
  }

  return { type: "unknown", raw };
}

function normalizeTraceItem(raw: unknown): ExecutionTraceItem {
  if (!isRecord(raw)) {
    return {
      id: "",
      type: "unknown",
      raw,
    };
  }

  const type = getString(raw, "type") ?? "unknown";
  const id = getString(raw, "id") ?? "";

  if (type === "reasoning") {
    return {
      id,
      type,
      text: getString(raw, "text"),
    };
  }

  if (type === "agent_message") {
    return {
      id,
      type,
      text: getString(raw, "text"),
    };
  }

  if (type === "command_execution") {
    return {
      id,
      type,
      command: getString(raw, "command"),
      aggregated_output: getString(raw, "aggregated_output"),
      exit_code: getNumberOrNull(raw, "exit_code"),
      status: getString(raw, "status"),
    };
  }

  if (type === "todo_list") {
    return {
      id,
      type,
      items: normalizeTodoListItems(raw.items),
    };
  }

  return {
    ...raw,
    id,
    type: "unknown",
    originalType: type,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeTodoListItems(value: unknown): TodoListTraceItemEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isRecord)
    .map((item) => ({
      text: getString(item, "text") ?? "",
      completed: getBoolean(item, "completed") ?? false,
    }))
    .filter((item) => item.text);
}

function getString(value: Record<string, unknown>, key: string): string | undefined {
  const property = value[key];

  return typeof property === "string" ? property : undefined;
}

function getBoolean(value: Record<string, unknown>, key: string): boolean | undefined {
  const property = value[key];

  return typeof property === "boolean" ? property : undefined;
}

function getNumberOrNull(value: Record<string, unknown>, key: string): number | null | undefined {
  const property = value[key];

  if (property === null) {
    return null;
  }

  return typeof property === "number" ? property : undefined;
}

type UnifiedHarnessMessageType =
  | "assistant_message"
  | "command_execution"
  | "reasoning"
  | "todo_list"
  | "file_change"
  | "lifecycle"
  | "metadata"
  | "stdout"
  | "unknown";

function isUnifiedHarnessMessageType(type: string | undefined): type is UnifiedHarnessMessageType {
  return (
    type === "assistant_message" ||
    type === "command_execution" ||
    type === "reasoning" ||
    type === "todo_list" ||
    type === "file_change" ||
    type === "lifecycle" ||
    type === "metadata" ||
    type === "stdout" ||
    type === "unknown"
  );
}

function phaseToTraceEventType(
  phase: string | undefined,
): "item.started" | "item.updated" | "item.completed" {
  if (phase === "started") {
    return "item.started";
  }

  if (phase === "updated") {
    return "item.updated";
  }

  return "item.completed";
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
