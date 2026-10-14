import type {
  AtomicDiffReview,
  ChatMessage,
  ChatRound,
  ChatSession,
  ChatSessionIndexEntry,
  QueuedPrompt,
  SessionListPage,
} from "../../types.js";
import type { RunStreamEvent } from "../../domain/runs/runEvents.js";

export type ListSessionIndexEntriesOptions = {
  page?: number;
  pageSize?: number;
};

export type StoredRunStreamEvent = {
  id: number;
  event: RunStreamEvent;
};

export type PersistedRunStreamEvent = StoredRunStreamEvent & {
  runId: string;
  sessionId: string;
  createdAt: string;
};

export type ListRunEventsOptions = {
  afterSeq?: number;
  limit?: number;
};

export interface SessionStore {
  listSessions(): Promise<ChatSession[]>;
  listQueuedSessionIds(): Promise<string[]>;
  hasQueuedPrompt(queuedPromptId: string): Promise<boolean>;
  hasRunEvents(runId: string): Promise<boolean>;
  appendRunEvents(events: PersistedRunStreamEvent[]): Promise<void>;
  listRunEvents(runId: string, options?: ListRunEventsOptions): Promise<PersistedRunStreamEvent[]>;
  listSessionIndexEntries(
    options?: ListSessionIndexEntriesOptions,
  ): Promise<SessionListPage<ChatSessionIndexEntry>>;
  getSession(sessionId: string): Promise<ChatSession | undefined>;
  createSession(session: ChatSession): Promise<ChatSession>;
  appendMessages(sessionId: string, messages: ChatMessage[]): Promise<ChatSession>;
  enqueuePrompt(sessionId: string, prompt: QueuedPrompt): Promise<ChatSession>;
  shiftQueuedPrompt(sessionId: string): Promise<QueuedPrompt | undefined>;
  truncateQueuedPromptsFrom(
    sessionId: string,
    queuedPromptId: string,
  ): Promise<{ session: ChatSession; removedPrompts: QueuedPrompt[] } | undefined>;
  appendRoundAndMessages(
    sessionId: string,
    round: ChatRound | undefined,
    messages: ChatMessage[],
  ): Promise<ChatSession>;
  updateSessionAiThreadId(
    sessionId: string,
    aiThreadId: string,
    aiHarness: ChatSession["aiHarness"],
  ): Promise<ChatSession>;
  getRound(sessionId: string, roundNumber: number): Promise<ChatRound | undefined>;
  updateRoundAtomicReview(
    sessionId: string,
    roundNumber: number,
    atomicReview: AtomicDiffReview,
  ): Promise<ChatRound>;
  updateSessionSummary(
    sessionId: string,
    summary: Pick<ChatSession, "title" | "summary">,
  ): Promise<ChatSession>;
  updateSessionModels(
    sessionId: string,
    models: ChatSession["models"] | undefined,
  ): Promise<ChatSession>;
  updateSessionDoneAt(sessionId: string, doneAt: string | undefined): Promise<ChatSession>;
  deleteExpiredSessions(cutoffIso: string): Promise<number>;
  getArtifactDirectoryPath(): string;
}
