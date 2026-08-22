import {
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Send,
} from 'lucide-react';
import { FormEvent, StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

type ApiMessage = {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  createdAt: string;
};

type ApiSession = {
  id: string;
  workspace: string;
  title: string;
  summary?: string;
  createdAt: string;
  updatedAt: string;
  messages: ApiMessage[];
};

type SessionSummary = {
  id: string;
  workspace: string;
  title: string;
  summary?: string;
  updatedAt: string;
};

type SubmittedTurn = {
  status: 'ok';
  session: ApiSession;
  turnId: string;
};

type TurnStreamEvent =
  | {
      type: 'delta';
      text: string;
    }
  | {
      type: 'done';
      session: ApiSession;
    }
  | {
      type: 'failed';
      error: string;
    };

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
  const eventSourceRef = useRef<EventSource | null>(null);

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
    const streamingMessageId = `stream-${turnId}`;
    let streamedText = '';
    let streamClosed = false;

    const appendDelta = (text: string) => {
      if (!text) {
        return;
      }

      streamedText += text;
      setActiveSession((session) => {
        if (!session) {
          return session;
        }

        const existingMessage = session.messages.find((message) => message.id === streamingMessageId);

        if (existingMessage) {
          return {
            ...session,
            messages: session.messages.map((message) =>
              message.id === streamingMessageId ? { ...message, content: streamedText } : message,
            ),
          };
        }

        return {
          ...session,
          messages: [
            ...session.messages,
            {
              id: streamingMessageId,
              role: 'assistant',
              content: streamedText,
              createdAt: new Date().toISOString(),
            },
          ],
        };
      });
    };

    eventSource.addEventListener('delta', (event) => {
      const data = parseMessageEvent(event);

      if (data?.type === 'delta') {
        appendDelta(data.text);
      }
    });

    eventSource.addEventListener('done', (event) => {
      const data = parseMessageEvent(event);

      if (data?.type !== 'done') {
        return;
      }

      setActiveSession(data.session);
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
          <div className="model-pill">GPT workspace</div>
        </header>

        <div className="message-stream" role="log" aria-live="polite">
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

          {activeSession?.messages.map((message) => (
            <article className={`message ${message.role}`} key={message.id}>
              <div className="message-avatar">{message.role === 'assistant' ? 'AI' : 'You'}</div>
              <div className="message-body">
                <div className="message-meta">
                  <strong>{message.role === 'assistant' ? 'Assistant' : 'You'}</strong>
                  <time>{formatMessageTime(message.createdAt)}</time>
                </div>
                <p>{message.content}</p>
              </div>
            </article>
          ))}

          {loading && <p className="loading-line">Waiting for TRAEX...</p>}
          {error && <p className="error-line">{error}</p>}
        </div>

        <form className="composer" onSubmit={handleSubmit}>
          <label className="sr-only" htmlFor="message-input">
            Message
          </label>
          <textarea
            id="message-input"
            value={draft}
            placeholder={activeSession ? 'Continue this session...' : 'Start with an initial prompt...'}
            rows={1}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !loading) {
                event.preventDefault();
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
