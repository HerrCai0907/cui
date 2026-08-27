import type {
  ChatSession,
  ChatSessionIndexEntry,
  ChatSessionListItem,
  ChatSessionView,
} from "../../types.js";

export type SessionViewOptions = {
  gitBranch?: string;
  runningTurnId?: string;
};

export function toSessionView(
  session: ChatSession,
  optionsOrRunningTurnId?: SessionViewOptions | string,
): ChatSessionView {
  const options =
    typeof optionsOrRunningTurnId === "string"
      ? { runningTurnId: optionsOrRunningTurnId }
      : (optionsOrRunningTurnId ?? {});
  const roundSummaries =
    session.rounds?.map(({ round, hasChanges, createdAt, atomicReview }) => ({
      round,
      hasChanges,
      createdAt,
      ...(atomicReview ? { atomicReviewStatus: atomicReview.status } : {}),
    })) ?? [];

  return {
    ...session,
    rounds: roundSummaries,
    currentRound: getCurrentRound(session),
    ...(options.gitBranch ? { gitBranch: options.gitBranch } : {}),
    isRunning: Boolean(options.runningTurnId),
    ...(options.runningTurnId ? { runningTurnId: options.runningTurnId } : {}),
  };
}

export function toSessionListItem(
  session: ChatSessionIndexEntry,
  optionsOrRunningTurnId?: SessionViewOptions | string,
): ChatSessionListItem {
  const options =
    typeof optionsOrRunningTurnId === "string"
      ? { runningTurnId: optionsOrRunningTurnId }
      : (optionsOrRunningTurnId ?? {});

  return {
    ...session,
    ...(options.gitBranch ? { gitBranch: options.gitBranch } : {}),
    isRunning: Boolean(options.runningTurnId),
    ...(options.runningTurnId ? { runningTurnId: options.runningTurnId } : {}),
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
