export const TRACE_MESSAGE_TYPES = [
  "assistant_message",
  "command_execution",
  "reasoning",
  "file_change",
  "todo_list",
  "lifecycle",
  "metadata",
  "stdout",
  "unknown",
] as const;

export type TraceMessageType = (typeof TRACE_MESSAGE_TYPES)[number];

export function isTraceMessageType(value: string): value is TraceMessageType {
  return TRACE_MESSAGE_TYPES.includes(value as TraceMessageType);
}

export function filterTraceContent(content: string, visibleTypes: Set<TraceMessageType>): string {
  if (visibleTypes.size === 0) {
    return "";
  }

  return content
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();

      if (!trimmed) {
        return false;
      }

      return visibleTypes.has(getTraceLineMessageType(trimmed));
    })
    .join("\n");
}

export function isTraceEventVisible(event: unknown, visibleTypes: Set<TraceMessageType>): boolean {
  return visibleTypes.has(getTraceEventMessageType(event));
}

function getTraceLineMessageType(line: string): TraceMessageType {
  try {
    return getTraceEventMessageType(JSON.parse(line));
  } catch {
    return "stdout";
  }
}

function getTraceEventMessageType(event: unknown): TraceMessageType {
  if (!isRecord(event)) {
    return "unknown";
  }

  const type = getString(event, "type");

  if (type === "item.started" || type === "item.updated" || type === "item.completed") {
    return getTraceItemMessageType(event.item);
  }

  if (type === "thread.started" || type === "turn.started" || type === "turn.completed") {
    return "lifecycle";
  }

  if (type === "session_meta" || type === "response_item" || type === "event_msg") {
    return "metadata";
  }

  if (type === "text_delta") {
    return "assistant_message";
  }

  if (type === "stdout") {
    return "stdout";
  }

  return "unknown";
}

function getTraceItemMessageType(item: unknown): TraceMessageType {
  if (!isRecord(item)) {
    return "unknown";
  }

  const type = getString(item, "type");

  if (type === "agent_message") {
    return "assistant_message";
  }

  if (type === "command_execution") {
    return "command_execution";
  }

  if (type === "reasoning") {
    return "reasoning";
  }

  if (type === "todo_list") {
    return "todo_list";
  }

  if (isFileChangeItem(type)) {
    return "file_change";
  }

  return "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getString(value: Record<string, unknown>, key: string): string | undefined {
  const property = value[key];

  return typeof property === "string" ? property : undefined;
}

function isFileChangeItem(type: string | undefined): boolean {
  return Boolean(type && /^file[._-]?change$/i.test(type));
}
