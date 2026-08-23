import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import {
  ChevronDown,
  ChevronRight,
  Circle,
  FileText,
  Hash,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
} from "lucide-react";
import { formatRelativeTime } from "../../../shared/lib/dates";
import type { SessionSummary } from "../../../types";
import type { ReviewNavigation, ReviewNavigationTarget } from "../../review/model/reviewNavigation";
import {
  groupWorkspacesForDisplay,
  type WorkspaceDisplayGroup,
  type WorkspaceDisplayItem,
} from "../model/sessionSummaries";
import {
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  clampSidebarWidth,
} from "../model/sessionBrowserState";

type SessionSidebarProps = {
  open: boolean;
  width: number;
  workspaces: Record<string, SessionSummary[]>;
  historyWorkspaces: Record<string, SessionSummary[]>;
  expandedWorkspaces: Set<string>;
  historyOpen: boolean;
  sessionCount: number;
  historySessionCount: number;
  activeSessionId?: string;
  runningSessionIds: Set<string>;
  reviewNavigation?: ReviewNavigation | null;
  reviewNavigationActive?: boolean;
  onOpenChange: (open: boolean) => void;
  onWidthChange: (width: number) => void;
  onHistoryOpenChange: (open: boolean) => void;
  onStartNewSession: (workspace?: string) => void;
  onToggleWorkspace: (workspace: string) => void;
  onOpenSession: (sessionId: string) => void;
  onNavigateReview?: (target: ReviewNavigationTarget) => void;
};

export function SessionSidebar({
  open,
  width,
  workspaces,
  historyWorkspaces,
  expandedWorkspaces,
  historyOpen,
  sessionCount,
  historySessionCount,
  activeSessionId,
  runningSessionIds,
  reviewNavigation,
  reviewNavigationActive,
  onOpenChange,
  onWidthChange,
  onHistoryOpenChange,
  onStartNewSession,
  onToggleWorkspace,
  onOpenSession,
  onNavigateReview,
}: SessionSidebarProps) {
  const workspaceGroups = groupWorkspacesForDisplay(workspaces);
  const historyWorkspaceGroups = groupWorkspacesForDisplay(historyWorkspaces);
  const resizeHandleRef = useRef<HTMLDivElement | null>(null);
  const resizeStartRef = useRef({ pointerId: 0, startX: 0, startWidth: width });
  const [resizing, setResizing] = useState(false);

  function startResize(event: PointerEvent<HTMLDivElement>) {
    if (!open || event.button !== 0) {
      return;
    }

    event.preventDefault();
    resizeStartRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: width,
    };
    resizeHandleRef.current?.setPointerCapture(event.pointerId);
    setResizing(true);
  }

  function resize(event: PointerEvent<HTMLDivElement>) {
    if (!resizing || event.pointerId !== resizeStartRef.current.pointerId) {
      return;
    }

    const delta = event.clientX - resizeStartRef.current.startX;

    onWidthChange(resizeStartRef.current.startWidth + delta);
  }

  function stopResize(event: PointerEvent<HTMLDivElement>) {
    if (!resizing || event.pointerId !== resizeStartRef.current.pointerId) {
      return;
    }

    if (resizeHandleRef.current?.hasPointerCapture(event.pointerId)) {
      resizeHandleRef.current.releasePointerCapture(event.pointerId);
    }
    setResizing(false);
  }

  function resizeWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 48 : 16;

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      onWidthChange(width - step);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      onWidthChange(width + step);
    } else if (event.key === "Home") {
      event.preventDefault();
      onWidthChange(SIDEBAR_MIN_WIDTH);
    } else if (event.key === "End") {
      event.preventDefault();
      onWidthChange(SIDEBAR_MAX_WIDTH);
    }
  }

  return (
    <aside className={`sidebar ${resizing ? "is-resizing" : ""}`} aria-label="Workspace sessions">
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
          aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
          title={open ? "Collapse sidebar" : "Expand sidebar"}
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
              <button className="new-session" type="button" onClick={() => onStartNewSession()}>
                <Plus size={16} />
                New session
              </button>

              <nav className="workspace-list">
                <WorkspaceGroupList
                  activeSessionId={activeSessionId}
                  expandedWorkspaces={expandedWorkspaces}
                  groups={workspaceGroups}
                  runningSessionIds={runningSessionIds}
                  onOpenSession={onOpenSession}
                  onStartNewSession={onStartNewSession}
                  onToggleWorkspace={onToggleWorkspace}
                />
                {historySessionCount > 0 && (
                  <details className="session-history" open={historyOpen}>
                    <summary
                      className="session-history-summary"
                      onClick={(event) => {
                        event.preventDefault();
                        onHistoryOpenChange(!historyOpen);
                      }}
                    >
                      <span>History</span>
                      <small>{historySessionCount}</small>
                    </summary>
                    <div className="session-history-body">
                      <WorkspaceGroupList
                        activeSessionId={activeSessionId}
                        expandedWorkspaces={expandedWorkspaces}
                        groups={historyWorkspaceGroups}
                        runningSessionIds={runningSessionIds}
                        onOpenSession={onOpenSession}
                        onStartNewSession={onStartNewSession}
                        onToggleWorkspace={onToggleWorkspace}
                      />
                    </div>
                  </details>
                )}
                {sessionCount === 0 && <p className="empty-sidebar">No sessions yet</p>}
              </nav>
            </>
          )}
        </>
      )}
      {open && (
        <div
          className="sidebar-resize-handle"
          ref={resizeHandleRef}
          role="separator"
          tabIndex={0}
          aria-label="Resize sidebar"
          aria-orientation="vertical"
          aria-valuemin={SIDEBAR_MIN_WIDTH}
          aria-valuemax={SIDEBAR_MAX_WIDTH}
          aria-valuenow={clampSidebarWidth(width)}
          title="Resize sidebar"
          onKeyDown={resizeWithKeyboard}
          onPointerCancel={stopResize}
          onPointerDown={startResize}
          onPointerMove={resize}
          onPointerUp={stopResize}
        />
      )}
    </aside>
  );
}

