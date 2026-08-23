import type { ChatSession, ChatSessionView } from "../../types.js";

export function toSessionView(session: ChatSession, runningTurnId?: string): ChatSessionView {
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
    isRunning: Boolean(runningTurnId),
    ...(runningTurnId ? { runningTurnId } : {}),
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
