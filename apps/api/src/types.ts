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
  isRunning: boolean;
  runningTurnId?: string;
};

export type AiCreateSessionInput = {
  workspace: string;
  prompt: string;
};

export type AiContinueSessionInput = {
  sessionId: string;
  workspace: string;
  prompt: string;
};

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
