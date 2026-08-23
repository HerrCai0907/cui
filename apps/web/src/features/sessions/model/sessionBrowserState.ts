const LAST_SEEN_ROUND_PREFIX = "cui:session-last-seen-round:v1:";
const SIDEBAR_STATE_STORAGE_KEY = "cui:session-sidebar-state:v2";
const SESSION_ATTENTION_STORAGE_KEY = "cui:session-attention:v1";
const SIDEBAR_STATE_VERSION = 2;

export const SIDEBAR_DEFAULT_WIDTH = 292;
export const SIDEBAR_MIN_WIDTH = 220;
export const SIDEBAR_MAX_WIDTH = 520;

export type SessionListMode = "active" | "more";

export type SessionSidebarBrowserState = {
  sidebarOpen: boolean;
  sidebarWidth: number;
  sessionListMode: SessionListMode;
  expandedWorkspacesByMode: Record<SessionListMode, Set<string>>;
};

export type SessionAttentionState = {
  sessions: Record<string, number>;
  workspaces: Record<string, number>;
};

type StoredSessionSidebarBrowserState = {
  version: typeof SIDEBAR_STATE_VERSION;
  sidebarOpen?: boolean;
  sidebarWidth?: number;
  sessionListMode?: SessionListMode;
  activeExpandedWorkspaces?: string[];
  moreExpandedWorkspaces?: string[];
  expandedWorkspaces?: string[];
  updatedAt?: number;
};

type StoredSessionAttentionState = {
  version: 1;
  sessions?: Record<string, number>;
  workspaces?: Record<string, number>;
  updatedAt?: number;
};

export function getLastSeenRound(sessionId: string): number | null {
  if (typeof window === "undefined") {
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
  if (typeof window === "undefined") {
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

  if (typeof window === "undefined") {
    return defaultState;
  }

  try {
    const rawState = window.localStorage.getItem(SIDEBAR_STATE_STORAGE_KEY);

    if (!rawState) {
      return defaultState;
    }

    const parsed = JSON.parse(rawState) as Partial<StoredSessionSidebarBrowserState>;

    if (parsed.version !== SIDEBAR_STATE_VERSION) {
      window.localStorage.removeItem(SIDEBAR_STATE_STORAGE_KEY);
      return defaultState;
    }

    const sessionListMode = parseSessionListMode(
      parsed.sessionListMode,
      defaultState.sessionListMode,
    );
    const hasLegacyExpandedWorkspaces = Array.isArray(parsed.expandedWorkspaces);
    const legacyExpandedWorkspaces = parseStringSet(parsed.expandedWorkspaces, new Set());

    return {
      sidebarOpen:
        typeof parsed.sidebarOpen === "boolean" ? parsed.sidebarOpen : defaultState.sidebarOpen,
      sidebarWidth: parseSidebarWidth(parsed.sidebarWidth, defaultState.sidebarWidth),
      sessionListMode,
      expandedWorkspacesByMode: {
        active: parseStringSet(
          parsed.activeExpandedWorkspaces,
          hasLegacyExpandedWorkspaces && sessionListMode === "active"
            ? legacyExpandedWorkspaces
            : defaultState.expandedWorkspacesByMode.active,
        ),
        more: parseStringSet(
          parsed.moreExpandedWorkspaces,
          hasLegacyExpandedWorkspaces && sessionListMode === "more"
            ? legacyExpandedWorkspaces
            : defaultState.expandedWorkspacesByMode.more,
        ),
      },
    };
  } catch {
    window.localStorage.removeItem(SIDEBAR_STATE_STORAGE_KEY);
    return defaultState;
  }
}

export function saveSessionSidebarBrowserState(state: SessionSidebarBrowserState): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const storedState: StoredSessionSidebarBrowserState = {
      version: SIDEBAR_STATE_VERSION,
      sidebarOpen: state.sidebarOpen,
      sidebarWidth: clampSidebarWidth(state.sidebarWidth),
      sessionListMode: state.sessionListMode,
      activeExpandedWorkspaces: [...state.expandedWorkspacesByMode.active],
      moreExpandedWorkspaces: [...state.expandedWorkspacesByMode.more],
      updatedAt: Date.now(),
    };

    window.localStorage.setItem(SIDEBAR_STATE_STORAGE_KEY, JSON.stringify(storedState));
  } catch {
    // Sidebar persistence is a convenience only; keep the session UI usable.
  }
}

function createDefaultSidebarBrowserState(defaultWorkspace: string): SessionSidebarBrowserState {
  return {
    sidebarOpen: true,
    sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
    sessionListMode: "active",
    expandedWorkspacesByMode: {
      active: new Set([defaultWorkspace]),
      more: new Set([defaultWorkspace]),
    },
  };
}

export function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
}

function parseSidebarWidth(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? clampSidebarWidth(value) : fallback;
}

export function createEmptySessionAttentionState(): SessionAttentionState {
  return {
    sessions: {},
    workspaces: {},
  };
}

export function loadSessionAttentionState(): SessionAttentionState {
  if (typeof window === "undefined") {
    return createEmptySessionAttentionState();
  }

  try {
    const rawState = window.localStorage.getItem(SESSION_ATTENTION_STORAGE_KEY);

    if (!rawState) {
      return createEmptySessionAttentionState();
    }

    const parsed = JSON.parse(rawState) as Partial<StoredSessionAttentionState>;

    if (parsed.version !== 1) {
      window.localStorage.removeItem(SESSION_ATTENTION_STORAGE_KEY);
      return createEmptySessionAttentionState();
    }

    return {
      sessions: parseNumberRecord(parsed.sessions),
      workspaces: parseNumberRecord(parsed.workspaces),
    };
  } catch {
    window.localStorage.removeItem(SESSION_ATTENTION_STORAGE_KEY);
    return createEmptySessionAttentionState();
  }
}

export function saveSessionAttentionState(state: SessionAttentionState): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const storedState: StoredSessionAttentionState = {
      version: 1,
      sessions: state.sessions,
      workspaces: state.workspaces,
      updatedAt: Date.now(),
    };

    window.localStorage.setItem(SESSION_ATTENTION_STORAGE_KEY, JSON.stringify(storedState));
  } catch {
    // Sidebar attention persistence is a convenience only.
  }
}

function parseStringSet(value: unknown, fallback: Set<string>): Set<string> {
  if (!Array.isArray(value)) {
    return new Set(fallback);
  }

  return new Set(value.filter((item): item is string => typeof item === "string"));
}

function parseSessionListMode(value: unknown, fallback: SessionListMode): SessionListMode {
  return value === "active" || value === "more" ? value : fallback;
}

function parseNumberRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.entries(value).reduce<Record<string, number>>((record, [key, rawValue]) => {
    if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      record[key] = rawValue;
    }

    return record;
  }, {});
}
