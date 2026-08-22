import type { ApiSession, SessionSummary } from '../../../types';

export function toSessionSummary(session: ApiSession): SessionSummary {
  return {
    id: session.id,
    workspace: session.workspace,
    title: session.title,
    summary: session.summary,
    updatedAt: session.updatedAt,
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
