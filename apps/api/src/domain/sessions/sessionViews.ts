import type { ChatSession, ChatSessionView } from '../../types.js';

export function toSessionView(session: ChatSession): ChatSessionView {
  return {
    ...session,
    rounds: session.rounds?.map(({ round, hasChanges, createdAt }) => ({
      round,
      hasChanges,
      createdAt,
    })),
  };
}
