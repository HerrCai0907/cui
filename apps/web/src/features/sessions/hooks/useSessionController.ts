import { type FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  continueSession,
  createSession,
  getSession,
  listSessions,
  stopSession,
} from "../api/sessionsApi";
import {
  getCurrentRound,
  groupSessionsByWorkspace,
  partitionSessionsForSidebar,
  toSessionSummary,
} from "../model/sessionSummaries";
import {
  loadSessionSidebarBrowserState,
  saveSessionSidebarBrowserState,
  setLastSeenRound,
  type SessionSidebarBrowserState,
} from "../model/sessionBrowserState";
import { useTurnStream } from "./useTurnStream";
import type { ApiSession, SessionSummary } from "../../../types";

type OpenSessionOptions = {
  resetError?: boolean;
};

type SetCurrentActiveSessionOptions = {
  persist?: boolean;
};

const LAST_ACTIVE_SESSION_STORAGE_KEY = "cui:last-active-session-id:v1";

export function useSessionController(defaultWorkspace: string) {
  const [sidebarBrowserState, setSidebarBrowserState] = useState(() =>
    loadSessionSidebarBrowserState(defaultWorkspace),
  );
  const sidebarOpen = sidebarBrowserState.sidebarOpen;
  const historyOpen = sidebarBrowserState.historyOpen;
  const expandedWorkspaces = sidebarBrowserState.expandedWorkspaces;
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSession, setActiveSession] = useState<ApiSession | null>(null);
  const [draft, setDraft] = useState("");
  const [workspaceDraft, setWorkspaceDraft] = useState(defaultWorkspace);
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(() => new Set());
  const [submittingSessionIds, setSubmittingSessionIds] = useState<Set<string>>(() => new Set());
  const [stoppingSessionIds, setStoppingSessionIds] = useState<Set<string>>(() => new Set());
  const [creatingSession, setCreatingSession] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedTraceIds, setExpandedTraceIds] = useState<Set<string>>(() => new Set());
  const activeSessionRef = useRef<ApiSession | null>(null);
  const openSessionRequestIdRef = useRef(0);
  const lastEnterKeyDownRef = useRef<number | null>(null);
  const messageStreamRef = useRef<HTMLDivElement | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const activeSessionRunning = activeSession ? runningSessionIds.has(activeSession.id) : false;
  const activeSessionStopping = activeSession ? stoppingSessionIds.has(activeSession.id) : false;
  const activeSessionBlocked = activeSession
    ? runningSessionIds.has(activeSession.id) || submittingSessionIds.has(activeSession.id)
    : creatingSession;
  const sidebarSessionPartition = useMemo(() => partitionSessionsForSidebar(sessions), [sessions]);

  const workspaces = useMemo(
    () => groupSessionsByWorkspace(sidebarSessionPartition.current),
    [sidebarSessionPartition.current],
  );
  const historyWorkspaces = useMemo(
    () => groupSessionsByWorkspace(sidebarSessionPartition.history),
    [sidebarSessionPartition.history],
  );
  const { applyRunningTurnOverlay, closeTurnStream, streamTurn } = useTurnStream({
    activeSessionRef,
    refreshSessions,
    setActiveSession,
    setCurrentActiveSession,
    setError,
    setExpandedTraceIds,
    setRunningSession,
    setSessions,
  });

  useEffect(() => {
    void refreshSessions();
  }, []);

  useLayoutEffect(() => {
    const messageStream = messageStreamRef.current;

    if (!messageStream || !activeSession) {
      return;
    }

    messageStream.scrollTop = messageStream.scrollHeight;
  }, [activeSession?.id, activeSession?.messages]);

  useLayoutEffect(() => {
    const textarea = composerTextareaRef.current;

    if (!textarea) {
      return;
    }

    const resizeTextarea = () => {
      const maxHeight = Math.floor(window.innerHeight / 3);

      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
      textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
    };

    resizeTextarea();
    window.addEventListener("resize", resizeTextarea);

    return () => {
      window.removeEventListener("resize", resizeTextarea);
    };
  }, [draft]);

  function toggleWorkspace(workspaceId: string) {
    updateSidebarBrowserState((current) => {
      const nextExpandedWorkspaces = new Set(current.expandedWorkspaces);

      if (nextExpandedWorkspaces.has(workspaceId)) {
        nextExpandedWorkspaces.delete(workspaceId);
      } else {
        nextExpandedWorkspaces.add(workspaceId);
      }

      return {
        ...current,
        expandedWorkspaces: nextExpandedWorkspaces,
      };
    });
  }

  function setSidebarOpen(open: boolean) {
    updateSidebarBrowserState((current) => ({
      ...current,
      sidebarOpen: open,
    }));
  }

  function setHistoryOpen(open: boolean) {
    updateSidebarBrowserState((current) => ({
      ...current,
      historyOpen: open,
    }));
  }

  function expandWorkspace(workspaceId: string) {
    updateSidebarBrowserState((current) => ({
      ...current,
      expandedWorkspaces: new Set(current.expandedWorkspaces).add(workspaceId),
    }));
  }

  function updateSidebarBrowserState(
    updater: (current: SessionSidebarBrowserState) => SessionSidebarBrowserState,
  ) {
    setSidebarBrowserState((current) => {
      const next = updater(current);

      saveSessionSidebarBrowserState(next);

      return next;
    });
  }

  async function refreshSessions() {
    try {
      const loadedSessions = await listSessions();

      setSessions(loadedSessions.map(toSessionSummary));
      setRunningSessionIds(
        new Set(
          loadedSessions
            .filter((session) => session.isRunning ?? session.runningTurnId)
            .map((session) => session.id),
        ),
      );

      const currentActiveSession = activeSessionRef.current;
      const nextActiveSession =
        currentActiveSession &&
        loadedSessions.find((session) => session.id === currentActiveSession.id);

      if (!currentActiveSession) {
        const lastActiveSessionId = readLastActiveSessionId();
        const restoredSession =
          lastActiveSessionId &&
          loadedSessions.find((session) => session.id === lastActiveSessionId);
        const fallbackSession = restoredSession ?? loadedSessions[0];

        if (lastActiveSessionId && !restoredSession) {
          clearLastActiveSessionId();
        }

        if (fallbackSession) {
          setCurrentActiveSession(fallbackSession, {
            persist: Boolean(restoredSession),
          });
          if (fallbackSession.runningTurnId) {
            streamTurn(fallbackSession.id, fallbackSession.runningTurnId);
          }
        }
      } else if (nextActiveSession?.runningTurnId) {
        streamTurn(nextActiveSession.id, nextActiveSession.runningTurnId);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Failed to load sessions");
    }
  }

  async function openSession(sessionId: string, options: OpenSessionOptions = {}) {
    const requestId = openSessionRequestIdRef.current + 1;

    openSessionRequestIdRef.current = requestId;
    if (options.resetError ?? true) {
      setError(null);
    }

    try {
      const session = await getSession(sessionId);
      if (openSessionRequestIdRef.current !== requestId) {
        return;
      }

      setCurrentActiveSession(session);
      setWorkspaceDraft(session.workspace);
      expandWorkspace(session.workspace);
      if (session.runningTurnId) {
        setRunningSession(session.id, true);
        streamTurn(session.id, session.runningTurnId);
      }
    } catch (reason) {
      if (openSessionRequestIdRef.current !== requestId) {
        return;
      }

      setError(reason instanceof Error ? reason.message : "Failed to open session");
    }
  }

  async function submitDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = draft.trim();
    const submittedSessionId = activeSession?.id ?? null;

    if (!trimmed || activeSessionBlocked) {
      return;
    }

    if (submittedSessionId) {
      setSubmittingSession(submittedSessionId, true);
    } else {
      setCreatingSession(true);
    }
    setError(null);
    setDraft("");

    try {
      const data = activeSession
        ? await continueSession(activeSession.id, { prompt: trimmed })
        : await createSession({
            workspace: workspaceDraft.trim() || defaultWorkspace,
            prompt: trimmed,
          });

      setRunningSession(data.session.id, true);
      if (submittedSessionId) {
        setSubmittingSession(submittedSessionId, false);
      }
      setCreatingSession(false);

      if (
        (submittedSessionId && activeSessionRef.current?.id === submittedSessionId) ||
        (!submittedSessionId && !activeSessionRef.current)
      ) {
        setCurrentActiveSession(data.session);
      }

      expandWorkspace(data.session.workspace);
      void refreshSessions();
      streamTurn(data.session.id, data.turnId);
    } catch (reason) {
      if (submittedSessionId) {
        setSubmittingSession(submittedSessionId, false);
      }
      setCreatingSession(false);

      if (
        (submittedSessionId && activeSessionRef.current?.id === submittedSessionId) ||
        (!submittedSessionId && !activeSessionRef.current)
      ) {
        setDraft(trimmed);
        setError(reason instanceof Error ? reason.message : "Request failed");
      }
    }
  }

  async function stopActiveSession() {
    const sessionId = activeSessionRef.current?.id;

    if (!sessionId || !runningSessionIds.has(sessionId) || stoppingSessionIds.has(sessionId)) {
      return;
    }

    setError(null);
    setStoppingSession(sessionId, true);

    try {
      await stopSession(sessionId);
      closeTurnStream(sessionId);
      setRunningSession(sessionId, false);
      await refreshSessions();
    } catch (reason) {
      if (activeSessionRef.current?.id === sessionId) {
        setError(reason instanceof Error ? reason.message : "Failed to stop session");
      }
    } finally {
      setStoppingSession(sessionId, false);
    }
  }

  function startNewSession(workspace?: string) {
    setCurrentActiveSession(null);
    setDraft("");
    if (workspace) {
      setWorkspaceDraft(workspace);
      expandWorkspace(workspace);
    }
    setError(null);
  }

  function setTraceExpanded(messageId: string, open: boolean) {
    setExpandedTraceIds((current) => {
      const next = new Set(current);

      if (open) {
        next.add(messageId);
      } else {
        next.delete(messageId);
      }

      return next;
    });
  }

  function setCurrentActiveSession(
    session: ApiSession | null,
    options: SetCurrentActiveSessionOptions = {},
  ) {
    const previousSession = activeSessionRef.current;
    const visibleSession = session ? applyRunningTurnOverlay(session) : null;

    if (previousSession && previousSession.id !== visibleSession?.id) {
      setLastSeenRound(previousSession.id, getCurrentRound(previousSession));
    }

    if (visibleSession) {
      setLastSeenRound(visibleSession.id, getCurrentRound(visibleSession));
      setSessions((current) =>
        current.map((summary) =>
          summary.id === visibleSession.id
            ? {
                ...summary,
                currentRound: getCurrentRound(visibleSession),
                isRunning: visibleSession.isRunning ?? Boolean(visibleSession.runningTurnId),
                hasUnreadRound: false,
              }
            : summary,
        ),
      );
    }

    activeSessionRef.current = visibleSession;
    setActiveSession(visibleSession);
    if (visibleSession && (options.persist ?? true)) {
      writeLastActiveSessionId(visibleSession.id);
    }
  }

  function setRunningSession(sessionId: string, running: boolean) {
    setRunningSessionIds((current) => {
      const next = new Set(current);

      if (running) {
        next.add(sessionId);
      } else {
        next.delete(sessionId);
      }

      return next;
    });
    setSessions((current) =>
      current.map((summary) =>
        summary.id === sessionId ? { ...summary, isRunning: running } : summary,
      ),
    );
  }

  function setSubmittingSession(sessionId: string, submitting: boolean) {
    setSubmittingSessionIds((current) => {
      const next = new Set(current);

      if (submitting) {
        next.add(sessionId);
      } else {
        next.delete(sessionId);
      }

      return next;
    });
  }

  function setStoppingSession(sessionId: string, stopping: boolean) {
    setStoppingSessionIds((current) => {
      const next = new Set(current);

      if (stopping) {
        next.add(sessionId);
      } else {
        next.delete(sessionId);
      }

      return next;
    });
  }

  return {
    activeSession,
    activeSessionBlocked,
    activeSessionRunning,
    activeSessionStopping,
    composerTextareaRef,
    draft,
    error,
    expandedTraceIds,
    expandedWorkspaces,
    historyOpen,
    lastEnterKeyDownRef,
    messageStreamRef,
    refreshSessions,
    openSession,
    runningSessionIds,
    setDraft,
    setHistoryOpen,
    setSidebarOpen,
    setTraceExpanded,
    setWorkspaceDraft,
    sidebarOpen,
    startNewSession,
    stopActiveSession,
    submitDraft,
    toggleWorkspace,
    workspaceDraft,
    historySessionCount: sidebarSessionPartition.history.length,
    historyWorkspaces,
    workspaces,
    sessionCount: sessions.length,
  };
}

function readLastActiveSessionId(): string | null {
  try {
    return window.localStorage.getItem(LAST_ACTIVE_SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeLastActiveSessionId(sessionId: string) {
  try {
    window.localStorage.setItem(LAST_ACTIVE_SESSION_STORAGE_KEY, sessionId);
  } catch {
    // Ignore storage failures so private browsing or quota errors do not block chat.
  }
}

function clearLastActiveSessionId() {
  try {
    window.localStorage.removeItem(LAST_ACTIVE_SESSION_STORAGE_KEY);
  } catch {
    // Ignore storage failures so private browsing or quota errors do not block chat.
  }
}
