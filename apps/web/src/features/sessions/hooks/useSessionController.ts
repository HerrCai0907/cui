import {
  type FormEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  continueSession,
  createSession,
  getSession,
  listSessions,
} from '../api/sessionsApi';
import {
  groupSessionsByWorkspace,
  toSessionSummary,
} from '../model/sessionSummaries';
import { useTurnStream } from './useTurnStream';
import type { ApiSession, SessionSummary } from '../../../types';

type OpenSessionOptions = {
  resetError?: boolean;
};

export function useSessionController(defaultWorkspace: string) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Set<string>>(
    () => new Set([defaultWorkspace]),
  );
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSession, setActiveSession] = useState<ApiSession | null>(null);
  const [draft, setDraft] = useState('');
  const [workspaceDraft, setWorkspaceDraft] = useState(defaultWorkspace);
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [submittingSessionIds, setSubmittingSessionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [creatingSession, setCreatingSession] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedTraceIds, setExpandedTraceIds] = useState<Set<string>>(
    () => new Set(),
  );
  const activeSessionRef = useRef<ApiSession | null>(null);
  const openSessionRequestIdRef = useRef(0);
  const lastEnterKeyDownRef = useRef<number | null>(null);
  const messageStreamRef = useRef<HTMLDivElement | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const activeSessionBlocked = activeSession
    ? runningSessionIds.has(activeSession.id) ||
      submittingSessionIds.has(activeSession.id)
    : creatingSession;

  const workspaces = useMemo(
    () => groupSessionsByWorkspace(sessions),
    [sessions],
  );
  const { streamTurn } = useTurnStream({
    activeSessionRef,
    refreshSessions,
    setActiveSession,
    setCurrentActiveSession,
    setError,
    setExpandedTraceIds,
    setRunningSession,
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

      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
      textarea.style.overflowY =
        textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
    };

    resizeTextarea();
    window.addEventListener('resize', resizeTextarea);

    return () => {
      window.removeEventListener('resize', resizeTextarea);
    };
  }, [draft]);

  function toggleWorkspace(workspaceId: string) {
    setExpandedWorkspaces((current) => {
      const next = new Set(current);

      if (next.has(workspaceId)) {
        next.delete(workspaceId);
      } else {
        next.add(workspaceId);
      }

      return next;
    });
  }

  async function refreshSessions() {
    try {
      const loadedSessions = await listSessions();

      setSessions(loadedSessions.map(toSessionSummary));

      loadedSessions.forEach((session) => {
        if (session.runningTurnId) {
          setRunningSession(session.id, true);
        }
      });

      const currentActiveSession = activeSessionRef.current;
      const nextActiveSession =
        currentActiveSession &&
        loadedSessions.find((session) => session.id === currentActiveSession.id);

      if (!currentActiveSession && loadedSessions[0]) {
        setCurrentActiveSession(loadedSessions[0]);
        if (loadedSessions[0].runningTurnId) {
          streamTurn(loadedSessions[0].id, loadedSessions[0].runningTurnId);
        }
      } else if (nextActiveSession?.runningTurnId) {
        streamTurn(nextActiveSession.id, nextActiveSession.runningTurnId);
      }
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Failed to load sessions',
      );
    }
  }

  async function openSession(
    sessionId: string,
    options: OpenSessionOptions = {},
  ) {
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
      setExpandedWorkspaces((current) =>
        new Set(current).add(session.workspace),
      );
      if (session.runningTurnId) {
        setRunningSession(session.id, true);
        streamTurn(session.id, session.runningTurnId);
      }
    } catch (reason) {
      if (openSessionRequestIdRef.current !== requestId) {
        return;
      }

      setError(
        reason instanceof Error ? reason.message : 'Failed to open session',
      );
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
    setDraft('');

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
        (submittedSessionId &&
          activeSessionRef.current?.id === submittedSessionId) ||
        (!submittedSessionId && !activeSessionRef.current)
      ) {
        setCurrentActiveSession(data.session);
      }

      setExpandedWorkspaces((current) =>
        new Set(current).add(data.session.workspace),
      );
      void refreshSessions();
      streamTurn(data.session.id, data.turnId);
    } catch (reason) {
      if (submittedSessionId) {
        setSubmittingSession(submittedSessionId, false);
      }
      setCreatingSession(false);

      if (
        (submittedSessionId &&
          activeSessionRef.current?.id === submittedSessionId) ||
        (!submittedSessionId && !activeSessionRef.current)
      ) {
        setDraft(trimmed);
        setError(reason instanceof Error ? reason.message : 'Request failed');
      }
    }
  }

  function startNewSession(workspace?: string) {
    setCurrentActiveSession(null);
    setDraft('');
    if (workspace) {
      setWorkspaceDraft(workspace);
      setExpandedWorkspaces((current) => new Set(current).add(workspace));
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

  function setCurrentActiveSession(session: ApiSession | null) {
    activeSessionRef.current = session;
    setActiveSession(session);
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

  return {
    activeSession,
    activeSessionBlocked,
    composerTextareaRef,
    draft,
    error,
    expandedTraceIds,
    expandedWorkspaces,
    lastEnterKeyDownRef,
    messageStreamRef,
    refreshSessions,
    openSession,
    setDraft,
    setSidebarOpen,
    setTraceExpanded,
    setWorkspaceDraft,
    sidebarOpen,
    startNewSession,
    submitDraft,
    toggleWorkspace,
    workspaceDraft,
    workspaces,
    sessionCount: sessions.length,
  };
}
