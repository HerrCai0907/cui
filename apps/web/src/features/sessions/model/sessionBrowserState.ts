const LAST_SEEN_ROUND_PREFIX = 'cui:session-last-seen-round:v1:';
const SIDEBAR_STATE_STORAGE_KEY = 'cui:session-sidebar-state:v1';
const SIDEBAR_STATE_VERSION = 1;

export type SessionSidebarBrowserState = {
  sidebarOpen: boolean;
  historyOpen: boolean;
  expandedWorkspaces: Set<string>;
};

type StoredSessionSidebarBrowserState = {
  version: typeof SIDEBAR_STATE_VERSION;
  sidebarOpen?: boolean;
  historyOpen?: boolean;
  expandedWorkspaces?: string[];
  updatedAt?: number;
};

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

export function loadSessionSidebarBrowserState(
  defaultWorkspace: string,
): SessionSidebarBrowserState {
  const defaultState = createDefaultSidebarBrowserState(defaultWorkspace);

  if (typeof window === 'undefined') {
    return defaultState;
  }

  try {
    const rawState = window.localStorage.getItem(SIDEBAR_STATE_STORAGE_KEY);

    if (!rawState) {
      return defaultState;
    }

    const parsed = JSON.parse(
      rawState,
    ) as Partial<StoredSessionSidebarBrowserState>;

    if (parsed.version !== SIDEBAR_STATE_VERSION) {
      window.localStorage.removeItem(SIDEBAR_STATE_STORAGE_KEY);
      return defaultState;
    }

    return {
      sidebarOpen:
        typeof parsed.sidebarOpen === 'boolean'
          ? parsed.sidebarOpen
          : defaultState.sidebarOpen,
      historyOpen:
        typeof parsed.historyOpen === 'boolean'
          ? parsed.historyOpen
          : defaultState.historyOpen,
      expandedWorkspaces: parseStringSet(
        parsed.expandedWorkspaces,
        defaultState.expandedWorkspaces,
      ),
    };
  } catch {
    window.localStorage.removeItem(SIDEBAR_STATE_STORAGE_KEY);
    return defaultState;
  }
}

export function saveSessionSidebarBrowserState(
  state: SessionSidebarBrowserState,
): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const storedState: StoredSessionSidebarBrowserState = {
      version: SIDEBAR_STATE_VERSION,
      sidebarOpen: state.sidebarOpen,
      historyOpen: state.historyOpen,
      expandedWorkspaces: [...state.expandedWorkspaces],
      updatedAt: Date.now(),
    };

    window.localStorage.setItem(
      SIDEBAR_STATE_STORAGE_KEY,
      JSON.stringify(storedState),
    );
  } catch {
    // Sidebar persistence is a convenience only; keep the session UI usable.
  }
}

function createDefaultSidebarBrowserState(
  defaultWorkspace: string,
): SessionSidebarBrowserState {
  return {
    sidebarOpen: true,
    historyOpen: false,
    expandedWorkspaces: new Set([defaultWorkspace]),
  };
}

function parseStringSet(value: unknown, fallback: Set<string>): Set<string> {
  if (!Array.isArray(value)) {
    return new Set(fallback);
  }

  return new Set(
    value.filter((item): item is string => typeof item === 'string'),
  );
}
