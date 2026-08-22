const LAST_SEEN_ROUND_PREFIX = 'cui:session-last-seen-round:v1:';

export function getLastSeenRound(sessionId: string): number | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const rawRound = window.localStorage.getItem(createLastSeenRoundKey(sessionId));

    if (!rawRound) {
      return null;
    }

    const round = Number(rawRound);

    return Number.isInteger(round) && round >= 0 ? round : null;
  } catch {
    return null;
  }
}

export function setLastSeenRound(sessionId: string, round: number): void {
  if (typeof window === 'undefined') {
    return;
  }

  if (!Number.isInteger(round) || round < 0) {
    return;
  }

  try {
    window.localStorage.setItem(createLastSeenRoundKey(sessionId), String(round));
  } catch {
    // Ignore storage failures; the server state is still authoritative.
  }
}

function createLastSeenRoundKey(sessionId: string): string {
  return `${LAST_SEEN_ROUND_PREFIX}${sessionId}`;
}
