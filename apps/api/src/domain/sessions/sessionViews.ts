import type {
  ChatMessage,
  ChatSessionMessagesPage,
  ChatSession,
  ChatSessionIndexEntry,
  ChatSessionListItem,
  ChatSessionView,
} from "../../types.js";

export type SessionViewOptions = {
  gitBranch?: string;
  messages?: SessionMessageWindowOptions;
  runningRunId?: string;
};

export type SessionMessageWindowOptions = {
  beforeMessageId?: string;
  limit?: number;
  window?: "tail";
};

export function toSessionView(
  session: ChatSession,
  optionsOrRunningRunId?: SessionViewOptions | string,
): ChatSessionView {
  const { aiThreadId: _aiThreadId, ...publicSession } = session;
  const options =
    typeof optionsOrRunningRunId === "string"
      ? { runningRunId: optionsOrRunningRunId }
      : (optionsOrRunningRunId ?? {});
  const messagesPage = createSessionMessagesPage(session.messages, options.messages);
  const roundSummaries =
    session.rounds?.map(({ round, hasChanges, createdAt, atomicReview }) => ({
      round,
      hasChanges,
      createdAt,
      ...(atomicReview ? { atomicReviewStatus: atomicReview.status } : {}),
    })) ?? [];
  const queuedPrompts =
    session.queuedPrompts?.map(({ id, mode, prompt, createdAt }) => ({
      id,
      mode,
      prompt,
      createdAt,
    })) ?? [];

  return {
    ...publicSession,
    messages: messagesPage.messages,
    rounds: roundSummaries,
    queuedPrompts,
    currentRound: getCurrentRound(session),
    ...(options.gitBranch ? { gitBranch: options.gitBranch } : {}),
    isRunning: Boolean(options.runningRunId),
    ...(options.runningRunId ? { runningRunId: options.runningRunId } : {}),
    ...(options.messages ? { messagePageInfo: messagesPage.pageInfo } : {}),
  };
}

export function createSessionMessagesPage(
  messages: ChatMessage[],
  options: SessionMessageWindowOptions = {},
): ChatSessionMessagesPage {
  const total = messages.length;
  const limit = normalizeMessageLimit(options.limit, total);
  const beforeIndex = options.beforeMessageId
    ? messages.findIndex((message) => message.id === options.beforeMessageId)
    : -1;
  const endIndex = options.beforeMessageId ? Math.max(0, beforeIndex) : total;
  const startIndex = Math.max(0, endIndex - limit);
  const pageMessages = messages.slice(startIndex, endIndex);
  const oldestMessageId = pageMessages[0]?.id;
  const newestMessageId = pageMessages.at(-1)?.id;

  return {
    messages: pageMessages,
    pageInfo: {
      total,
      returned: pageMessages.length,
      hasMoreBefore: startIndex > 0,
      hasMoreAfter: endIndex < total,
      ...(oldestMessageId ? { oldestMessageId } : {}),
      ...(newestMessageId ? { newestMessageId } : {}),
    },
  };
}

export function toSessionListItem(
  session: ChatSessionIndexEntry,
  optionsOrRunningRunId?: SessionViewOptions | string,
): ChatSessionListItem {
  const options =
    typeof optionsOrRunningRunId === "string"
      ? { runningRunId: optionsOrRunningRunId }
      : (optionsOrRunningRunId ?? {});

  return {
    ...session,
    ...(options.gitBranch ? { gitBranch: options.gitBranch } : {}),
    isRunning: Boolean(options.runningRunId),
    ...(options.runningRunId ? { runningRunId: options.runningRunId } : {}),
  };
}

function getCurrentRound(session: ChatSession): number {
  const storedRound = Math.max(0, ...(session.rounds?.map(({ round }) => round) ?? []));
  const messageRound = Math.max(
    0,
    ...session.messages
      .map(({ round }) => round ?? 0)
      .filter((round) => Number.isInteger(round) && round > 0),
  );
  const completedTurnCount = Math.max(
    countAssistantMessages(session, "trace"),
    countAssistantMessages(session, "response"),
  );

  return Math.max(storedRound, messageRound, completedTurnCount);
}

function countAssistantMessages(session: ChatSession, kind: "response" | "trace"): number {
  return session.messages.filter((message) => message.role === "assistant" && message.kind === kind)
    .length;
}

function normalizeMessageLimit(limit: number | undefined, total: number): number {
  if (limit === undefined) {
    return total;
  }

  return Math.max(0, Math.min(limit, total));
}
