import {
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
} from 'lucide-react';
import { formatRelativeTime } from '../../../shared/lib/dates';
import type { SessionSummary } from '../../../types';

type SessionSidebarProps = {
  open: boolean;
  workspaces: Record<string, SessionSummary[]>;
  expandedWorkspaces: Set<string>;
  sessionCount: number;
  activeSessionId?: string;
  onOpenChange: (open: boolean) => void;
  onStartNewSession: (workspace?: string) => void;
  onToggleWorkspace: (workspace: string) => void;
  onOpenSession: (sessionId: string) => void;
};

export function SessionSidebar({
  open,
  workspaces,
  expandedWorkspaces,
  sessionCount,
  activeSessionId,
  onOpenChange,
  onStartNewSession,
  onToggleWorkspace,
  onOpenSession,
}: SessionSidebarProps) {
  return (
    <aside className="sidebar" aria-label="Workspace sessions">
      <div className="sidebar-header">
        {open && (
          <div>
            <strong>CUI</strong>
            <span>Workspaces</span>
          </div>
        )}
        <button
          className="icon-button"
          type="button"
          aria-label={open ? 'Collapse sidebar' : 'Expand sidebar'}
          title={open ? 'Collapse sidebar' : 'Expand sidebar'}
          onClick={() => onOpenChange(!open)}
        >
          {open ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
        </button>
      </div>

      {open && (
        <>
          <button
            className="new-session"
            type="button"
            onClick={() => onStartNewSession()}
          >
            <Plus size={16} />
            New session
          </button>

          <nav className="workspace-list">
            {Object.entries(workspaces).map(([workspace, workspaceSessions]) => (
              <WorkspaceGroup
                activeSessionId={activeSessionId}
                expanded={expandedWorkspaces.has(workspace)}
                key={workspace}
                sessions={workspaceSessions}
                workspace={workspace}
                onOpenSession={onOpenSession}
                onStartNewSession={onStartNewSession}
                onToggleWorkspace={onToggleWorkspace}
              />
            ))}
            {sessionCount === 0 && (
              <p className="empty-sidebar">No sessions yet</p>
            )}
          </nav>
        </>
      )}
    </aside>
  );
}

function WorkspaceGroup({
  activeSessionId,
  expanded,
  sessions,
  workspace,
  onOpenSession,
  onStartNewSession,
  onToggleWorkspace,
}: {
  activeSessionId?: string;
  expanded: boolean;
  sessions: SessionSummary[];
  workspace: string;
  onOpenSession: (sessionId: string) => void;
  onStartNewSession: (workspace?: string) => void;
  onToggleWorkspace: (workspace: string) => void;
}) {
  return (
    <section className="workspace-group">
      <div className="workspace-row">
        <button
          className="workspace-button"
          type="button"
          aria-expanded={expanded}
          onClick={() => onToggleWorkspace(workspace)}
        >
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <span>{workspace}</span>
        </button>
        {expanded && (
          <button
            className="workspace-new-session"
            type="button"
            aria-label={`New session in ${workspace}`}
            title="New session in workspace"
            onClick={() => onStartNewSession(workspace)}
          >
            <Plus size={15} />
          </button>
        )}
      </div>

      {expanded && (
        <div className="session-list">
          {sessions.map((session) => {
            const active = activeSessionId === session.id;

            return (
              <button
                className={`session-button ${active ? 'is-active' : ''}`}
                key={session.id}
                type="button"
                onClick={() => onOpenSession(session.id)}
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
}
