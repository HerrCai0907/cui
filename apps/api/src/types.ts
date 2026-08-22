export type ChatRole = 'assistant' | 'user';

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
};

export type ChatSession = {
  id: string;
  workspace: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
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
  rawEvents: unknown[];
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
  result: Promise<AiResponse>;
};

export interface AiModel {
  createSession(input: AiCreateSessionInput): Promise<AiResponse>;
  continueSession(input: AiContinueSessionInput): Promise<AiResponse>;
  createSessionStream(input: AiCreateSessionInput, onEvent: (event: AiRunEvent) => void): AiRun;
  continueSessionStream(input: AiContinueSessionInput, onEvent: (event: AiRunEvent) => void): AiRun;
}