function WorkspaceGroupList({
  activeSessionId,
  expandedWorkspaces,
  groups,
  runningSessionIds,
  onOpenSession,
  onStartNewSession,
  onToggleWorkspace,
}: {
  activeSessionId?: string;
  expandedWorkspaces: Set<string>;
  groups: WorkspaceDisplayGroup[];
  runningSessionIds: Set<string>;
  onOpenSession: (sessionId: string) => void;
  onStartNewSession: (workspace?: string) => void;
  onToggleWorkspace: (workspace: string) => void;
}) {
  return (
    <>
      {groups.map((workspaceGroup) => (
        <section className="workspace-display-group" key={workspaceGroup.id}>
          {workspaceGroup.prefix && (
            <div className="workspace-prefix" title={workspaceGroup.prefix}>
              {workspaceGroup.prefix}
            </div>
          )}
          {workspaceGroup.workspaces.map((workspace) => (
            <WorkspaceGroup
              activeSessionId={activeSessionId}
              expanded={expandedWorkspaces.has(workspace.workspace)}
              key={workspace.workspace}
              runningSessionIds={runningSessionIds}
              workspace={workspace}
              onOpenSession={onOpenSession}
              onStartNewSession={onStartNewSession}
              onToggleWorkspace={onToggleWorkspace}
            />
          ))}
        </section>
      ))}
    </>
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
      {!navigation && <p className="empty-sidebar">No sections yet.</p>}
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
              <span>
                {item.order}. {item.title}
              </span>
            </button>
            <div className="review-navigation-files">
              {item.files.map((file) => (
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
  workspace,
  onOpenSession,
  onStartNewSession,
  onToggleWorkspace,
}: {
  activeSessionId?: string;
  expanded: boolean;
  runningSessionIds: Set<string>;
  workspace: WorkspaceDisplayItem;
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
          aria-label={workspace.workspace}
          title={workspace.workspace}
          onClick={() => onToggleWorkspace(workspace.workspace)}
        >
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <span>{workspace.label}</span>
        </button>
        {expanded && (
          <button
            className="workspace-new-session"
            type="button"
            aria-label={`New session in ${workspace.workspace}`}
            title="New session in workspace"
            onClick={() => onStartNewSession(workspace.workspace)}
          >
            <Plus size={15} />
          </button>
        )}
      </div>

      {expanded && (
        <div className="session-list">
          {workspace.sessions.map((session) => {
            const active = activeSessionId === session.id;
            const isRunning = runningSessionIds.has(session.id) || session.isRunning;
            const hasUnreadRound = !isRunning && session.hasUnreadRound;
            const className = [
              "session-button",
              active ? "is-active" : "",
              isRunning ? "is-running-session" : "",
              hasUnreadRound ? "is-unread-session" : "",
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <button
                className={className}
                key={session.id}
                type="button"
                onClick={() => onOpenSession(session.id)}
              >
                <span className="session-title-row">
                  <span className="session-title">{session.title}</span>
                  {isRunning && (
                    <LoaderCircle className="session-running-icon" size={13} aria-hidden="true" />
                  )}
                  {hasUnreadRound && (
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
