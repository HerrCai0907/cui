import { type FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createModelRequestPreferences, type AppConfig } from "../../config/model/appConfig";
import {
  cancelRun,
  createRun,
  createSession,
  getSession,
  listSessions,
  type SessionListPage,
  updateSession,
} from "../api/sessionsApi";
import {
  getCurrentRound,
  groupSessionsByWorkspace,
  partitionActiveSessionsForSidebar,
  toSessionSummary,
} from "../model/sessionSummaries";
import {
  clampSidebarWidth,
  loadSessionAttentionState,
  loadSessionSidebarBrowserState,
  saveSessionAttentionState,
  saveSessionSidebarBrowserState,
  setLastSeenRound,
  type SessionAttentionState,
  type SessionListMode,
  type SessionSidebarBrowserState,
} from "../model/sessionBrowserState";
import { useRunStream } from "./useRunStream";
import type { ApiSession, ApiSessionListItem, SessionSummary } from "../../../types";

type OpenSessionOptions = {
  resetError?: boolean;
};

type SetCurrentActiveSessionOptions = {
  persist?: boolean;
  recordAttention?: boolean;
};

type ComposerMode = "chat" | "shell";

export type QueuedPromptView = {
  id: string;
  mode: ComposerMode;
  prompt: string;
  createdAt: string;
};

const LAST_ACTIVE_SESSION_STORAGE_KEY = "cui:last-active-session-id:v1";
const DONE_MARK_VISIBLE_DURATION_MS = 800;
const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 48;
const EMPTY_QUEUED_PROMPTS: QueuedPromptView[] = [];
const SESSION_PAGE_SIZE = 30;
const SIDEBAR_SESSION_REFRESH_INTERVAL_MS = 10_000;

type SessionPagination = SessionListPage["pagination"];

type CachedSessionListItem = ApiSessionListItem & SessionSummary;

type CachedSessionPage = {
  sessions: CachedSessionListItem[];
  pagination: SessionPagination;
};

const INITIAL_SESSION_PAGINATION: SessionPagination = {
  page: 1,
  pageSize: SESSION_PAGE_SIZE,
  total: 0,
  totalPages: 1,
  hasPreviousPage: false,
  hasNextPage: false,
};

