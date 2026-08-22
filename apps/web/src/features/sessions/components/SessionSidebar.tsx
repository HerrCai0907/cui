import {
  ChevronDown,
  ChevronRight,
  Circle,
  FileText,
  Hash,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
} from 'lucide-react';
import { formatRelativeTime } from '../../../shared/lib/dates';
import type { SessionSummary } from '../../../types';
import type {
  ReviewNavigation,
  ReviewNavigationTarget,
} from '../../review/model/reviewNavigation';

type SessionSidebarProps = {
  open: boolean;
  workspaces: Record<string, SessionSummary[]>;
  expandedWorkspaces: Set<string>;
  sessionCount: number;
  activeSessionId?: string;
  runningSessionIds: Set<string>;
  reviewNavigation?: ReviewNavigation | null;
  reviewNavigationActive?: boolean;
  onOpenChange: (open: boolean) => void;
  onStartNewSession: (workspace?: string) => void;
  onToggleWorkspace: (workspace: string) => void;
  onOpenSession: (sessionId: string) => void;
  onNavigateReview?: (target: ReviewNavigationTarget) => void;
};

export function SessionSidebar({
  open,
  workspaces,
  expandedWorkspaces,
  sessionCount,
  activeSessionId,
  runningSessionIds,
  reviewNavigation,
  reviewNavigationActive,
  onOpenChange,
  onStartNewSession,
  onToggleWorkspace,
  onOpenSession,
  onNavigateReview,
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
          {reviewNavigationActive ? (
            <ReviewNavigationTree
              navigation={reviewNavigation}
              onNavigate={onNavigateReview ?? (() => undefined)}
            />
          ) : (
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
                    runningSessionIds={runningSessionIds}
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
        </>
      )}
    </aside>
  );
}

function ReviewNavigationTree({
  navigation,
  onNavigate,
}: {
  navigation?: ReviewNavigation | null;
  onNavigate: (target: ReviewNavigationTarget) => void;
}) {
  return (
    <nav className="review-navigation" aria-label="Atomic review navigation">
      <div className="review-navigation-root">
        <span>Atomic Review</span>
        <small>{navigation?.items.length ?? 0}</small>
      </div>
      {!navigation && (
        <p className="empty-sidebar">No sections yet.</p>
      )}
      <div className="review-navigation-list">
        {navigation?.items.map((item) => (
          <section className="review-navigation-item" key={item.itemId}>
            <button
              className="review-navigation-atomic"
              type="button"
              onClick={() =>
                onNavigate({
                  itemId: item.itemId,
                  targetId: item.targetId,
                })
              }
            >
              <Hash size={14} />
              <span>{item.order}. {item.title}</span>
            </button>
            {item.statusGroups.map((group) => (
              <div className="review-navigation-status" key={group.status}>
                <div className="review-navigation-status-label">
                  <Circle size={8} />
                  <span>{group.label}</span>
                  <small>{group.files.length}</small>
                </div>
                <div className="review-navigation-files">
                  {group.files.map((file) => (
                    <button
                      className="review-navigation-file"
                      type="button"
                      key={file.id}
                      title={file.path}
                      onClick={() =>
                        onNavigate({
                          itemId: item.itemId,
                          targetId: file.targetId,
                        })
                      }
                    >
                      <FileText size={13} />
                      <span>{file.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </section>
        ))}
      </div>
    </nav>
  );
}

function WorkspaceGroup({
  activeSessionId,
  expanded,
  runningSessionIds,
  sessions,
  workspace,
  onOpenSession,
  onStartNewSession,
  onToggleWorkspace,
}: {
  activeSessionId?: string;
  expanded: boolean;
  runningSessionIds: Set<string>;
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
            const needsAttention =
              runningSessionIds.has(session.id) ||
              session.isRunning ||
              session.hasUnreadRound;
            const className = [
              'session-button',
              active ? 'is-active' : '',
              needsAttention ? 'is-active-session' : '',
            ]
              .filter(Boolean)
              .join(' ');

            return (
              <button
                className={className}
                key={session.id}
                type="button"
                onClick={() => onOpenSession(session.id)}
              >
                <span className="session-title-row">
                  <span className="session-title">{session.title}</span>
                  {needsAttention && (
                    <Circle
                      className="session-status-dot"
                      size={8}
                      aria-hidden="true"
                      fill="currentColor"
                    />
                  )}
                </span>
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
