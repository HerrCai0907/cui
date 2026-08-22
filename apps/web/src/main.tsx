import {
  ChevronDown,
  ChevronRight,
  ClipboardList,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Send,
} from 'lucide-react';
import { FormEvent, StrictMode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TraceView } from './components/TraceView';
import { encodeExecutionTraceEvent } from './trace/parseExecutionTrace';
import type { ApiMessage, ApiSession, SessionSummary, SubmittedTurn, TurnStreamEvent } from './types';
import './styles.css';

function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Set<string>>(
    () => new Set([location.pathname === '/' ? '/Users/bytedance/cui' : location.pathname]),
  );
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSession, setActiveSession] = useState<ApiSession | null>(null);
  const [draft, setDraft] = useState('');
  const [workspaceDraft, setWorkspaceDraft] = useState('/Users/bytedance/cui');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedTraceIds, setExpandedTraceIds] = useState<Set<string>>(() => new Set());
  const eventSourceRef = useRef<EventSource | null>(null);
  const lastEnterKeyDownRef = useRef<number | null>(null);
  const messageStreamRef = useRef<HTMLDivElement | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);

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
    return () => {
      eventSourceRef.current?.close();
    };
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
      textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
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

      if (!activeSession && data.sessions[0]) {
        setActiveSession(data.sessions[0]);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to load sessions');
    }
  }

  async function openSession(sessionId: string) {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/sessions/${sessionId}`);

      if (!response.ok) {
        throw new Error(`Failed to open session: HTTP ${response.status}`);
      }

      const data = (await response.json()) as { session: ApiSession };
      setActiveSession(data.session);
      setWorkspaceDraft(data.session.workspace);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to open session');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = draft.trim();

    if (!trimmed) {
      return;
    }

    setLoading(true);
    setError(null);
    setDraft('');

    try {
      const response = await fetch(
        activeSession ? `/api/sessions/${activeSession.id}/messages` : '/api/sessions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(
            activeSession
              ? { prompt: trimmed }
              : { workspace: workspaceDraft.trim() || '/Users/bytedance/cui', prompt: trimmed },
          ),
        },
      );

      if (!response.ok) {
        throw new Error(`Request failed: HTTP ${response.status}`);
      }

      const data = (await response.json()) as SubmittedTurn;
      setActiveSession(data.session);
      setExpandedWorkspaces((current) => new Set(current).add(data.session.workspace));
      void refreshSessions();
      streamTurn(data.turnId);
    } catch (reason) {
      setDraft(trimmed);
      setError(reason instanceof Error ? reason.message : 'Request failed');
      setLoading(false);
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    }
  }

  function streamTurn(turnId: string) {
    eventSourceRef.current?.close();

    const eventSource = new EventSource(`/api/turns/${turnId}/events`);
    eventSourceRef.current = eventSource;
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
        if (!session) {
          return session;
        }

        const existingMessage = session.messages.find(
          (message) => message.id === streamingResponseMessageId,
        );

        if (existingMessage) {
          return {
            ...session,
            messages: session.messages.map((message) =>
              message.id === streamingResponseMessageId
                ? { ...message, content: streamedResponse }
                : message,
            ),
          };
        }

        const streamMessage: ApiMessage = {
          id: streamingResponseMessageId,
          role: 'assistant',
          kind: 'response',
          content: streamedResponse,
          createdAt: new Date().toISOString(),
        };

        return {
          ...session,
          messages: [...session.messages, streamMessage],
        };
      });
    };

    const appendTraceEvent = (rawEvent: unknown) => {
      const json = encodeExecutionTraceEvent(rawEvent);

      if (!json) {
        return;
      }

      streamedTrace = streamedTrace ? `${streamedTrace}\n${json}` : json;
      setExpandedTraceIds((current) => new Set(current).add(streamingTraceMessageId));

      setActiveSession((session) => {
        if (!session) {
          return session;
        }

        const existingMessage = session.messages.find((message) => message.id === streamingTraceMessageId);

        if (existingMessage) {
          return {
            ...session,
            messages: session.messages.map((message) =>
              message.id === streamingTraceMessageId ? { ...message, content: streamedTrace } : message,
            ),
          };
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

        return {
          ...session,
          messages,
        };
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

      setActiveSession(data.session);
      setExpandedTraceIds((current) => {
        const next = new Set(current);

        next.delete(streamingTraceMessageId);

        return next;
      });
      setLoading(false);
      void refreshSessions();
      streamClosed = true;
      eventSource.close();
      eventSourceRef.current = null;
    });

    eventSource.addEventListener('failed', (event) => {
      const data = parseMessageEvent(event);

      setError(data?.type === 'failed' ? data.error : 'Request failed');
      setLoading(false);
      streamClosed = true;
      eventSource.close();
      eventSourceRef.current = null;
    });

    eventSource.onerror = () => {
      if (streamClosed) {
        return;
      }

      setError('Stream connection failed');
      setLoading(false);
      eventSource.close();
      eventSourceRef.current = null;
    };
  }

  function startNewSession() {
    if (loading) {
      return;
    }

    setActiveSession(null);
    setDraft('');
    setError(null);
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
            {sidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
          </button>
        </div>

        {sidebarOpen && (
          <>
            <button className="new-session" type="button" disabled={loading} onClick={startNewSession}>
              <Plus size={16} />
              New session
            </button>

            <nav className="workspace-list">
              {Object.entries(workspaces).map(([workspace, workspaceSessions]) => {
                const expanded = expandedWorkspaces.has(workspace);

                return (
                  <section className="workspace-group" key={workspace}>
                    <button
                      className="workspace-button"
                      type="button"
                      aria-expanded={expanded}
                      onClick={() => toggleWorkspace(workspace)}
                    >
                      {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
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
                              disabled={loading}
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
              })}
              {sessions.length === 0 && <p className="empty-sidebar">No sessions yet</p>}
            </nav>
          </>
        )}
      </aside>

      <section className="chat-area" aria-label="AI conversation">
        <header className="chat-header">
          <div>
            <span className="section-label">Session</span>
            <h1>{activeSession?.title ?? 'New session'}</h1>
            {activeSession?.summary && <p className="session-progress">{activeSession.summary}</p>}
          </div>
        </header>

        <div className="message-stream" ref={messageStreamRef} role="log" aria-live="polite">
          {!activeSession && (
            <div className="empty-state">
              <h2>Start a TRAEX-backed AI session</h2>
              <p>Pick a workspace path, type the initial prompt, and the backend will create a persistent session.</p>
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
              <article className={`message ${message.role} ${isTrace ? 'trace' : ''}`} key={message.id}>
                <div className="message-avatar">{isTrace ? <ClipboardList size={17} /> : message.role === 'assistant' ? 'AI' : 'You'}</div>
                <div className="message-body">
                  <div className="message-meta">
                    <strong>{getMessageTitle(message)}</strong>
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

          {loading && <p className="loading-line">Waiting for TRAEX...</p>}
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
            placeholder={activeSession ? 'Continue this session...' : 'Start with an initial prompt...'}
            rows={1}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
                lastEnterKeyDownRef.current = null;
                return;
              }

              const previousEnterKeyDown = lastEnterKeyDownRef.current;
              lastEnterKeyDownRef.current = event.timeStamp;

              if (
                previousEnterKeyDown !== null &&
                event.timeStamp - previousEnterKeyDown < 500 &&
                !loading &&
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
            disabled={loading}
          >
            <Send size={18} />
            <span>Send</span>
          </button>
        </form>
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
