import { getStringProperty, getTextFields } from "./jsonFields.js";

export type HarnessMessage =
  | {
      type: "assistant_response";
      text: string;
      final: boolean;
      raw: unknown;
    }
  | {
      type: "command_execution";
      id?: string;
      phase?: HarnessItemPhase;
      command?: string;
      aggregatedOutput?: string;
      exitCode?: number | null;
      status?: string;
      raw: unknown;
    }
  | {
      type: "reasoning";
      id?: string;
      phase?: HarnessItemPhase;
      text?: string;
      raw: unknown;
    }
  | {
      type: "todo_list";
      id?: string;
      phase?: HarnessItemPhase;
      items: HarnessTodoItem[];
      raw: unknown;
    }
  | {
      type: "file_change";
      id?: string;
      phase?: HarnessItemPhase;
      paths: string[];
      raw: unknown;
    }
  | {
      type: "lifecycle";
      name: string;
      threadId?: string;
      usage?: Record<string, unknown>;
      raw: unknown;
    }
  | {
      type: "metadata";
      name: string;
      payload: Record<string, unknown>;
      raw: unknown;
    }
  | {
      type: "stdout";
      text: string;
      raw: unknown;
    }
  | {
      type: "unknown";
      raw: unknown;
    };

export type HarnessItemPhase = "started" | "updated" | "completed";

export type HarnessTodoItem = {
  text: string;
  completed: boolean;
};

export function normalizeHarnessEvent(event: unknown): HarnessMessage {
  if (!isRecord(event)) {
    return { type: "unknown", raw: event };
  }

  const type = getStringProperty(event, "type");

  if (isUnifiedTraceMessageType(type)) {
    return event as HarnessMessage;
  }

  if (type === "item.started" || type === "item.updated" || type === "item.completed") {
    return normalizeHarnessItem(event.item, itemPhase(type), event);
  }

  if (type === "response_item") {
    const payload = event.payload;

    if (isRecord(payload)) {
      return normalizeHarnessPayload(payload, event);
    }

    return {
      type: "metadata",
      name: type,
      payload: {},
      raw: event,
    };
  }

  if (type === "event_msg") {
    const payload = event.payload;

    if (isRecord(payload)) {
      return normalizeHarnessPayload(payload, event);
    }

    return {
      type: "metadata",
      name: type,
      payload: {},
      raw: event,
    };
  }

  if (type === "text_delta") {
    return {
      type: "assistant_response",
      text: getTextFields(event, ["text", "delta"]).join(""),
      final: false,
      raw: event,
    };
  }

  if (type === "thread.started") {
    return {
      type: "lifecycle",
      name: type,
      threadId: getStringProperty(event, "thread_id"),
      raw: event,
    };
  }

  if (type === "turn.started" || type === "turn.completed") {
    const usage = event.usage;

    return {
      type: "lifecycle",
      name: type,
      ...(isRecord(usage) ? { usage } : {}),
      raw: event,
    };
  }

  if (type === "session_meta") {
    const payload = event.payload;

    return {
      type: "metadata",
      name: type,
      payload: isRecord(payload) ? payload : {},
      raw: event,
    };
  }

  if (type === "stdout") {
    return {
      type: "stdout",
      text: getStringProperty(event, "text") ?? "",
      raw: event,
    };
  }

  return { type: "unknown", raw: event };
}

export function isTraceHarnessMessage(message: HarnessMessage): boolean {
  return message.type !== "assistant_response";
}

export function extractAssistantResponseText(message: HarnessMessage): string[] {
  return message.type === "assistant_response" && message.text ? [message.text] : [];
}

export function formatHarnessMessages(messages: HarnessMessage[]): string {
  return messages.map((message) => JSON.stringify(message)).join("\n");
}

function normalizeHarnessPayload(payload: Record<string, unknown>, raw: unknown): HarnessMessage {
  const payloadType = getStringProperty(payload, "type");

  if (payloadType === "agent_message" || payloadType === "agent_message_delta") {
    return {
      type: "assistant_response",
      text: getTextFields(payload, ["text", "delta", "message"]).join(""),
      final: payloadType === "agent_message",
      raw,
    };
  }

  if (payloadType === "reasoning" || payloadType === "reasoning_delta") {
    return {
      type: "reasoning",
      text: getTextFields(payload, ["text", "delta", "message"]).join(""),
      raw,
    };
  }

  if (payloadType === "command_execution") {
    return normalizeCommandExecution(payload, undefined, raw);
  }

  if (payloadType === "todo_list") {
    return normalizeTodoList(payload, undefined, raw);
  }

  if (isFileChangeType(payloadType)) {
    return normalizeFileChange(payload, undefined, raw);
  }

  const assistantText = extractOpenAiAssistantText(payload);
  if (assistantText) {
    return {
      type: "assistant_response",
      text: assistantText,
      final: true,
      raw,
    };
  }

  return {
    type: "metadata",
    name: getStringProperty(payload, "type") ?? "message",
    payload,
    raw,
  };
}

