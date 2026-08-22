export type ChatRole = 'assistant' | 'user';

export type ChatMessage = {
  id: string;
  role: ChatRole;
  kind?: 'response' | 'trace';
  round?: number;
  content: string;
  createdAt: string;
};

export type ChatRound = {
  round: number;
  beforeDiff: string;
  afterDiff: string;
  diff: string;
  hasChanges: boolean;
  createdAt: string;
};

export type ChatRoundSummary = Pick<
  ChatRound,
  'round' | 'hasChanges' | 'createdAt'
>;

export type ChatSession = {
  id: string;
  workspace: string;
  title: string;
  summary?: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  rounds?: ChatRound[];
};

export type ChatSessionView = Omit<ChatSession, 'rounds'> & {
  rounds?: ChatRoundSummary[];
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

export type AiResponse = {
  sessionId: string;
  content: string;
  trace?: string;
  gitDiff?: {
    beforeDiff: string;
    afterDiff: string;
  };
  rawEvents: unknown[];
};

export type AiRunResult = Pick<
  AiResponse,
  'sessionId' | 'content' | 'trace' | 'gitDiff' | 'rawEvents'
>;

export type ConversationSummary = {
  title: string;
  progress: string;
};

export type AiRunEvent =
  | {
      type: 'session';
      sessionId: string;
    }
  | {
      type: 'delta';
      text: string;
    }
  | {
      type: 'raw';
      event: unknown;
    };

export type AiRun = {
  sessionId: Promise<string>;
  result: Promise<AiRunResult>;
};

export interface AiModel {
  createSession(input: AiCreateSessionInput): Promise<AiResponse>;
  continueSession(input: AiContinueSessionInput): Promise<AiResponse>;
  summarizeConversation(
    input: AiCreateSessionInput,
  ): Promise<ConversationSummary>;
  createSessionStream(
    input: AiCreateSessionInput,
    onEvent: (event: AiRunEvent) => void,
  ): AiRun;
  continueSessionStream(
    input: AiContinueSessionInput,
    onEvent: (event: AiRunEvent) => void,
  ): AiRun;
}
