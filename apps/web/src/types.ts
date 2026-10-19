export type ApiMessage = {
  id: string;
  role: "assistant" | "user";
  kind?: "response" | "trace";
  round?: number;
  model?: string;
  content: string;
  createdAt: string;
};

export type AiHarness = "traex" | "codex";
export type AiModelPurpose = "normal" | "summary" | "atomicReview";
export type AiReasoningEffort =
  "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";

export type AiModelPreferences = Partial<Record<AiModelPurpose, string>> & {
  harness?: AiHarness;
  reasoningEfforts?: Partial<Record<AiModelPurpose, AiReasoningEffort>>;
};

export type ApiAtomicCapabilityType = 0 | 1 | 2 | 3 | 5;

export type ApiDiffFileSummary = {
  id: string;
  path: string;
  oldPath?: string;
  status: "added" | "modified" | "deleted" | "renamed" | "binary";
  additions: number;
  deletions: number;
  hunkCount: number;
  lineCount: number;
  byteSize: number;
  isLarge: boolean;
  isBinary: boolean;
  metadata: string[];
};

export type ApiDiffSummary = {
  version: 1;
  totalFiles: number;
  totalAdditions: number;
  totalDeletions: number;
  totalLines: number;
  totalBytes: number;
  files: ApiDiffFileSummary[];
  round?: number;
};

export type ApiDiffFilePage = {
  file: ApiDiffFileSummary;
  lines: Array<{
    id: string;
    kind: "add" | "remove" | "context" | "meta" | "ellipsis";
    oldLine?: number;
    newLine?: number;
    content: string;
    canExpandUp?: boolean;
    canExpandDown?: boolean;
    gapKey?: string;
  }>;
  pageInfo: {
    cursor?: string;
    nextCursor?: string;
    returned: number;
    totalVisible: number;
    hasMoreBefore: boolean;
    hasMoreAfter: boolean;
    hasExpandableContext: boolean;
    contextLines: number;
    truncated: boolean;
  };
};

export type ApiAtomicDiffReviewItem = {
  id: string;
  order: number;
  capabilityType: ApiAtomicCapabilityType;
  capabilityLabel: string;
  title: string;
  intent: string;
  files: string[];
  diff?: string;
  diffSummary?: ApiDiffSummary;
  diffRef?: {
    itemId: string;
  };
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

export type ApiRound = {
  round: number;
  baseCommit?: string;
  traceRunId?: string;
  beforeDiff: string;
  afterDiff: string;
  diff: string;
  hasChanges: boolean;
  createdAt: string;
  diffSummary?: ApiDiffSummary & { round: number };
  atomicReview?: ApiAtomicDiffReview;
};

export type ApiRoundReview = Omit<ApiRound, "beforeDiff" | "afterDiff" | "diff" | "atomicReview"> &
  Partial<Pick<ApiRound, "beforeDiff" | "afterDiff" | "diff">> & {
    diffSummary?: ApiDiffSummary & { round: number };
    atomicReview?: ApiAtomicDiffReview;
  };

export type ApiRoundSummary = Pick<ApiRound, "round" | "hasChanges" | "createdAt"> & {
  atomicReviewStatus?: ApiAtomicDiffReview["status"];
};

export type QueuedPromptView = {
  id: string;
  mode: "chat" | "shell";
  prompt: string;
  createdAt: string;
};

export type MessagePageInfo = {
  total: number;
  returned: number;
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
  oldestMessageId?: string;
  newestMessageId?: string;
};

export type ApiSession = {
  id: string;
  origin?: "chat" | "shell";
  aiHarness?: AiHarness;
  models?: AiModelPreferences;
  workspace: string;
  title: string;
  summary?: string;
  doneAt?: string;
  createdAt: string;
  updatedAt: string;
  messages: ApiMessage[];
  rounds?: ApiRoundSummary[];
  queuedPrompts?: QueuedPromptView[];
  currentRound: number;
  gitBranch?: string;
  gitCommitSha?: string;
  isRunning: boolean;
  runningRunId?: string;
  messagePageInfo?: MessagePageInfo;
};

export type ApiSessionListItem = Omit<ApiSession, "messages" | "messagePageInfo" | "rounds">;

export type SessionSummary = {
  id: string;
  workspace: string;
  title: string;
  summary?: string;
  doneAt?: string;
  createdAt: string;
  updatedAt: string;
  currentRound: number;
  models?: ApiSession["models"];
  queuedPrompts?: ApiSession["queuedPrompts"];
  gitBranch?: string;
  gitCommitSha?: string;
  isRunning: boolean;
  hasUnreadRound: boolean;
};

export type SubmittedRun = {
  run: {
    id: string;
    sessionId: string;
    type: "assistant_response" | "shell_command" | "round_review";
    status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
    createdAt?: string;
  };
  session: ApiSession;
};

export type AiModelInfo = {
  name: string;
  provider?: string;
  description?: string;
  contextWindow?: number;
  defaultReasoningEffort?: AiReasoningEffort;
  supportedReasoningEfforts?: AiReasoningEffort[];
};

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
      session: ApiSession;
    }
  | {
      type: "run.succeeded";
      session: ApiSession;
    }
  | {
      type: "run.failed";
      error: string;
    }
  | {
      type: "run.cancelled";
    };

export type ExecutionTraceEvent =
  | ThreadStartedTraceEvent
  | TurnStartedTraceEvent
  | TurnCompletedTraceEvent
  | HarnessLifecycleTraceEvent
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

export type HarnessLifecycleTraceEvent = {
  type: "lifecycle";
  name: string;
  threadId?: string;
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
