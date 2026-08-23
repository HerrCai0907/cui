export type ApiMessage = {
  id: string;
  role: "assistant" | "user";
  kind?: "response" | "trace";
  round?: number;
  content: string;
  createdAt: string;
};

export type ApiRound = {
  round: number;
  baseCommit?: string;
  beforeDiff: string;
  afterDiff: string;
  diff: string;
  hasChanges: boolean;
  createdAt: string;
  atomicReview?: ApiAtomicDiffReview;
};

export type ApiRoundSummary = Pick<ApiRound, "round" | "hasChanges" | "createdAt"> & {
  atomicReviewStatus?: ApiAtomicDiffReview["status"];
};

export type ApiSession = {
  id: string;
  workspace: string;
  title: string;
  summary?: string;
  doneAt?: string;
  createdAt: string;
  updatedAt: string;
  messages: ApiMessage[];
  rounds?: ApiRoundSummary[];
  currentRound: number;
  isRunning: boolean;
  runningTurnId?: string;
};

export type ApiAtomicCapabilityType = 0 | 1 | 2 | 3 | 5;

export type ApiAtomicDiffReviewItem = {
  id: string;
  order: number;
  capabilityType: ApiAtomicCapabilityType;
  capabilityLabel: string;
  title: string;
  intent: string;
  files: string[];
  diff: string;
  outputJson: Record<string, unknown>;
};

export type ApiAtomicDiffReview =
  | {
      status: "ready";
      generatedAt: string;
      analysisSessionId: string;
      items: ApiAtomicDiffReviewItem[];
      rawResponse: string;
    }
  | {
      status: "failed";
      generatedAt: string;
      error: string;
      rawResponse?: string;
    };

export type SessionSummary = {
  id: string;
  workspace: string;
  title: string;
  summary?: string;
  doneAt?: string;
  createdAt: string;
  updatedAt: string;
  currentRound: number;
  isRunning: boolean;
  hasUnreadRound: boolean;
};

export type SubmittedTurn = {
  status: "ok";
  session: ApiSession;
  turnId: string;
};

export type TurnStreamEvent =
  | {
      type: "delta";
      text: string;
    }
  | {
      type: "raw";
      event: unknown;
    }
  | {
      type: "session.updated";
      session: ApiSession;
    }
  | {
      type: "done";
      session: ApiSession;
    }
  | {
      type: "failed";
      error: string;
    }
  | {
      type: "cancelled";
    };

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
