import type { ApiSession, SessionSummary } from '../../../types';
import { getLastSeenRound } from './sessionBrowserState';

export function toSessionSummary(session: ApiSession): SessionSummary {
  const lastSeenRound = getLastSeenRound(session.id);
  const currentRound = getCurrentRound(session);

  return {
    id: session.id,
    workspace: session.workspace,
    title: session.title,
    summary: session.summary,
    updatedAt: session.updatedAt,
    currentRound,
    isRunning: session.isRunning ?? Boolean(session.runningTurnId),
    hasUnreadRound:
      lastSeenRound !== null && lastSeenRound !== currentRound,
  };
}

export function groupSessionsByWorkspace(
  sessions: SessionSummary[],
): Record<string, SessionSummary[]> {
  return sessions.reduce<Record<string, SessionSummary[]>>((groups, session) => {
    groups[session.workspace] = groups[session.workspace] ?? [];
    groups[session.workspace].push(session);

    return groups;
  }, {});
}

export function getCurrentRound(session: ApiSession): number {
  if (Number.isInteger(session.currentRound) && session.currentRound >= 0) {
    return session.currentRound;
  }

  const storedRound = Math.max(
    0,
    ...(session.rounds?.map(({ round }) => round) ?? []),
  );
  const messageRound = Math.max(
    0,
    ...session.messages
      .map(({ round }) => round ?? 0)
      .filter((round) => Number.isInteger(round) && round > 0),
  );
  const completedTurnCount = Math.max(
    countAssistantMessages(session, 'trace'),
    countAssistantMessages(session, 'response'),
  );

  return Math.max(storedRound, messageRound, completedTurnCount);
}

function countAssistantMessages(
  session: ApiSession,
  kind: 'response' | 'trace',
): number {
  return session.messages.filter(
    (message) => message.role === 'assistant' && message.kind === kind,
  ).length;
}
