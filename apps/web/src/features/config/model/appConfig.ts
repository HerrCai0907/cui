import type { ExecutionTraceEvent, ExecutionTraceItem } from "../../../types";

export const APP_CONFIG_STORAGE_KEY = "cui:app-config:v1";

export const EXECUTION_TRACE_MESSAGE_TYPES = [
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

export type ExecutionTraceMessageType = (typeof EXECUTION_TRACE_MESSAGE_TYPES)[number];

export const MODEL_PURPOSES = ["normal", "summary", "atomicReview"] as const;

export type ModelPurpose = (typeof MODEL_PURPOSES)[number];

export type ModelPreferences = Record<ModelPurpose, string>;

export type ModelOption = {
  name: string;
  provider?: string;
  description?: string;
  contextWindow?: number;
};

export type AppConfig = {
  models: ModelPreferences;
  executionTrace: {
    visibleMessageTypes: Record<ExecutionTraceMessageType, boolean>;
  };
};

type StoredAppConfig = {
  version: 1;
  models?: Partial<Record<ModelPurpose, string>>;
  executionTrace?: {
    visibleMessageTypes?: Partial<Record<ExecutionTraceMessageType, boolean>>;
  };
  updatedAt?: number;
};

export const EXECUTION_TRACE_MESSAGE_TYPE_LABELS: Record<ExecutionTraceMessageType, string> = {
  assistant_message: "Assistant Message",
  command_execution: "Command Execution",
  reasoning: "Reasoning",
  file_change: "File Change",
  todo_list: "Todo List",
  lifecycle: "Lifecycle",
  metadata: "Metadata",
  stdout: "Stdout",
  unknown: "Unknown",
};

export const MODEL_PURPOSE_LABELS: Record<ModelPurpose, string> = {
  normal: "Normal",
  summary: "Summary",
  atomicReview: "Atomic Review",
};

export function createDefaultAppConfig(): AppConfig {
  return {
    models: {
      normal: "",
      summary: "",
      atomicReview: "",
    },
    executionTrace: {
      visibleMessageTypes: Object.fromEntries(
        EXECUTION_TRACE_MESSAGE_TYPES.map((type) => [type, type === "assistant_message"]),
      ) as Record<ExecutionTraceMessageType, boolean>,
    },
  };
}

export function loadAppConfig(): AppConfig {
  const defaultConfig = createDefaultAppConfig();

  if (typeof window === "undefined") {
    return defaultConfig;
  }

  try {
    const rawConfig = window.localStorage.getItem(APP_CONFIG_STORAGE_KEY);

    if (!rawConfig) {
      return defaultConfig;
    }

    const parsed = JSON.parse(rawConfig) as Partial<StoredAppConfig>;

    if (parsed.version !== 1) {
      window.localStorage.removeItem(APP_CONFIG_STORAGE_KEY);
      return defaultConfig;
    }

    return {
      models: {
        ...defaultConfig.models,
        ...parseModelPreferences(parsed.models),
      },
      executionTrace: {
        visibleMessageTypes: {
          ...defaultConfig.executionTrace.visibleMessageTypes,
          ...parseVisibleTraceMessageTypes(parsed.executionTrace?.visibleMessageTypes),
        },
      },
    };
  } catch {
    window.localStorage.removeItem(APP_CONFIG_STORAGE_KEY);
    return defaultConfig;
  }
}

export function saveAppConfig(config: AppConfig): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const storedConfig: StoredAppConfig = {
      version: 1,
      models: sanitizeModelPreferences(config.models),
      executionTrace: {
        visibleMessageTypes: config.executionTrace.visibleMessageTypes,
      },
      updatedAt: Date.now(),
    };

    window.localStorage.setItem(APP_CONFIG_STORAGE_KEY, JSON.stringify(storedConfig));
  } catch {
    // App config persistence is local browser state only.
  }
}

export function createModelRequestPreferences(
  models: ModelPreferences,
): Partial<Record<ModelPurpose, string>> | undefined {
  const preferences = sanitizeModelPreferences(models);

  return Object.keys(preferences).length > 0 ? preferences : undefined;
}

export function getExecutionTraceMessageType(
  event: ExecutionTraceEvent,
): ExecutionTraceMessageType {
  if (
    event.type === "item.started" ||
    event.type === "item.updated" ||
    event.type === "item.completed"
  ) {
    return getExecutionTraceItemMessageType(event.item);
  }

  if (
    event.type === "thread.started" ||
    event.type === "turn.started" ||
    event.type === "turn.completed"
  ) {
    return "lifecycle";
  }

  if (
    event.type === "session_meta" ||
    event.type === "response_item" ||
    event.type === "event_msg"
  ) {
    return "metadata";
  }

  if (event.type === "text_delta") {
    return "assistant_message";
  }

  if (event.type === "stdout") {
    return "stdout";
  }

  return "unknown";
}

function getExecutionTraceItemMessageType(item: ExecutionTraceItem): ExecutionTraceMessageType {
  if (item.type === "agent_message") {
    return "assistant_message";
  }

  if (item.type === "command_execution") {
    return "command_execution";
  }

  if (item.type === "reasoning") {
    return "reasoning";
  }

  if (item.type === "todo_list") {
    return "todo_list";
  }

  if (item.type === "unknown" && isFileChangeItem(item.originalType)) {
    return "file_change";
  }

  return "unknown";
}

function parseVisibleTraceMessageTypes(
  value: unknown,
): Partial<Record<ExecutionTraceMessageType, boolean>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return EXECUTION_TRACE_MESSAGE_TYPES.reduce<Partial<Record<ExecutionTraceMessageType, boolean>>>(
    (record, type) => {
      const visible = (value as Record<string, unknown>)[type];

      if (typeof visible === "boolean") {
        record[type] = visible;
      }

      return record;
    },
    {},
  );
}

function parseModelPreferences(value: unknown): Partial<Record<ModelPurpose, string>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return sanitizeModelPreferences(value as Partial<Record<ModelPurpose, string>>);
}

function sanitizeModelPreferences(
  models: Partial<Record<ModelPurpose, string>>,
): Partial<Record<ModelPurpose, string>> {
  return MODEL_PURPOSES.reduce<Partial<Record<ModelPurpose, string>>>((preferences, purpose) => {
    const model = models[purpose]?.trim();

    if (model) {
      preferences[purpose] = model;
    }

    return preferences;
  }, {});
}

function isFileChangeItem(type: string | undefined): boolean {
  return Boolean(type && /^file[._-]?change$/i.test(type));
}
