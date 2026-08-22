import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  FileDiff,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Send,
} from 'lucide-react';
import {
  FormEvent,
  StrictMode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createRoot } from 'react-dom/client';
import { ReviewDiff } from './components/ReviewDiff';
import { TraceView } from './components/TraceView';
import { encodeExecutionTraceEvent } from './trace/parseExecutionTrace';
import type {
  ApiMessage,
  ApiRound,
  ApiSession,
  SessionSummary,
  SubmittedTurn,
  TurnStreamEvent,
} from './types';
import './styles.css';

type ReviewRoute = {
  sessionId: string;
  round: number;
  mode: 'atomic' | 'full';
};

function App() {
  const [reviewRoute, setReviewRoute] = useState<ReviewRoute | null>(() =>
    parseReviewRoute(location.pathname),
  );
  const [review, setReview] = useState<ApiRound | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Set<string>>(
    () => new Set(['/Users/bytedance/cui']),
  );
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSession, setActiveSession] = useState<ApiSession | null>(null);
  const [draft, setDraft] = useState('');
  const [workspaceDraft, setWorkspaceDraft] = useState('/Users/bytedance/cui');
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
  const eventSourceRefs = useRef<Map<string, EventSource>>(new Map());
  const openSessionRequestIdRef = useRef(0);
  const lastEnterKeyDownRef = useRef<number | null>(null);
  const messageStreamRef = useRef<HTMLDivElement | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const activeSessionBlocked = activeSession
    ? runningSessionIds.has(activeSession.id) ||
      submittingSessionIds.has(activeSession.id)
    : creatingSession;

  const workspaces = useMemo(
    () =>
      sessions.reduce<Record<string, SessionSummary[]>>((groups, session) => {
        groups[session.workspace] = groups[session.workspace] ?? [];
        groups[session.workspace].push(session);

        return groups;
      }, {}),
    [sessions],
  );

  useEffect(() => {
    void refreshSessions();
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      setReviewRoute(parseReviewRoute(location.pathname));
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  useEffect(() => {
    return () => {
      eventSourceRefs.current.forEach((eventSource) => {
        eventSource.close();
      });
      eventSourceRefs.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!reviewRoute) {
      setReview(null);
      setReviewLoading(false);
      return;
    }

    let cancelled = false;

    setReviewLoading(true);
    setError(null);
    fetch(
      `/api/sessions/${encodeURIComponent(reviewRoute.sessionId)}/rounds/${reviewRoute.round}/review`,
    )
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to load review: HTTP ${response.status}`);
        }

        return (await response.json()) as { review: ApiRound };
      })
      .then((data) => {
        if (!cancelled) {
          setReview(data.review);
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          setReview(null);
          setError(
            reason instanceof Error ? reason.message : 'Failed to load review',
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setReviewLoading(false);
        }
      });

    if (activeSession?.id !== reviewRoute.sessionId) {
      void openSession(reviewRoute.sessionId, { resetReviewRoute: false });
    }

    return () => {
      cancelled = true;
    };
  }, [reviewRoute?.sessionId, reviewRoute?.round, reviewRoute?.mode]);

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
      const response = await fetch('/api/sessions');

      if (!response.ok) {
        throw new Error(`Failed to load sessions: HTTP ${response.status}`);
      }

      const data = (await response.json()) as { sessions: ApiSession[] };
      setSessions(
        data.sessions.map((session) => ({
          id: session.id,
          workspace: session.workspace,
          title: session.title,
          summary: session.summary,
          updatedAt: session.updatedAt,
        })),
      );

      if (!activeSessionRef.current && data.sessions[0]) {
        setCurrentActiveSession(data.sessions[0]);
      }
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Failed to load sessions',
      );
    }
  }

  async function openSession(
    sessionId: string,
    options: { resetReviewRoute?: boolean } = {},
  ) {
    const resetReviewRoute = options.resetReviewRoute ?? true;
    const requestId = openSessionRequestIdRef.current + 1;

    openSessionRequestIdRef.current = requestId;
    setError(null);
    if (resetReviewRoute) {
      setReviewRoute(null);
      setReview(null);
    }
    if (resetReviewRoute && location.pathname !== '/') {
      history.pushState({}, '', '/');
    }

    try {
      const response = await fetch(`/api/sessions/${sessionId}`);

      if (!response.ok) {
        throw new Error(`Failed to open session: HTTP ${response.status}`);
      }

      const data = (await response.json()) as { session: ApiSession };
      if (openSessionRequestIdRef.current !== requestId) {
        return;
      }

      setCurrentActiveSession(data.session);
      setWorkspaceDraft(data.session.workspace);
      setExpandedWorkspaces((current) =>
        new Set(current).add(data.session.workspace),
      );
    } catch (reason) {
      if (openSessionRequestIdRef.current !== requestId) {
        return;
      }

      setError(
        reason instanceof Error ? reason.message : 'Failed to open session',
      );
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
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
      const response = await fetch(
        activeSession
          ? `/api/sessions/${activeSession.id}/messages`
          : '/api/sessions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(
            activeSession
              ? { prompt: trimmed }
              : {
                  workspace: workspaceDraft.trim() || '/Users/bytedance/cui',
                  prompt: trimmed,
                },
          ),
        },
      );

      if (!response.ok) {
        throw new Error(`Request failed: HTTP ${response.status}`);
      }

      const data = (await response.json()) as SubmittedTurn;
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
        (submittedSessionId && activeSessionRef.current?.id === submittedSessionId) ||
        (!submittedSessionId && !activeSessionRef.current)
      ) {
        setDraft(trimmed);
        setError(reason instanceof Error ? reason.message : 'Request failed');
      }
    }
  }

  function streamTurn(sessionId: string, turnId: string) {
    eventSourceRefs.current.get(sessionId)?.close();

    const eventSource = new EventSource(`/api/turns/${turnId}/events`);
    eventSourceRefs.current.set(sessionId, eventSource);
    const streamingTraceMessageId = `stream-${turnId}-trace`;
    const streamingResponseMessageId = `stream-${turnId}-response`;
    let streamedTrace = '';
    let streamedResponse = '';
    let streamClosed = false;

    const appendResponseDelta = (text: string) => {
      if (!text) {
        return;
      }

      streamedResponse += text;

      setActiveSession((session) => {
        if (!session || session.id !== sessionId) {
          return session;
        }

        const existingMessage = session.messages.find(
          (message) => message.id === streamingResponseMessageId,
        );

        if (existingMessage) {
          const nextSession = {
            ...session,
            messages: session.messages.map((message) =>
              message.id === streamingResponseMessageId
                ? { ...message, content: streamedResponse }
                : message,
            ),
          };

          activeSessionRef.current = nextSession;
          return nextSession;
        }

        const streamMessage: ApiMessage = {
          id: streamingResponseMessageId,
          role: 'assistant',
          kind: 'response',
          content: streamedResponse,
          createdAt: new Date().toISOString(),
        };

        const nextSession = {
          ...session,
          messages: [...session.messages, streamMessage],
        };

        activeSessionRef.current = nextSession;
        return nextSession;
      });
    };

    const appendTraceEvent = (rawEvent: unknown) => {
      const json = encodeExecutionTraceEvent(rawEvent);

      if (!json) {
        return;
      }

      streamedTrace = streamedTrace ? `${streamedTrace}\n${json}` : json;
      setExpandedTraceIds((current) =>
        new Set(current).add(streamingTraceMessageId),
      );

      setActiveSession((session) => {
        if (!session || session.id !== sessionId) {
          return session;
        }

        const existingMessage = session.messages.find(
          (message) => message.id === streamingTraceMessageId,
        );

        if (existingMessage) {
          const nextSession = {
            ...session,
            messages: session.messages.map((message) =>
              message.id === streamingTraceMessageId
                ? { ...message, content: streamedTrace }
                : message,
            ),
          };

          activeSessionRef.current = nextSession;
          return nextSession;
        }

        const streamMessage: ApiMessage = {
          id: streamingTraceMessageId,
          role: 'assistant',
          kind: 'trace',
          content: streamedTrace,
          createdAt: new Date().toISOString(),
        };
        const responseIndex = session.messages.findIndex(
          (message) => message.id === streamingResponseMessageId,
        );
        const messages =
          responseIndex === -1
            ? [...session.messages, streamMessage]
            : [
                ...session.messages.slice(0, responseIndex),
                streamMessage,
                ...session.messages.slice(responseIndex),
              ];

        const nextSession = {
          ...session,
          messages,
        };

        activeSessionRef.current = nextSession;
        return nextSession;
      });
    };

    eventSource.addEventListener('delta', (event) => {
      const data = parseMessageEvent(event);

      if (data?.type === 'delta') {
        appendResponseDelta(data.text);
      }
    });

    eventSource.addEventListener('raw', (event) => {
      const data = parseMessageEvent(event);

      if (data?.type === 'raw') {
        appendTraceEvent(data.event);
      }
    });

    eventSource.addEventListener('done', (event) => {
      const data = parseMessageEvent(event);

      if (data?.type !== 'done') {
        return;
      }

      if (activeSessionRef.current?.id === data.session.id) {
        setCurrentActiveSession(data.session);
      }
      setExpandedTraceIds((current) => {
        const next = new Set(current);

        next.delete(streamingTraceMessageId);

        return next;
      });
      setRunningSession(sessionId, false);
      void refreshSessions();
      streamClosed = true;
      eventSource.close();
      if (eventSourceRefs.current.get(sessionId) === eventSource) {
        eventSourceRefs.current.delete(sessionId);
      }
    });

    eventSource.addEventListener('failed', (event) => {
      const data = parseMessageEvent(event);

      if (activeSessionRef.current?.id === sessionId) {
        setError(data?.type === 'failed' ? data.error : 'Request failed');
      }
      setRunningSession(sessionId, false);
      streamClosed = true;
      eventSource.close();
      if (eventSourceRefs.current.get(sessionId) === eventSource) {
        eventSourceRefs.current.delete(sessionId);
      }
    });

    eventSource.onerror = () => {
      if (streamClosed) {
        return;
      }

      if (activeSessionRef.current?.id === sessionId) {
        setError('Stream connection failed');
      }
      setRunningSession(sessionId, false);
      eventSource.close();
      if (eventSourceRefs.current.get(sessionId) === eventSource) {
        eventSourceRefs.current.delete(sessionId);
      }
    };
  }

  function startNewSession() {
    setReviewRoute(null);
    setReview(null);
    if (location.pathname !== '/') {
      history.pushState({}, '', '/');
    }
    setCurrentActiveSession(null);
    setDraft('');
    setError(null);
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

  function openReview(sessionId: string, round: number) {
    const path = `/ui/sessions/${encodeURIComponent(sessionId)}/rounds/${round}/atomic_review`;

    window.open(path, '_blank', 'noopener,noreferrer');
  }

  function openFullReview() {
    if (!reviewRoute) {
      return;
    }

    window.location.assign(
      `/ui/sessions/${encodeURIComponent(reviewRoute.sessionId)}/rounds/${reviewRoute.round}/full_review`,
    );
  }

  function closeReview() {
    history.pushState({}, '', '/');
    setReviewRoute(null);
    setReview(null);
  }

  function hasReviewDiff(message: ApiMessage): boolean {
    if (
      message.role !== 'assistant' ||
      message.kind !== 'response' ||
      !message.round
    ) {
      return false;
    }

    return Boolean(
      activeSession?.rounds?.find((round) => round.round === message.round)
        ?.hasChanges,
    );
  }

  function parseMessageEvent(event: Event): TurnStreamEvent | undefined {
    if (!(event instanceof MessageEvent)) {
      return undefined;
    }

    try {
      return JSON.parse(event.data) as TurnStreamEvent;
    } catch {
      return undefined;
    }
  }

  return (
    <main className={`app-shell ${sidebarOpen ? '' : 'is-collapsed'}`}>
      <aside className="sidebar" aria-label="Workspace sessions">
        <div className="sidebar-header">
          {sidebarOpen && (
            <div>
              <strong>CUI</strong>
              <span>Workspaces</span>
            </div>
          )}
          <button
            className="icon-button"
            type="button"
            aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            onClick={() => setSidebarOpen((open) => !open)}
          >
            {sidebarOpen ? (
              <PanelLeftClose size={18} />
            ) : (
              <PanelLeftOpen size={18} />
            )}
          </button>
        </div>

        {sidebarOpen && (
          <>
            <button
              className="new-session"
              type="button"
              onClick={startNewSession}
            >
              <Plus size={16} />
              New session
            </button>

            <nav className="workspace-list">
              {Object.entries(workspaces).map(
                ([workspace, workspaceSessions]) => {
                  const expanded = expandedWorkspaces.has(workspace);

                  return (
                    <section className="workspace-group" key={workspace}>
                      <button
                        className="workspace-button"
                        type="button"
                        aria-expanded={expanded}
                        onClick={() => toggleWorkspace(workspace)}
                      >
                        {expanded ? (
                          <ChevronDown size={16} />
                        ) : (
                          <ChevronRight size={16} />
                        )}
                        <span>{workspace}</span>
                      </button>

                      {expanded && (
                        <div className="session-list">
                          {workspaceSessions.map((session) => {
                            const active = activeSession?.id === session.id;

                            return (
                              <button
                                className={`session-button ${active ? 'is-active' : ''}`}
                                key={session.id}
                                type="button"
                                onClick={() => void openSession(session.id)}
                              >
                                <span>{session.title}</span>
                                <small>
                                  {active && session.summary
                                    ? session.summary
                                    : formatRelativeTime(session.updatedAt)}
                                </small>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </section>
                  );
                },
              )}
              {sessions.length === 0 && (
                <p className="empty-sidebar">No sessions yet</p>
              )}
            </nav>
          </>
        )}
      </aside>

      <section
        className="chat-area"
        aria-label={reviewRoute ? 'Round review' : 'AI conversation'}
      >
        <header className="chat-header">
          <div>
            <span className="section-label">
              {reviewRoute
                ? reviewRoute.mode === 'atomic'
                  ? 'Atomic Review'
                  : 'Full Review'
                : 'Session'}
            </span>
            <h1>
              {reviewRoute
                ? `Round ${reviewRoute.round}`
                : (activeSession?.title ?? 'New session')}
            </h1>
            {reviewRoute ? (
              <p className="session-progress">
                {activeSession?.title ?? reviewRoute.sessionId}
              </p>
            ) : (
              activeSession?.summary && (
                <p className="session-progress">{activeSession.summary}</p>
              )
            )}
          </div>
          {reviewRoute && (
            <button
              className="secondary-button"
              type="button"
              onClick={closeReview}
            >
              <ArrowLeft size={16} />
              Back
            </button>
          )}
        </header>

        {reviewRoute ? (
          <div className="review-page">
            {reviewLoading && (
              <p className="loading-line">Loading review analysis...</p>
            )}
            {!reviewLoading && review && (
              <>
                <div className="review-summary">
                  <div>
                    <span className="section-label">Session</span>
                    <strong>{reviewRoute.sessionId}</strong>
                  </div>
                  <div>
                    <span className="section-label">Changed</span>
                    <strong>{formatMessageTime(review.createdAt)}</strong>
                  </div>
                </div>
                <ReviewDiff
                  key={reviewBrowserStateKey(reviewRoute)}
                  diff={review.diff}
                  atomicReview={review.atomicReview}
                  mode={reviewRoute.mode}
                  stateKey={reviewBrowserStateKey(reviewRoute)}
                  onOpenFullReview={openFullReview}
                />
              </>
            )}
            {!reviewLoading && !review && !error && (
              <p className="empty-review">
                No review diff was stored for this round.
              </p>
            )}
            {error && <p className="error-line">{error}</p>}
          </div>
        ) : (
          <>
            <div
              className="message-stream"
              ref={messageStreamRef}
              role="log"
              aria-live="polite"
            >
              {!activeSession && (
                <div className="empty-state">
                  <h2>Start a TRAEX-backed AI session</h2>
                  <p>
                    Pick a workspace path, type the initial prompt, and the
                    backend will create a persistent session.
                  </p>
                  <input
                    value={workspaceDraft}
                    aria-label="Workspace path"
                    onChange={(event) => setWorkspaceDraft(event.target.value)}
                  />
                </div>
              )}

              {activeSession?.messages.map((message) => {
                const isTrace = message.kind === 'trace';
                const traceExpanded = expandedTraceIds.has(message.id);

                return (
                  <article
                    className={`message ${message.role} ${isTrace ? 'trace' : ''}`}
                    key={message.id}
                  >
                    <div className="message-avatar">
                      {isTrace ? (
                        <ClipboardList size={17} />
                      ) : message.role === 'assistant' ? (
                        'AI'
                      ) : (
                        'You'
                      )}
                    </div>
                    <div className="message-body">
                      <div className="message-meta">
                        <div className="message-title-row">
                          <strong>{getMessageTitle(message)}</strong>
                          {message.round && hasReviewDiff(message) && (
                            <button
                              className="review-button"
                              type="button"
                              onClick={() =>
                                openReview(activeSession.id, message.round!)
                              }
                            >
                              <FileDiff size={14} />
                              [review]
                            </button>
                          )}
                        </div>
                        <time>{formatMessageTime(message.createdAt)}</time>
                      </div>
                      {isTrace ? (
                        <TraceView
                          content={message.content}
                          expanded={traceExpanded}
                          onExpandedChange={(open) => {
                            setExpandedTraceIds((current) => {
                              const next = new Set(current);

                              if (open) {
                                next.add(message.id);
                              } else {
                                next.delete(message.id);
                              }

                              return next;
                            });
                          }}
                        />
                      ) : (
                        <p>{message.content}</p>
                      )}
                    </div>
                  </article>
                );
              })}

              {activeSessionBlocked && (
                <p className="loading-line">Waiting for TRAEX...</p>
              )}
              {error && <p className="error-line">{error}</p>}
            </div>

            <form className="composer" onSubmit={handleSubmit}>
              <label className="sr-only" htmlFor="message-input">
                Message
              </label>
              <textarea
                id="message-input"
                ref={composerTextareaRef}
                value={draft}
                placeholder={
                  activeSession
                    ? 'Continue this session...'
                    : 'Start with an initial prompt...'
                }
                rows={1}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key !== 'Enter' ||
                    event.shiftKey ||
                    event.ctrlKey ||
                    event.metaKey ||
                    event.altKey
                  ) {
                    lastEnterKeyDownRef.current = null;
                    return;
                  }

                  const previousEnterKeyDown = lastEnterKeyDownRef.current;
                  lastEnterKeyDownRef.current = event.timeStamp;

                  if (
                    previousEnterKeyDown !== null &&
                    event.timeStamp - previousEnterKeyDown < 500 &&
                    !activeSessionBlocked &&
                    draft.trim()
                  ) {
                    event.preventDefault();
                    lastEnterKeyDownRef.current = null;
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              <button
                className="send-button"
                type="submit"
                aria-label="Send message"
                title="Send"
                disabled={activeSessionBlocked}
              >
                <Send size={18} />
                <span>Send</span>
              </button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}

function formatMessageTime(value: string): string {
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getMessageTitle(message: ApiMessage): string {
  if (message.kind === 'trace') {
    return 'Execution Trace';
  }

  return message.role === 'assistant' ? 'Assistant' : 'You';
}

function formatRelativeTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Unknown';
  }

  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function parseReviewRoute(pathname: string): ReviewRoute | null {
  const match =
    /^\/ui\/sessions\/([^/]+)\/rounds\/(\d+)\/(atomic_review|full_review)\/?$/.exec(
      pathname,
    );

  if (!match) {
    return null;
  }

  try {
    return {
      sessionId: decodeURIComponent(match[1]),
      round: Number(match[2]),
      mode: match[3] === 'full_review' ? 'full' : 'atomic',
    };
  } catch {
    return null;
  }
}

function reviewBrowserStateKey(route: ReviewRoute): string {
  return `cui:review-state:v1:${route.sessionId}:${route.round}`;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