function normalizeHarnessItem(
  item: unknown,
  phase: HarnessItemPhase,
  raw: unknown,
): HarnessMessage {
  if (!isRecord(item)) {
    return { type: "unknown", raw };
  }

  const type = getStringProperty(item, "type");

  if (type === "agent_message") {
    return {
      type: "assistant_response",
      text: getTextFields(item, ["text", "message"]).join(""),
      final: phase === "completed",
      raw,
    };
  }

  if (type === "command_execution") {
    return normalizeCommandExecution(item, phase, raw);
  }

  if (type === "reasoning") {
    return {
      type,
      id: getStringProperty(item, "id"),
      phase,
      text: getTextFields(item, ["text", "summary"]).join(""),
      raw,
    };
  }

  if (type === "todo_list") {
    return normalizeTodoList(item, phase, raw);
  }

  if (isFileChangeType(type)) {
    return normalizeFileChange(item, phase, raw);
  }

  return { type: "unknown", raw };
}

function normalizeCommandExecution(
  item: Record<string, unknown>,
  phase: HarnessItemPhase | undefined,
  raw: unknown,
): HarnessMessage {
  return {
    type: "command_execution",
    id: getStringProperty(item, "id"),
    ...(phase ? { phase } : {}),
    command: getCommandText(item.command),
    aggregatedOutput: getStringProperty(item, "aggregated_output"),
    exitCode: getNumberOrNull(item, "exit_code"),
    status: getStringProperty(item, "status"),
    raw,
  };
}

function normalizeTodoList(
  item: Record<string, unknown>,
  phase: HarnessItemPhase | undefined,
  raw: unknown,
): HarnessMessage {
  return {
    type: "todo_list",
    id: getStringProperty(item, "id"),
    ...(phase ? { phase } : {}),
    items: normalizeTodoItems(item.items),
    raw,
  };
}

function normalizeFileChange(
  item: Record<string, unknown>,
  phase: HarnessItemPhase | undefined,
  raw: unknown,
): HarnessMessage {
  return {
    type: "file_change",
    id: getStringProperty(item, "id"),
    ...(phase ? { phase } : {}),
    paths: getFileChangePaths(item),
    raw,
  };
}

function extractOpenAiAssistantText(payload: Record<string, unknown>): string | undefined {
  const role = getStringProperty(payload, "role");
  const content = payload.content;

  if (role !== "assistant" || !Array.isArray(content)) {
    return undefined;
  }

  const text = content
    .filter(isRecord)
    .flatMap((part) => getTextFields(part, ["text"]))
    .join("");

  return text || undefined;
}

function itemPhase(type: "item.started" | "item.updated" | "item.completed"): HarnessItemPhase {
  if (type === "item.started") {
    return "started";
  }

  if (type === "item.updated") {
    return "updated";
  }

  return "completed";
}

function normalizeTodoItems(value: unknown): HarnessTodoItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isRecord)
    .map((item) => ({
      text: getStringProperty(item, "text") ?? "",
      completed: getBoolean(item, "completed") ?? false,
    }))
    .filter((item) => item.text);
}

function getCommandText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.filter((part): part is string => typeof part === "string").join(" ");
  }

  return undefined;
}

function getFileChangePaths(item: Record<string, unknown>): string[] {
  const changes = item.changes;
  const paths = [
    getStringProperty(item, "path"),
    getStringProperty(item, "file_path"),
    getStringProperty(item, "filePath"),
    ...stringArrayValue(item.files),
    ...Object.keys(isRecord(changes) ? changes : {}),
    ...fileChangeArrayPaths(changes),
  ].filter((path): path is string => Boolean(path));

  return [...new Set(paths)];
}

function fileChangeArrayPaths(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isRecord)
    .map((change) => getStringProperty(change, "path"))
    .filter((path): path is string => Boolean(path));
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function getNumberOrNull(value: Record<string, unknown>, key: string): number | null | undefined {
  const property = value[key];

  if (property === null) {
    return null;
  }

  return typeof property === "number" ? property : undefined;
}

function getBoolean(value: Record<string, unknown>, key: string): boolean | undefined {
  const property = value[key];

  return typeof property === "boolean" ? property : undefined;
}

function isFileChangeType(type: string | undefined): boolean {
  return Boolean(type && /^file[._-]?change$/i.test(type));
}

function isUnifiedTraceMessageType(type: string | undefined): boolean {
  return (
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
