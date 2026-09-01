import type {
  ChatSession,
  ChatSessionIndexEntry,
  ChatSessionListItem,
  ChatSessionView,
} from "../../types.js";

export type SessionViewOptions = {
  gitBranch?: string;
  runningRunId?: string;
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
    rounds: roundSummaries,
    queuedPrompts,
    currentRound: getCurrentRound(session),
    ...(options.gitBranch ? { gitBranch: options.gitBranch } : {}),
    isRunning: Boolean(options.runningRunId),
    ...(options.runningRunId ? { runningRunId: options.runningRunId } : {}),
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
