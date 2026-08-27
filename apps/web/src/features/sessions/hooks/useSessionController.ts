import { type FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  createModelRequestPreferences,
  type AppConfig,
  type ModelPreferences,
} from "../../config/model/appConfig";
import {
  continueSession,
  createShellSession,
  createSession,
  getSession,
  listSessions,
  runShellCommand,
  stopSession,
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
import { useTurnStream } from "./useTurnStream";
import type { ApiSession, SessionSummary } from "../../../types";

type OpenSessionOptions = {
  resetError?: boolean;
};

type SetCurrentActiveSessionOptions = {
  persist?: boolean;
  recordAttention?: boolean;
};

type QueuedPrompt = {
  id: string;
  mode: ComposerMode;
  models: ModelPreferences;
  prompt: string;
  restoreDraftOnFailure: boolean;
};

type ComposerMode = "chat" | "shell";

export type QueuedPromptView = {
  id: string;
  mode: ComposerMode;
  prompt: string;
};

const LAST_ACTIVE_SESSION_STORAGE_KEY = "cui:last-active-session-id:v1";
const DONE_MARK_VISIBLE_DURATION_MS = 800;
const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 48;
const EMPTY_QUEUED_PROMPTS: QueuedPromptView[] = [];

export function useSessionController(defaultWorkspace: string, config: AppConfig) {
  const [sidebarBrowserState, setSidebarBrowserState] = useState(() =>
    loadSessionSidebarBrowserState(defaultWorkspace),
  );
  const [sessionAttentionState, setSessionAttentionState] = useState(loadSessionAttentionState);
  const sidebarOpen = sidebarBrowserState.sidebarOpen;
  const sidebarWidth = sidebarBrowserState.sidebarWidth;
  const sessionListMode = sidebarBrowserState.sessionListMode;
  const expandedWorkspaces = sidebarBrowserState.expandedWorkspacesByMode[sessionListMode];
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSession, setActiveSession] = useState<ApiSession | null>(null);
  const [draft, setDraft] = useState("");
  const [composerMode, setComposerMode] = useState<ComposerMode>("chat");
  const [workspaceDraft, setWorkspaceDraft] = useState(defaultWorkspace);
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(() => new Set());
  const [submittingSessionIds, setSubmittingSessionIds] = useState<Set<string>>(() => new Set());
  const [stoppingSessionIds, setStoppingSessionIds] = useState<Set<string>>(() => new Set());
  const [pendingDoneSessionIds, setPendingDoneSessionIds] = useState<Set<string>>(() => new Set());
  const [queuedPromptsBySessionId, setQueuedPromptsBySessionId] = useState<
    Map<string, QueuedPromptView[]>
  >(() => new Map());
  const [creatingSession, setCreatingSession] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedTraceIds, setExpandedTraceIds] = useState<Set<string>>(() => new Set());
  const activeSessionRef = useRef<ApiSession | null>(null);
  const autoRestoreSessionRef = useRef(true);
  const openSessionRequestIdRef = useRef(0);
  const lastEnterKeyDownRef = useRef<number | null>(null);
  const messageStreamRef = useRef<HTMLDivElement | null>(null);
  const lastScrolledSessionIdRef = useRef<string | null>(null);
  const shouldStickToMessageBottomRef = useRef(true);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const queuedPromptsRef = useRef<Map<string, QueuedPrompt[]>>(new Map());
  const queueDrainInProgressSessionIdsRef = useRef<Set<string>>(new Set());
  const runningSessionIdsRef = useRef<Set<string>>(runningSessionIds);
  const runningTurnIdBySessionIdRef = useRef<Map<string, string>>(new Map());
  const submittingSessionIdsRef = useRef<Set<string>>(submittingSessionIds);
  const nextQueuedPromptIdRef = useRef(0);
  const activeSessionRunning = activeSession ? runningSessionIds.has(activeSession.id) : false;
  const activeSessionStopping = activeSession ? stoppingSessionIds.has(activeSession.id) : false;
  const activeSessionBlocked = activeSession
    ? runningSessionIds.has(activeSession.id) || submittingSessionIds.has(activeSession.id)
    : creatingSession;
  const activeSessionQueuedPrompts = activeSession
    ? (queuedPromptsBySessionId.get(activeSession.id) ?? EMPTY_QUEUED_PROMPTS)
    : EMPTY_QUEUED_PROMPTS;
  const composerSubmitDisabled = activeSession
    ? activeSessionBlocked && !activeSessionRunning
    : activeSessionBlocked;
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
        : createWorkspaceGroups(sidebarSessionPartition.more, [...highlightedWorkspaceIds]),
    [
      highlightedWorkspaceIds,
      sessionListMode,
      sidebarSessionPartition.active,
      sidebarSessionPartition.activeWorkspaces,
      sidebarSessionPartition.more,
    ],
  );
  const { applyLocalTurnOverlay, closeTurnStream, streamTurn } = useTurnStream({
    activeSessionRef,
    onTurnSettled: (sessionId) => {
      void drainQueuedPrompt(sessionId);
    },
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

  useEffect(() => {
    if (!hasPendingAtomicReview(activeSession)) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refreshSessions();
    }, 3000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [activeSession?.id, activeSession?.rounds]);

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
      const locallyRunningSessionIds = new Set(runningSessionIdsRef.current);
      const localRunningTurnIds = new Map(runningTurnIdBySessionIdRef.current);
      const nextRunningSessionIds = new Set(
        loadedSessions
          .filter((session) => session.isRunning ?? session.runningTurnId)
          .map((session) => session.id),
      );
      const nextRunningTurnIds = new Map(
        loadedSessions
          .filter((session) => session.runningTurnId)
          .map((session) => [session.id, session.runningTurnId!]),
      );

      locallyRunningSessionIds.forEach((sessionId) => nextRunningSessionIds.add(sessionId));
      localRunningTurnIds.forEach((turnId, sessionId) => {
        if (!nextRunningTurnIds.has(sessionId)) {
          nextRunningTurnIds.set(sessionId, turnId);
        }
      });

      const sessionSummaries = loadedSessions.map((session) => ({
        ...toSessionSummary(session),
        isRunning: nextRunningSessionIds.has(session.id),
      }));

      setSessions(sessionSummaries);
      pruneSessionAttention(sessionSummaries);
      runningSessionIdsRef.current = nextRunningSessionIds;
      runningTurnIdBySessionIdRef.current = nextRunningTurnIds;
      setRunningSessionIds(nextRunningSessionIds);

      const currentActiveSession = activeSessionRef.current;
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
          const session = await getSession(fallbackSession.id);

          setCurrentActiveSession(applyLocalSessionState(session), {
            persist: Boolean(restoredSession),
            recordAttention: false,
          });
          if (session.runningTurnId) {
            streamTurn(session.id, session.runningTurnId);
          }
        }
      } else if (nextActiveSessionSummary && currentActiveSession) {
        const visibleSession = applyLocalSessionState({
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
          isRunning: nextActiveSessionSummary.isRunning,
          runningTurnId: nextActiveSessionSummary.runningTurnId,
        });

        setCurrentActiveSession(visibleSession);
        if (visibleSession.runningTurnId) {
          streamTurn(visibleSession.id, visibleSession.runningTurnId);
        }
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
        setRunningTurn(session.id, session.runningTurnId);
        streamTurn(session.id, session.runningTurnId);
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

    if (submittedSessionId && runningSessionIdsRef.current.has(submittedSessionId)) {
      queuePrompt(submittedSessionId, {
        mode,
        models: { ...config.models },
        prompt: trimmed,
        restoreDraftOnFailure: options.restoreDraftOnFailure ?? true,
      });
      setError(null);
      setDraft("");
      if (activeSession) {
        recordSessionAttention(activeSession);
      }
      return true;
    }

    if (activeSessionBlocked) {
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
      const models = createModelRequestPreferences(config.models);
      const data =
        mode === "shell"
          ? activeSession
            ? await runShellCommand(activeSession.id, { command: trimmed })
            : await createShellSession({
                workspace,
                command: trimmed,
              })
          : activeSession
            ? await continueSession(activeSession.id, { prompt: trimmed, models })
            : await createSession({
                workspace,
                prompt: trimmed,
                models,
              });

      setRunningTurn(data.session.id, data.turnId);
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
      streamTurn(data.session.id, data.turnId);
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

  async function drainQueuedPrompt(sessionId: string) {
    if (
      runningSessionIdsRef.current.has(sessionId) ||
      submittingSessionIdsRef.current.has(sessionId) ||
      queueDrainInProgressSessionIdsRef.current.has(sessionId)
    ) {
      return;
    }

    const queue = queuedPromptsRef.current.get(sessionId);
    const nextPrompt = queue?.shift();

    if (!nextPrompt) {
      queuedPromptsRef.current.delete(sessionId);
      clearQueuedPromptViews(sessionId);
      return;
    }

    if (!queue || queue.length === 0) {
      queuedPromptsRef.current.delete(sessionId);
    }
    removeQueuedPromptView(sessionId, nextPrompt.id);

    queueDrainInProgressSessionIdsRef.current.add(sessionId);
    setPendingDoneSessionIds((current) => {
      const next = new Set(current);

      next.delete(sessionId);

      return next;
    });
    setSubmittingSession(sessionId, true);
    setError(null);

    try {
      const models = createModelRequestPreferences(nextPrompt.models);
      const data =
        nextPrompt.mode === "shell"
          ? await runShellCommand(sessionId, { command: nextPrompt.prompt })
          : await continueSession(sessionId, { prompt: nextPrompt.prompt, models });

      setRunningTurn(data.session.id, data.turnId);
      recordSessionAttention(data.session);
      setSessions((current) => {
        const nextSummary = toSessionSummary(data.session);

        return current.some((session) => session.id === data.session.id)
          ? current.map((session) => (session.id === data.session.id ? nextSummary : session))
          : [nextSummary, ...current];
      });

      if (activeSessionRef.current?.id === sessionId) {
        setCurrentActiveSession(data.session);
      }

      expandWorkspace(data.session.workspace);
      void refreshSessions();
      streamTurn(data.session.id, data.turnId);
    } catch (reason) {
      if (activeSessionRef.current?.id === sessionId) {
        if (nextPrompt.restoreDraftOnFailure) {
          setDraft(nextPrompt.prompt);
        }
        setError(reason instanceof Error ? reason.message : "Request failed");
      }
    } finally {
      setSubmittingSession(sessionId, false);
      queueDrainInProgressSessionIdsRef.current.delete(sessionId);
    }
  }

  async function stopActiveSession() {
    const currentSession = activeSessionRef.current;
    const sessionId = currentSession?.id;
    const runningTurnId = currentSession?.runningTurnId;

    if (!sessionId || !runningSessionIds.has(sessionId) || stoppingSessionIds.has(sessionId)) {
      return;
    }

    setError(null);
    setStoppingSession(sessionId, true);

    try {
      await stopSession(sessionId);
      closeTurnStream(sessionId, runningTurnId, { preserveOverlay: true });
      clearRunningTurn(sessionId, runningTurnId);
      await refreshSessions();
      void drainQueuedPrompt(sessionId);
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
      const updatedSummary = toSessionSummary(updatedSession);

      setSessions((current) =>
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
    const visibleSession = session ? applyLocalTurnOverlay(session) : null;

    if (previousSession && previousSession.id !== visibleSession?.id) {
      setLastSeenRound(previousSession.id, getCurrentRound(previousSession));
    }

    if (visibleSession) {
      setLastSeenRound(visibleSession.id, getCurrentRound(visibleSession));
      if (options.recordAttention ?? true) {
        recordSessionAttention(visibleSession);
      }
      setSessions((current) =>
        current.map((summary) =>
          summary.id === visibleSession.id
            ? {
                ...summary,
                doneAt: visibleSession.doneAt,
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

  function setRunningSession(sessionId: string, running: boolean, turnId?: string) {
    if (!running && turnId) {
      const currentTurnId = runningTurnIdBySessionIdRef.current.get(sessionId);

      if (currentTurnId && currentTurnId !== turnId) {
        return;
      }
    }

    const next = new Set(runningSessionIdsRef.current);

    if (running) {
      next.add(sessionId);
    } else {
      next.delete(sessionId);
      runningTurnIdBySessionIdRef.current.delete(sessionId);
    }

    runningSessionIdsRef.current = next;
    setRunningSessionIds(next);
    setSessions((current) =>
      current.map((summary) =>
        summary.id === sessionId ? { ...summary, isRunning: running } : summary,
      ),
    );
  }

  function setRunningTurn(sessionId: string, turnId: string) {
    runningTurnIdBySessionIdRef.current.set(sessionId, turnId);
    setRunningSession(sessionId, true);
  }

  function clearRunningTurn(sessionId: string, turnId?: string) {
    const currentTurnId = runningTurnIdBySessionIdRef.current.get(sessionId);

    if (turnId && currentTurnId && currentTurnId !== turnId) {
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

  function queuePrompt(sessionId: string, prompt: Omit<QueuedPrompt, "id">) {
    const queue = queuedPromptsRef.current.get(sessionId) ?? [];
    const queuedPrompt = {
      ...prompt,
      id: `queued-prompt-${nextQueuedPromptIdRef.current}`,
    };

    nextQueuedPromptIdRef.current += 1;
    queuedPromptsRef.current.set(sessionId, [...queue, queuedPrompt]);
    setQueuedPromptsBySessionId((current) => {
      const next = new Map(current);
      const visibleQueue = next.get(sessionId) ?? [];

      next.set(sessionId, [
        ...visibleQueue,
        {
          id: queuedPrompt.id,
          mode: queuedPrompt.mode,
          prompt: queuedPrompt.prompt,
        },
      ]);

      return next;
    });
  }

  function removeQueuedPromptView(sessionId: string, queuedPromptId: string) {
    setQueuedPromptsBySessionId((current) => {
      const visibleQueue = current.get(sessionId);

      if (!visibleQueue) {
        return current;
      }

      const nextVisibleQueue = visibleQueue.filter((prompt) => prompt.id !== queuedPromptId);
      const next = new Map(current);

      if (nextVisibleQueue.length === 0) {
        next.delete(sessionId);
      } else {
        next.set(sessionId, nextVisibleQueue);
      }

      return next;
    });
  }

  function clearQueuedPromptViews(sessionId: string) {
    setQueuedPromptsBySessionId((current) => {
      if (!current.has(sessionId)) {
        return current;
      }

      const next = new Map(current);

      next.delete(sessionId);

      return next;
    });
  }

  function applyLocalSessionState(session: ApiSession): ApiSession {
    const localTurnId = runningTurnIdBySessionIdRef.current.get(session.id);
    const sessionWithTurnOverlay = applyLocalTurnOverlay(session);

    if (!localTurnId) {
      return sessionWithTurnOverlay;
    }

    const currentSession = activeSessionRef.current;

    if (currentSession?.id !== session.id) {
      return {
        ...sessionWithTurnOverlay,
        isRunning: true,
        runningTurnId: localTurnId,
      };
    }

    return {
      ...sessionWithTurnOverlay,
      doneAt: sessionWithTurnOverlay.doneAt,
      currentRound: Math.max(
        currentSession.currentRound ?? 0,
        sessionWithTurnOverlay.currentRound ?? 0,
      ),
      gitBranch: sessionWithTurnOverlay.gitBranch ?? currentSession.gitBranch,
      isRunning: true,
      runningTurnId: localTurnId,
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
    setSidebarOpen,
    setSidebarWidth,
    setTraceExpanded,
    submitPrompt,
    setWorkspaceDraft: updateWorkspaceDraft,
    sidebarOpen,
    sidebarWidth,
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
        : sidebarSessionPartition.more.length,
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
