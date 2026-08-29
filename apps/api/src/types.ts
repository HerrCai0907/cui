export type ChatRole = "assistant" | "user";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  kind?: "response" | "trace";
  round?: number;
  content: string;
  createdAt: string;
};

export type ChatRound = {
  round: number;
  baseCommit?: string;
  beforeDiff: string;
  afterDiff: string;
  diff: string;
  hasChanges: boolean;
  createdAt: string;
  atomicReview?: AtomicDiffReview;
};

export type ChatRoundSummary = Pick<ChatRound, "round" | "hasChanges" | "createdAt"> & {
  atomicReviewStatus?: AtomicDiffReview["status"];
};

export type ChatSession = {
  id: string;
  workspace: string;
  title: string;
  summary?: string;
  doneAt?: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  rounds?: ChatRound[];
};

export type ChatSessionView = Omit<ChatSession, "rounds"> & {
  rounds?: ChatRoundSummary[];
  currentRound: number;
  gitBranch?: string;
  isRunning: boolean;
  runningTurnId?: string;
};

export type ChatSessionIndexEntry = Omit<ChatSession, "messages" | "rounds"> & {
  currentRound: number;
};

export type ChatSessionListItem = ChatSessionIndexEntry & {
  gitBranch?: string;
  isRunning: boolean;
  runningTurnId?: string;
};

export type SessionListPagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
};

export type SessionListPage<T> = {
  sessions: T[];
  pagination: SessionListPagination;
};

export type AiCreateSessionInput = {
  workspace: string;
  prompt: string;
  models?: AiModelPreferences;
};

export type AiContinueSessionInput = {
  sessionId: string;
  workspace: string;
  prompt: string;
  models?: AiModelPreferences;
};

export type AiModelPurpose = "normal" | "summary" | "atomicReview";

export type AiModelPreferences = Partial<Record<AiModelPurpose, string>>;

export type AtomicCapabilityType = 0 | 1 | 2 | 3 | 5;

export type AtomicDiffReviewItem = {
  id: string;
  order: number;
  capabilityType: AtomicCapabilityType;
  capabilityLabel: string;
  title: string;
  intent: string;
  files: string[];
  diff: string;
  outputJson: Record<string, unknown>;
};

export type AtomicDiffReview =
  | {
      status: "ready";
      generatedAt: string;
      analysisSessionId: string;
      items: AtomicDiffReviewItem[];
      rawResponse: string;
    }
  | {
      status: "failed";
      generatedAt: string;
      error: string;
      rawResponse?: string;
    };

export type AiAtomicDiffReviewInput = {
  workspace: string;
  originalSessionId: string;
  round: number;
  sessionInput: string;
  executionTrace: string;
  assistantOutput: string;
  diff: string;
  diffFilePath?: string;
  models?: AiModelPreferences;
};

export type AiResponse = {
  sessionId: string;
  content: string;
  trace?: string;
  gitDiff?: {
    baseCommit?: string;
    beforeDiff: string;
    afterDiff: string;
  };
  rawEvents: unknown[];
};

export type AiRunResult = Pick<
  AiResponse,
  "sessionId" | "content" | "trace" | "gitDiff" | "rawEvents"
>;

export type ConversationSummary = {
  title: string;
  progress: string;
};

export type AiModelInfo = {
  name: string;
  provider?: string;
  description?: string;
  contextWindow?: number;
};

export type AiRunEvent =
  | {
      type: "session";
      sessionId: string;
    }
  | {
      type: "delta";
      text: string;
    }
  | {
      type: "raw";
      event: unknown;
    };

export type AiRun = {
  sessionId: Promise<string>;
  result: Promise<AiRunResult>;
  cancel: () => void;
};

export interface AiModel {
  listModels(): Promise<AiModelInfo[]>;
  createSession(input: AiCreateSessionInput): Promise<AiResponse>;
  continueSession(input: AiContinueSessionInput): Promise<AiResponse>;
  createAtomicDiffReview(input: AiAtomicDiffReviewInput): Promise<AtomicDiffReview>;
  summarizeConversation(input: AiCreateSessionInput): Promise<ConversationSummary>;
  createSessionStream(input: AiCreateSessionInput, onEvent: (event: AiRunEvent) => void): AiRun;
  continueSessionStream(input: AiContinueSessionInput, onEvent: (event: AiRunEvent) => void): AiRun;
}

export class AiRunCancelledError extends Error {
  constructor(message = "AI run was cancelled") {
    super(message);
    this.name = "AiRunCancelledError";
  }
}
