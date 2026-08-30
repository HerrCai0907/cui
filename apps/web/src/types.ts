import type { components } from "./shared/api/generated/schema";

export type ApiMessage = components["schemas"]["ChatMessage"];
export type ApiRound = components["schemas"]["ChatRound"];
export type ApiRoundSummary = components["schemas"]["ChatRoundSummary"];
export type ApiSession = components["schemas"]["ChatSessionView"];
export type ApiSessionListItem = components["schemas"]["ChatSessionListItem"];
export type ApiAtomicCapabilityType = components["schemas"]["ChatRound"]["atomicReview"] extends {
  items: Array<infer Item>;
}
  ? Item extends { capabilityType: infer CapabilityType }
    ? CapabilityType
    : never
  : never;
export type ApiAtomicDiffReview = NonNullable<components["schemas"]["ChatRound"]["atomicReview"]>;
export type ApiAtomicDiffReviewItem = Extract<
  ApiAtomicDiffReview,
  { status: "ready" }
>["items"][number];

export type SessionSummary = {
  id: string;
  workspace: string;
  title: string;
  summary?: string;
  doneAt?: string;
  createdAt: string;
  updatedAt: string;
  currentRound: number;
  queuedPrompts?: ApiSession["queuedPrompts"];
  isRunning: boolean;
  hasUnreadRound: boolean;
};

export type SubmittedTurn = components["schemas"]["SubmittedTurnResponse"];
export type TurnStreamEvent = components["schemas"]["TurnStreamEvent"];

export type ExecutionTraceEvent =
  | ThreadStartedTraceEvent
  | TurnStartedTraceEvent
  | TurnCompletedTraceEvent
  | ItemStartedTraceEvent
  | ItemUpdatedTraceEvent
  | ItemCompletedTraceEvent
  | LegacyTraceEvent
  | UnknownTraceEvent;

export type ThreadStartedTraceEvent = {
  type: "thread.started";
  thread_id: string;
};

export type TurnStartedTraceEvent = {
  type: "turn.started";
};

export type TurnCompletedTraceEvent = {
  type: "turn.completed";
  usage?: TokenUsage;
};

export type ItemStartedTraceEvent = {
  type: "item.started";
  item: ExecutionTraceItem;
};

export type ItemUpdatedTraceEvent = {
  type: "item.updated";
  item: ExecutionTraceItem;
};

export type ItemCompletedTraceEvent = {
  type: "item.completed";
  item: ExecutionTraceItem;
};

export type LegacyTraceEvent =
  | {
      type: "session_meta";
      payload: Record<string, unknown>;
    }
  | {
      type: "event_msg";
      payload: LegacyEventMessage;
    }
  | {
      type: "response_item";
      payload: Record<string, unknown>;
    }
  | {
      type: "text_delta";
      text?: string;
      delta?: string;
    }
  | {
      type: "stdout";
      text: string;
    };

export type UnknownTraceEvent = {
  type: "unknown";
  raw: unknown;
};

export type ExecutionTraceItem =
  | ReasoningTraceItem
  | AgentMessageTraceItem
  | CommandExecutionTraceItem
  | TodoListTraceItem
  | GenericTraceItem;

export type ReasoningTraceItem = {
  id: string;
  type: "reasoning";
  text?: string;
};

export type AgentMessageTraceItem = {
  id: string;
  type: "agent_message";
  text?: string;
};

export type CommandExecutionTraceItem = {
  id: string;
  type: "command_execution";
  command?: string;
  aggregated_output?: string;
  exit_code?: number | null;
  status?: "in_progress" | "completed" | "failed" | "cancelled" | string;
};

export type TodoListTraceItem = {
  id: string;
  type: "todo_list";
  items: TodoListTraceItemEntry[];
};

export type TodoListTraceItemEntry = {
  text: string;
  completed: boolean;
};

export type GenericTraceItem = {
  id: string;
  type: "unknown";
  originalType?: string;
  [key: string]: unknown;
};

export type LegacyEventMessage = {
  type?: string;
  message?: string;
  text?: string;
  delta?: string;
  command?: string | string[];
  aggregated_output?: string;
  exit_code?: number | null;
  status?: string;
  [key: string]: unknown;
};

export type TokenUsage = {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  [key: string]: unknown;
};
