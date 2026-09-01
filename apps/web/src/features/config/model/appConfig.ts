import type { ExecutionTraceEvent, ExecutionTraceItem } from "../../../types";
import { getDefaultApiBaseUrl } from "../../../shared/api/apiBaseUrl";

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

export const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh"] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export type ReasoningEffortPreferences = Record<ModelPurpose, ReasoningEffort>;

export type ModelRequestPreferences = Partial<Record<ModelPurpose, string>> & {
  reasoningEfforts?: Partial<Record<ModelPurpose, ReasoningEffort>>;
};

export type ModelOption = {
  name: string;
  provider?: string;
  description?: string;
  contextWindow?: number;
};

export type SshTunnelConfig = {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  password: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
};

export type AppConfig = {
  apiBaseUrl: string;
  sshTunnel: SshTunnelConfig;
  models: ModelPreferences;
  reasoningEfforts: ReasoningEffortPreferences;
  executionTrace: {
    visibleMessageTypes: Record<ExecutionTraceMessageType, boolean>;
  };
};

type StoredAppConfig = {
  version: 1;
  sshTunnel?: Partial<SshTunnelConfig>;
  models?: Partial<Record<ModelPurpose, string>>;
  reasoningEfforts?: Partial<Record<ModelPurpose, ReasoningEffort>>;
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

export const REASONING_EFFORT_LABELS: Record<ReasoningEffort, string> = {
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "XHigh",
};

export const DEFAULT_SSH_TUNNEL_CONFIG: SshTunnelConfig = {
  enabled: false,
  host: "",
  port: 0,
  username: "",
  password: "",
  localPort: 0,
  remoteHost: "",
  remotePort: 0,
};

export function createDefaultSshTunnelConfig(): SshTunnelConfig {
  return { ...DEFAULT_SSH_TUNNEL_CONFIG };
}

export function createDefaultAppConfig(): AppConfig {
  return {
    apiBaseUrl: getDefaultApiBaseUrl(),
    sshTunnel: createDefaultSshTunnelConfig(),
    models: {
      normal: "",
      summary: "",
      atomicReview: "",
    },
    reasoningEfforts: {
      normal: "high",
      summary: "low",
      atomicReview: "medium",
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
      apiBaseUrl: getDefaultApiBaseUrl(),
      sshTunnel: parseSshTunnelConfig(parsed.sshTunnel),
      models: {
        ...defaultConfig.models,
        ...parseModelPreferences(parsed.models),
      },
      reasoningEfforts: {
        ...defaultConfig.reasoningEfforts,
        ...parseReasoningEffortPreferences(parsed.reasoningEfforts),
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
      sshTunnel: sanitizeSshTunnelConfig(config.sshTunnel),
      models: sanitizeModelPreferences(config.models),
      reasoningEfforts: sanitizeReasoningEffortPreferences(config.reasoningEfforts),
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

function parseSshTunnelConfig(value: unknown): SshTunnelConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return createDefaultSshTunnelConfig();
  }

  const config = value as Partial<SshTunnelConfig>;

  return sanitizeSshTunnelConfig({
    enabled:
      typeof config.enabled === "boolean" ? config.enabled : DEFAULT_SSH_TUNNEL_CONFIG.enabled,
    host: typeof config.host === "string" ? config.host : DEFAULT_SSH_TUNNEL_CONFIG.host,
    port: config.port,
    username:
      typeof config.username === "string" ? config.username : DEFAULT_SSH_TUNNEL_CONFIG.username,
    password:
      typeof config.password === "string" ? config.password : DEFAULT_SSH_TUNNEL_CONFIG.password,
    localPort: config.localPort,
    remoteHost:
      typeof config.remoteHost === "string"
        ? config.remoteHost
        : DEFAULT_SSH_TUNNEL_CONFIG.remoteHost,
    remotePort: config.remotePort,
  });
}

function sanitizeSshTunnelConfig(config: Partial<SshTunnelConfig>): SshTunnelConfig {
  return {
    enabled: config.enabled ?? DEFAULT_SSH_TUNNEL_CONFIG.enabled,
    host: sanitizeNonEmptyString(config.host, DEFAULT_SSH_TUNNEL_CONFIG.host),
    port: sanitizePort(config.port, DEFAULT_SSH_TUNNEL_CONFIG.port),
    username: typeof config.username === "string" ? config.username.trim() : "",
    password: typeof config.password === "string" ? config.password : "",
    localPort: sanitizePort(config.localPort, DEFAULT_SSH_TUNNEL_CONFIG.localPort),
    remoteHost: sanitizeNonEmptyString(config.remoteHost, DEFAULT_SSH_TUNNEL_CONFIG.remoteHost),
    remotePort: sanitizePort(config.remotePort, DEFAULT_SSH_TUNNEL_CONFIG.remotePort),
  };
}

function sanitizeNonEmptyString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function sanitizePort(value: unknown, fallback: number): number {
  if (value === 0 && fallback === 0) {
    return 0;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 65535) {
    return fallback;
  }

  return value;
}

export function createModelRequestPreferences(
  models: ModelPreferences,
  reasoningEfforts: ReasoningEffortPreferences,
): ModelRequestPreferences | undefined {
  const preferences: ModelRequestPreferences = sanitizeModelPreferences(models);
  const sanitizedReasoningEfforts = sanitizeReasoningEffortPreferences(reasoningEfforts);

  if (Object.keys(sanitizedReasoningEfforts).length > 0) {
    preferences.reasoningEfforts = sanitizedReasoningEfforts;
  }

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

function parseReasoningEffortPreferences(
  value: unknown,
): Partial<Record<ModelPurpose, ReasoningEffort>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return sanitizeReasoningEffortPreferences(value as Partial<Record<ModelPurpose, unknown>>);
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

function sanitizeReasoningEffortPreferences(
  reasoningEfforts: Partial<Record<ModelPurpose, unknown>>,
): Partial<Record<ModelPurpose, ReasoningEffort>> {
  return MODEL_PURPOSES.reduce<Partial<Record<ModelPurpose, ReasoningEffort>>>(
    (preferences, purpose) => {
      const reasoningEffort = reasoningEfforts[purpose];

      if (isReasoningEffort(reasoningEffort)) {
        preferences[purpose] = reasoningEffort;
      }

      return preferences;
    },
    {},
  );
}

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === "string" && REASONING_EFFORTS.includes(value as ReasoningEffort);
}

function isFileChangeItem(type: string | undefined): boolean {
  return Boolean(type && /^file[._-]?change$/i.test(type));
}