export function useSessionController(defaultWorkspace: string, config: AppConfig) {
  const [sidebarBrowserState, setSidebarBrowserState] = useState(() =>
    loadSessionSidebarBrowserState(defaultWorkspace),
  );
  const [sessionAttentionState, setSessionAttentionState] = useState(loadSessionAttentionState);
  const sidebarOpen = sidebarBrowserState.sidebarOpen;
  const sidebarWidth = sidebarBrowserState.sidebarWidth;
  const sessionListMode = sidebarBrowserState.sessionListMode;
  const expandedWorkspaces = sidebarBrowserState.expandedWorkspacesByMode[sessionListMode];
  const [sessions, setSessions] = useState<CachedSessionListItem[]>([]);
  const [sessionPage, setSessionPage] = useState(1);
  const [sessionPagination, setSessionPagination] = useState<SessionPagination>(
    INITIAL_SESSION_PAGINATION,
  );
  const [sessionPageLoading, setSessionPageLoading] = useState(false);
  const [activeSession, setActiveSession] = useState<ApiSession | null>(null);
  const [draft, setDraft] = useState("");
  const [composerMode, setComposerMode] = useState<ComposerMode>("chat");
  const [workspaceDraft, setWorkspaceDraft] = useState(defaultWorkspace);
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(() => new Set());
  const [submittingSessionIds, setSubmittingSessionIds] = useState<Set<string>>(() => new Set());
  const [stoppingSessionIds, setStoppingSessionIds] = useState<Set<string>>(() => new Set());
  const [pendingDoneSessionIds, setPendingDoneSessionIds] = useState<Set<string>>(() => new Set());
  const [creatingSession, setCreatingSession] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedTraceIds, setExpandedTraceIds] = useState<Set<string>>(() => new Set());
  const activeSessionRef = useRef<ApiSession | null>(null);
  const autoRestoreSessionRef = useRef(true);
  const sessionPageCacheRef = useRef<Map<number, CachedSessionPage>>(new Map());
  const refreshSessionsRequestIdRef = useRef(0);
  const refreshSidebarSessionsRef = useRef<() => void>(() => undefined);
  const sidebarRefreshInFlightRef = useRef(false);
  const openSessionRequestIdRef = useRef(0);
  const lastEnterKeyDownRef = useRef<number | null>(null);
  const messageStreamRef = useRef<HTMLDivElement | null>(null);
  const lastScrolledSessionIdRef = useRef<string | null>(null);
  const shouldStickToMessageBottomRef = useRef(true);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const runningSessionIdsRef = useRef<Set<string>>(runningSessionIds);
  const runningRunIdBySessionIdRef = useRef<Map<string, string>>(new Map());
  const submittingSessionIdsRef = useRef<Set<string>>(submittingSessionIds);
  const activeSessionRunning = activeSession ? runningSessionIds.has(activeSession.id) : false;
  const activeSessionSubmitting = activeSession
    ? submittingSessionIds.has(activeSession.id)
    : false;
  const activeSessionStopping = activeSession ? stoppingSessionIds.has(activeSession.id) : false;
  const activeSessionBlocked = activeSession
    ? activeSessionRunning || activeSessionSubmitting
    : creatingSession;
  const activeSessionQueuedPrompts = activeSession
    ? (activeSession.queuedPrompts ?? EMPTY_QUEUED_PROMPTS)
    : EMPTY_QUEUED_PROMPTS;
  const composerSubmitDisabled = activeSession ? activeSessionSubmitting : creatingSession;
  const highlightedSessionIds = useMemo(() => {
    const ids = new Set([...runningSessionIds, ...submittingSessionIds]);

    if (activeSession) {
      ids.add(activeSession.id);
    }

    return ids;
  }, [activeSession?.id, runningSessionIds, submittingSessionIds]);
  const highlightedWorkspaceIds = useMemo(
    () =>
      new Set(
        [activeSession?.workspace, workspaceDraft.trim() || defaultWorkspace].filter(
          (workspace): workspace is string => Boolean(workspace),
        ),
      ),
    [activeSession?.workspace, defaultWorkspace, workspaceDraft],
  );
  const sidebarSessionPartition = useMemo(
    () =>
      partitionActiveSessionsForSidebar(
        sessions,
        sessionAttentionState,
        highlightedSessionIds,
        highlightedWorkspaceIds,
      ),
    [highlightedSessionIds, highlightedWorkspaceIds, sessionAttentionState, sessions],
  );

  const workspaces = useMemo(
    () =>
      sessionListMode === "active"
        ? createWorkspaceGroups(
            sidebarSessionPartition.active,
            sidebarSessionPartition.activeWorkspaces,
          )
        : createWorkspaceGroups(
            getCachedSessionPageSessions(sessionPageCacheRef.current, sessionPage),
            [...highlightedWorkspaceIds],
          ),
    [
      highlightedWorkspaceIds,
      sessionListMode,
      sidebarSessionPartition.active,
      sidebarSessionPartition.activeWorkspaces,
      sessionPage,
      sessions,
    ],
  );
  const { applyLocalRunOverlay, closeRunStream, streamRun } = useRunStream({
    activeSessionRef,
    onRunSettled: (sessionId) => {
      void refreshSessions();
    },
    refreshSessions,
    setActiveSession,
    setCurrentActiveSession,
    setError,
    setExpandedTraceIds,
    setRunningSession,
    setSessions: updateSessionSummaries,
  });

  useEffect(() => {
    void refreshSessions();
  }, []);

  useEffect(() => {
    refreshSidebarSessionsRef.current = () => {
      if (sessionPageLoading || sidebarRefreshInFlightRef.current) {
        return;
      }

      sidebarRefreshInFlightRef.current = true;
      void refreshSessions(sessionPage, { showLoading: false }).finally(() => {
        sidebarRefreshInFlightRef.current = false;
      });
    };
  });

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      refreshSidebarSessionsRef.current();
    }, SIDEBAR_SESSION_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (!hasPendingAtomicReview(activeSession) && activeSessionQueuedPrompts.length === 0) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refreshSessions();
    }, 3000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [activeSession?.id, activeSession?.rounds, activeSessionQueuedPrompts.length]);

  useLayoutEffect(() => {
    const messageStream = messageStreamRef.current;
    const sessionChanged = lastScrolledSessionIdRef.current !== (activeSession?.id ?? null);

    if (!messageStream || !activeSession) {
      lastScrolledSessionIdRef.current = activeSession?.id ?? null;
      return;
    }

    if (sessionChanged || shouldStickToMessageBottomRef.current) {
      messageStream.scrollTop = messageStream.scrollHeight;
      shouldStickToMessageBottomRef.current = true;
    } else {
      shouldStickToMessageBottomRef.current = isScrolledNearBottom(messageStream);
    }

    lastScrolledSessionIdRef.current = activeSession.id;
  }, [
    activeSession?.id,
    activeSession?.messages,
    activeSessionBlocked,
    activeSessionQueuedPrompts,
    error,
  ]);

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
      const nextExpandedWorkspaces = new Set(
        current.expandedWorkspacesByMode[current.sessionListMode],
      );

      if (nextExpandedWorkspaces.has(workspaceId)) {
        nextExpandedWorkspaces.delete(workspaceId);
      } else {
        nextExpandedWorkspaces.add(workspaceId);
      }

      return {
        ...current,
        expandedWorkspacesByMode: {
          ...current.expandedWorkspacesByMode,
          [current.sessionListMode]: nextExpandedWorkspaces,
        },
      };
    });
    recordWorkspaceAttention(workspaceId);
  }

  function setSidebarOpen(open: boolean) {
    updateSidebarBrowserState((current) => ({
      ...current,
      sidebarOpen: open,
    }));
  }

  function setSidebarWidth(width: number) {
    updateSidebarBrowserState((current) => ({
      ...current,
      sidebarWidth: clampSidebarWidth(width),
    }));
  }

  function setSessionListMode(mode: SessionListMode) {
    updateSidebarBrowserState((current) => ({
      ...current,
      sessionListMode: mode,
    }));
  }

  function expandWorkspace(workspaceId: string) {
    updateSidebarBrowserState((current) => ({
      ...current,
      expandedWorkspacesByMode: {
        ...current.expandedWorkspacesByMode,
        [current.sessionListMode]: new Set(
          current.expandedWorkspacesByMode[current.sessionListMode],
        ).add(workspaceId),
      },
    }));
  }

  function expandWorkspaceForMode(workspaceId: string, mode: SessionListMode) {
    updateSidebarBrowserState((current) => ({
      ...current,
      expandedWorkspacesByMode: {
        ...current.expandedWorkspacesByMode,
        [mode]: new Set(current.expandedWorkspacesByMode[mode]).add(workspaceId),
      },
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

  async function refreshSessions(
    page = sessionPage,
    options: { force?: boolean; showLoading?: boolean; warmNeighbors?: boolean } = {},
  ) {
    const requestId = refreshSessionsRequestIdRef.current + 1;
    const showLoading = options.showLoading ?? true;

    refreshSessionsRequestIdRef.current = requestId;
    if (showLoading) {
      setSessionPageLoading(true);
    }

    try {
      const loadedPage = await loadSessionPage(page, { force: options.force ?? true });

      if (refreshSessionsRequestIdRef.current !== requestId) {
        return;
      }

      const loadedSessions = mergeCachedSessionPages();
      const currentActiveSession = activeSessionRef.current;
      const previousActiveSessionRunningRunId = currentActiveSession
        ? runningRunIdBySessionIdRef.current.get(currentActiveSession.id)
        : undefined;
      const locallyRunningSessionIds = new Set(runningSessionIdsRef.current);
      const localRunningRunIds = new Map(runningRunIdBySessionIdRef.current);
      const nextRunningSessionIds = new Set(
        loadedSessions
          .filter((session) => session.isRunning ?? session.runningRunId)
          .map((session) => session.id),
      );
      const nextRunningRunIds = new Map(
        loadedSessions
          .filter((session) => session.runningRunId)
          .map((session) => [session.id, session.runningRunId!]),
      );

      locallyRunningSessionIds.forEach((sessionId) => nextRunningSessionIds.add(sessionId));
      localRunningRunIds.forEach((runId, sessionId) => {
        if (!nextRunningRunIds.has(sessionId)) {
          nextRunningRunIds.set(sessionId, runId);
        }
      });

      const previousSummariesById = new Map(sessions.map((session) => [session.id, session]));
      const sessionSummaries = loadedSessions
        .map((session) => ({
          ...session,
          ...toSessionSummary(session),
          isRunning: nextRunningSessionIds.has(session.id),
        }))
        .map((session) => {
          const previousSummary = previousSummariesById.get(session.id);

          return {
            ...session,
            hasUnreadRound:
              currentActiveSession?.id === session.id
                ? false
                : session.hasUnreadRound || Boolean(previousSummary?.hasUnreadRound),
          };
        });

      replaceCachedSessions(sessionSummaries);
      pruneSessionAttention(sessionSummaries);
      setSessionPage(loadedPage.pagination.page);
      setSessionPagination(loadedPage.pagination);
      runningSessionIdsRef.current = nextRunningSessionIds;
      runningRunIdBySessionIdRef.current = nextRunningRunIds;
      setRunningSessionIds(nextRunningSessionIds);

      const nextActiveSessionSummary =
        currentActiveSession &&
        loadedSessions.find((session) => session.id === currentActiveSession.id);
      const shouldRestoreInitialSession = !currentActiveSession && autoRestoreSessionRef.current;

      autoRestoreSessionRef.current = false;

      if (shouldRestoreInitialSession) {
        const lastActiveSessionId = readLastActiveSessionId();
        const restoredSession =
          lastActiveSessionId &&
          loadedSessions.find((session) => session.id === lastActiveSessionId);
        const fallbackSession = restoredSession ?? loadedSessions[0];

        if (lastActiveSessionId && !restoredSession) {
          clearLastActiveSessionId();
        }

        if (fallbackSession) {
          expandWorkspaceForMode(fallbackSession.workspace, "active");
          setCurrentActiveSession(createSessionShell(fallbackSession), {
            persist: Boolean(restoredSession),
            recordAttention: false,
          });
          if (fallbackSession.runningRunId) {
            streamRun(fallbackSession.id, fallbackSession.runningRunId);
          }
          void restoreInitialSession(fallbackSession.id, Boolean(restoredSession), {
            showError: false,
          });
        }
      } else if (nextActiveSessionSummary && currentActiveSession) {
        const shouldLoadFullActiveSession =
          nextActiveSessionSummary.runningRunId &&
          nextActiveSessionSummary.runningRunId !== previousActiveSessionRunningRunId;
        const nextActiveSession = shouldLoadFullActiveSession
          ? await getSession(currentActiveSession.id)
          : {
              ...currentActiveSession,
              title: nextActiveSessionSummary.title,
              summary: nextActiveSessionSummary.summary,
              doneAt: nextActiveSessionSummary.doneAt,
              updatedAt: nextActiveSessionSummary.updatedAt,
              currentRound: Math.max(
                currentActiveSession.currentRound,
                nextActiveSessionSummary.currentRound,
              ),
              gitBranch: nextActiveSessionSummary.gitBranch ?? currentActiveSession.gitBranch,
              queuedPrompts: nextActiveSessionSummary.queuedPrompts,
              isRunning: nextActiveSessionSummary.isRunning,
              runningRunId: nextActiveSessionSummary.runningRunId,
            };

        if (refreshSessionsRequestIdRef.current !== requestId) {
          return;
        }

        const visibleSession = applyLocalSessionState(nextActiveSession);

        setCurrentActiveSession(visibleSession);
        if (visibleSession.runningRunId) {
          streamRun(visibleSession.id, visibleSession.runningRunId);
        }
      }

      if (options.warmNeighbors ?? false) {
        void warmSessionPageNeighbors(loadedPage.pagination).then(() => {
          if (refreshSessionsRequestIdRef.current === requestId) {
            setSessions(mergeCachedSessionPages());
          }
        });
      }
    } catch (reason) {
      if (refreshSessionsRequestIdRef.current !== requestId) {
        return;
      }

      setError(reason instanceof Error ? reason.message : "Failed to load sessions");
    } finally {
      if (showLoading && refreshSessionsRequestIdRef.current === requestId) {
        setSessionPageLoading(false);
      }
    }
  }

  async function restoreInitialSession(
    sessionId: string,
    persist: boolean,
    options: { showError?: boolean } = {},
  ) {
    try {
      const session = await getSession(sessionId);

      setCurrentActiveSession(applyLocalSessionState(session), {
        persist,
        recordAttention: false,
      });
      if (session.runningRunId) {
        streamRun(session.id, session.runningRunId);
      }
    } catch (reason) {
      if (options.showError ?? true) {
        setError(reason instanceof Error ? reason.message : "Failed to open session");
      }
    }
  }

  async function setSessionListPage(page: number) {
    await refreshSessions(page, { force: false, warmNeighbors: true });
  }

  async function loadSessionPage(
    page: number,
    options: { force?: boolean } = {},
  ): Promise<CachedSessionPage> {
    const cachedPage = sessionPageCacheRef.current.get(page);

    if (cachedPage && !(options.force ?? false)) {
      return cachedPage;
    }

    const loadedPage = await listSessions(page, SESSION_PAGE_SIZE);
    const cachedSessionPage = {
      sessions: loadedPage.sessions.map(toCachedSessionListItem),
      pagination: loadedPage.pagination,
    };

    sessionPageCacheRef.current.set(loadedPage.pagination.page, cachedSessionPage);

    return cachedSessionPage;
  }

  async function warmSessionPageNeighbors(pagination: SessionPagination) {
    await Promise.all(
      [pagination.page - 1, pagination.page + 1]
        .filter((page) => page >= 1 && page <= pagination.totalPages)
        .map((page) => loadSessionPage(page).catch(() => undefined)),
    );
    trimSessionPageCache(pagination.page);
  }

  function mergeCachedSessionPages(): CachedSessionListItem[] {
    const mergedSessionsById = new Map<string, CachedSessionListItem>();

    [...sessionPageCacheRef.current.entries()]
      .sort(([leftPage], [rightPage]) => leftPage - rightPage)
      .forEach(([, page]) => {
        page.sessions.forEach((session) => {
          mergedSessionsById.set(session.id, session);
        });
      });

    return sortSessionsByUpdatedAt([...mergedSessionsById.values()]);
  }

  function trimSessionPageCache(page: number) {
    const retainedPages = new Set([1, page - 1, page, page + 1].filter((value) => value >= 1));

    sessionPageCacheRef.current.forEach((_, cachedPage) => {
      if (!retainedPages.has(cachedPage)) {
        sessionPageCacheRef.current.delete(cachedPage);
      }
    });
  }

  function replaceCachedSessions(sessionSummaries: CachedSessionListItem[]) {
    updateCachedSessionSummaries(sessionSummaries);
    setSessions(sessionSummaries);
  }

  function updateSessions(updater: (current: CachedSessionListItem[]) => CachedSessionListItem[]) {
    setSessions((current) => {
      const next = sortSessionsByUpdatedAt(updater(current));

      updateCachedSessionSummaries(next);

      return next;
    });
  }

  function updateSessionSummaries(updater: (current: SessionSummary[]) => SessionSummary[]) {
    updateSessions((current) => {
      const existingById = new Map(current.map((session) => [session.id, session]));

      return updater(current).map((session) => ({
        ...existingById.get(session.id),
        ...session,
        isRunning: session.isRunning,
      }));
    });
  }

  function updateCachedSessionSummaries(sessionSummaries: CachedSessionListItem[]) {
    const sessionById = new Map(sessionSummaries.map((session) => [session.id, session]));

    sessionPageCacheRef.current.forEach((page, pageNumber) => {
      sessionPageCacheRef.current.set(pageNumber, {
        ...page,
        sessions: page.sessions.map((session) => sessionById.get(session.id) ?? session),
      });
    });
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
      if (session.runningRunId) {
        setRunningRun(session.id, session.runningRunId);
        streamRun(session.id, session.runningRunId);
      }
    } catch (reason) {
      if (openSessionRequestIdRef.current !== requestId) {
        return;
      }

      setError(reason instanceof Error ? reason.message : "Failed to open session");
    }
  }

  async function submitPrompt(
    prompt: string,
    options: { mode?: ComposerMode; restoreDraftOnFailure?: boolean } = {},
  ) {
    const trimmed = prompt.trim();
    const submittedSessionId = activeSession?.id ?? null;
    const mode = options.mode ?? "chat";

    if (!trimmed) {
      return false;
    }

    const submittedSessionRunning = submittedSessionId
      ? runningSessionIdsRef.current.has(submittedSessionId)
      : false;
    const submittedSessionSubmitting = submittedSessionId
      ? submittingSessionIdsRef.current.has(submittedSessionId)
      : false;

    if (activeSessionBlocked && (!submittedSessionRunning || submittedSessionSubmitting)) {
      return false;
    }

    if (submittedSessionId) {
      setPendingDoneSessionIds((current) => {
        const next = new Set(current);

        next.delete(submittedSessionId);

        return next;
      });
      setSubmittingSession(submittedSessionId, true);
      if (activeSession) {
        recordSessionAttention(activeSession);
      }
    } else {
      setCreatingSession(true);
    }
    setError(null);
    if (options.restoreDraftOnFailure ?? true) {
      setDraft("");
    }

    try {
      const workspace = workspaceDraft.trim() || defaultWorkspace;
      const models = createModelRequestPreferences(
        config.harness,
        config.models,
        config.reasoningEfforts,
      );
      const targetSession =
        activeSession ??
        (await createSession({
          workspace,
          origin: mode,
          title: mode === "shell" ? `$ ${trimmed}` : trimmed,
        }));
      const data = await createRun(
        targetSession.id,
        mode === "shell"
          ? {
              type: "shell_command",
              input: { command: trimmed },
            }
          : {
              type: "assistant_response",
              input: { prompt: trimmed },
              models,
            },
      );

      recordSessionAttention(data.session);
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
      if (data.run.status !== "queued") {
        setRunningRun(data.session.id, data.run.id);
        streamRun(data.session.id, data.run.id);
      }
      return true;
    } catch (reason) {
      if (submittedSessionId) {
        setSubmittingSession(submittedSessionId, false);
      }
      setCreatingSession(false);

      if (
        (submittedSessionId && activeSessionRef.current?.id === submittedSessionId) ||
        (!submittedSessionId && !activeSessionRef.current)
      ) {
        if (options.restoreDraftOnFailure ?? true) {
          setDraft(trimmed);
        }
        setError(reason instanceof Error ? reason.message : "Request failed");
      }
      return false;
    }
  }

  async function submitDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await submitPrompt(draft, { mode: composerMode, restoreDraftOnFailure: true });
  }

  async function stopActiveSession() {
    const currentSession = activeSessionRef.current;
    const sessionId = currentSession?.id;
    const runningRunId = currentSession?.runningRunId;

    if (!sessionId || !runningSessionIds.has(sessionId) || stoppingSessionIds.has(sessionId)) {
      return;
    }

    setError(null);
    setStoppingSession(sessionId, true);

    try {
      if (!runningRunId) {
        return;
      }

      await cancelRun(runningRunId);
      closeRunStream(sessionId, runningRunId, { preserveOverlay: true });
      clearRunningRun(sessionId, runningRunId);
      await refreshSessions();
    } catch (reason) {
      if (activeSessionRef.current?.id === sessionId) {
        setError(reason instanceof Error ? reason.message : "Failed to stop session");
      }
    } finally {
      setStoppingSession(sessionId, false);
    }
  }

  async function markSessionDone(sessionId: string) {
    setError(null);
    setPendingDoneSessionIds((current) => new Set(current).add(sessionId));

    try {
      const [updatedSession] = await Promise.all([
        updateSession(sessionId, { done: true }),
        delay(DONE_MARK_VISIBLE_DURATION_MS),
      ]);
      const updatedSummary = toCachedSessionListItem(updatedSession);

      updateSessions((current) =>
        current.map((session) => (session.id === sessionId ? updatedSummary : session)),
      );
      if (activeSessionRef.current?.id === sessionId) {
        setCurrentActiveSession(updatedSession, {
          recordAttention: false,
        });
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Failed to mark session done");
      await refreshSessions();
    } finally {
      setPendingDoneSessionIds((current) => {
        const next = new Set(current);

        next.delete(sessionId);

        return next;
      });
    }
  }

  function startNewSession(workspace?: string) {
    autoRestoreSessionRef.current = false;
    setCurrentActiveSession(null);
    if (workspace) {
      updateWorkspaceDraft(workspace);
      recordWorkspaceAttention(workspace);
      expandWorkspace(workspace);
    }
    setError(null);
  }

  function updateWorkspaceDraft(workspace: string) {
    setWorkspaceDraft(workspace);

    const trimmedWorkspace = workspace.trim();
    if (trimmedWorkspace) {
      expandWorkspace(trimmedWorkspace);
    }
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

  function handleMessageStreamScroll() {
    const messageStream = messageStreamRef.current;

    if (!messageStream) {
      return;
    }

    shouldStickToMessageBottomRef.current = isScrolledNearBottom(messageStream);
  }

  function setCurrentActiveSession(
    session: ApiSession | null,
    options: SetCurrentActiveSessionOptions = {},
  ) {
    const previousSession = activeSessionRef.current;
    const visibleSession = session ? applyLocalRunOverlay(session) : null;

    if (previousSession && previousSession.id !== visibleSession?.id) {
      setLastSeenRound(previousSession.id, getCurrentRound(previousSession));
    }

    if (visibleSession) {
      setLastSeenRound(visibleSession.id, getCurrentRound(visibleSession));
      if (options.recordAttention ?? true) {
        recordSessionAttention(visibleSession);
      }
      updateSessions((current) =>
        current.map((summary) =>
          summary.id === visibleSession.id
            ? {
                ...summary,
                doneAt: visibleSession.doneAt,
                currentRound: getCurrentRound(visibleSession),
                queuedPrompts: visibleSession.queuedPrompts,
                isRunning: visibleSession.isRunning ?? Boolean(visibleSession.runningRunId),
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

  function setRunningSession(sessionId: string, running: boolean, runId?: string) {
    if (!running && runId) {
      const currentRunId = runningRunIdBySessionIdRef.current.get(sessionId);

      if (currentRunId && currentRunId !== runId) {
        return;
      }
    }

    const next = new Set(runningSessionIdsRef.current);

    if (running) {
      next.add(sessionId);
    } else {
      next.delete(sessionId);
      runningRunIdBySessionIdRef.current.delete(sessionId);
    }

    runningSessionIdsRef.current = next;
    setRunningSessionIds(next);
    updateSessions((current) =>
      current.map((summary) =>
        summary.id === sessionId ? { ...summary, isRunning: running } : summary,
      ),
    );
  }

  function setRunningRun(sessionId: string, runId: string) {
    runningRunIdBySessionIdRef.current.set(sessionId, runId);
    setRunningSession(sessionId, true);
  }

  function clearRunningRun(sessionId: string, runId?: string) {
    const currentRunId = runningRunIdBySessionIdRef.current.get(sessionId);

    if (runId && currentRunId && currentRunId !== runId) {
      return;
    }

    setRunningSession(sessionId, false);
  }

  function setSubmittingSession(sessionId: string, submitting: boolean) {
    const next = new Set(submittingSessionIdsRef.current);

    if (submitting) {
      next.add(sessionId);
    } else {
      next.delete(sessionId);
    }

    submittingSessionIdsRef.current = next;
    setSubmittingSessionIds(next);
  }

  function applyLocalSessionState(session: ApiSession): ApiSession {
    const localRunId = runningRunIdBySessionIdRef.current.get(session.id);
    const sessionWithRunOverlay = applyLocalRunOverlay(session);

    if (!localRunId) {
      return sessionWithRunOverlay;
    }

    const currentSession = activeSessionRef.current;

    if (currentSession?.id !== session.id) {
      return {
        ...sessionWithRunOverlay,
        isRunning: true,
        runningRunId: localRunId,
      };
    }

    return {
      ...sessionWithRunOverlay,
      doneAt: sessionWithRunOverlay.doneAt,
      currentRound: Math.max(
        currentSession.currentRound ?? 0,
        sessionWithRunOverlay.currentRound ?? 0,
      ),
      gitBranch: sessionWithRunOverlay.gitBranch ?? currentSession.gitBranch,
      isRunning: true,
      runningRunId: localRunId,
    };
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

  function recordSessionAttention(session: Pick<ApiSession, "id" | "workspace">) {
    updateSessionAttentionState((current) => ({
      sessions: {
        ...current.sessions,
        [session.id]: Date.now(),
      },
      workspaces: {
        ...current.workspaces,
        [session.workspace]: Date.now(),
      },
    }));
  }

  function recordWorkspaceAttention(workspace: string) {
    updateSessionAttentionState((current) => ({
      ...current,
      workspaces: {
        ...current.workspaces,
        [workspace]: Date.now(),
      },
    }));
  }

  function pruneSessionAttention(sessionSummaries: SessionSummary[]) {
    const sessionIds = new Set(sessionSummaries.map((session) => session.id));
    const workspaceIds = new Set(sessionSummaries.map((session) => session.workspace));

    updateSessionAttentionState((current) => {
      const next = {
        sessions: filterKnownKeys(current.sessions, sessionIds),
        workspaces: filterKnownKeys(current.workspaces, workspaceIds),
      };

      return isSameAttentionState(current, next) ? current : next;
    });
  }

  function updateSessionAttentionState(
    updater: (current: SessionAttentionState) => SessionAttentionState,
  ) {
    setSessionAttentionState((current) => {
      const next = updater(current);

      if (next !== current) {
        saveSessionAttentionState(next);
      }

      return next;
    });
  }

  return {
    activeSession,
    activeSessionBlocked,
    activeSessionRunning,
    activeSessionStopping,
    activeSessionQueuedPrompts,
    composerMode,
    composerSubmitDisabled,
    composerTextareaRef,
    draft,
    error,
    expandedTraceIds,
    expandedWorkspaces,
    lastEnterKeyDownRef,
    messageStreamRef,
    handleMessageStreamScroll,
    refreshSessions,
    openSession,
    markSessionDone,
    pendingDoneSessionIds,
    runningSessionIds,
    setDraft,
    setComposerMode,
    setSessionListMode,
    setSessionListPage,
    setSidebarOpen,
    setSidebarWidth,
    setTraceExpanded,
    submitPrompt,
    setWorkspaceDraft: updateWorkspaceDraft,
    sidebarOpen,
    sidebarWidth,
    sessionPage,
    sessionPageLoading,
    sessionPagination,
    sessionListMode,
    startNewSession,
    stopActiveSession,
    submitDraft,
    toggleWorkspace,
    workspaceDraft,
    workspaces,
    visibleSessionCount:
      sessionListMode === "active"
        ? sidebarSessionPartition.active.length
        : (sessionPageCacheRef.current.get(sessionPage)?.sessions.length ?? 0),
    sessionCount: sessionPagination.total,
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

function filterKnownKeys(
  values: Record<string, number>,
  knownKeys: Set<string>,
): Record<string, number> {
  return Object.entries(values).reduce<Record<string, number>>((filtered, [key, value]) => {
    if (knownKeys.has(key)) {
      filtered[key] = value;
    }

    return filtered;
  }, {});
}

function createWorkspaceGroups(
  sessions: SessionSummary[],
  extraWorkspaces: string[],
): Record<string, SessionSummary[]> {
  const workspaces = groupSessionsByWorkspace(sessions);

  extraWorkspaces.forEach((workspace) => {
    workspaces[workspace] = workspaces[workspace] ?? [];
  });

  return workspaces;
}

function getCachedSessionPageSessions(
  cache: Map<number, CachedSessionPage>,
  page: number,
): CachedSessionListItem[] {
  return cache.get(page)?.sessions ?? [];
}

function sortSessionsByUpdatedAt<T extends SessionSummary>(sessions: T[]): T[] {
  return [...sessions].sort((left, right) => {
    const updatedAtOrder = right.updatedAt.localeCompare(left.updatedAt);

    return updatedAtOrder !== 0 ? updatedAtOrder : right.id.localeCompare(left.id);
  });
}

function toCachedSessionListItem(session: ApiSession | ApiSessionListItem): CachedSessionListItem {
  return {
    ...session,
    ...toSessionSummary(session),
  };
}

function createSessionShell(session: ApiSessionListItem): ApiSession {
  return {
    id: session.id,
    workspace: session.workspace,
    title: session.title,
    summary: session.summary,
    doneAt: session.doneAt,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messages: [],
    queuedPrompts: session.queuedPrompts,
    currentRound: session.currentRound,
    gitBranch: session.gitBranch,
    isRunning: session.isRunning,
    runningRunId: session.runningRunId,
  };
}

function isSameAttentionState(left: SessionAttentionState, right: SessionAttentionState): boolean {
  return (
    isSameNumberRecord(left.sessions, right.sessions) &&
    isSameNumberRecord(left.workspaces, right.workspaces)
  );
}

function isSameNumberRecord(left: Record<string, number>, right: Record<string, number>): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);

  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(([key, value]) => right[key] === value)
  );
}

function hasPendingAtomicReview(session: ApiSession | null): boolean {
  return Boolean(
    session?.rounds?.some((round) => round.hasChanges && round.atomicReviewStatus === undefined),
  );
}

function isScrolledNearBottom(element: HTMLElement): boolean {
  return (
    element.scrollHeight - element.scrollTop - element.clientHeight <=
    AUTO_SCROLL_BOTTOM_THRESHOLD_PX
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}
