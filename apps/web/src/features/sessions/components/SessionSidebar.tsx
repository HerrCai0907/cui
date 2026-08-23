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
import type { SessionListMode } from "../model/sessionBrowserState";
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
  expandedWorkspaces: Set<string>;
  sessionListMode: SessionListMode;
  sessionCount: number;
  visibleSessionCount: number;
  activeSessionId?: string;
  runningSessionIds: Set<string>;
  reviewNavigation?: ReviewNavigation | null;
  reviewNavigationActive?: boolean;
  onOpenChange: (open: boolean) => void;
  onWidthChange: (width: number) => void;
  onSessionListModeChange: (mode: SessionListMode) => void;
  onStartNewSession: (workspace?: string) => void;
  onToggleWorkspace: (workspace: string) => void;
  onOpenSession: (sessionId: string) => void;
  onNavigateReview?: (target: ReviewNavigationTarget) => void;
};

export function SessionSidebar({
  open,
  width,
  workspaces,
  expandedWorkspaces,
  sessionListMode,
  sessionCount,
  visibleSessionCount,
  activeSessionId,
  runningSessionIds,
  reviewNavigation,
  reviewNavigationActive,
  onOpenChange,
  onWidthChange,
  onSessionListModeChange,
  onStartNewSession,
  onToggleWorkspace,
  onOpenSession,
  onNavigateReview,
}: SessionSidebarProps) {
  const workspaceGroups = groupWorkspacesForDisplay(workspaces);
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
            <strong>Coding Assistant</strong>
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

              <div className="session-mode-switch" role="group" aria-label="Session list mode">
                <button
                  className={sessionListMode === "active" ? "is-selected" : ""}
                  type="button"
                  aria-pressed={sessionListMode === "active"}
                  onClick={() => onSessionListModeChange("active")}
                >
                  Active
                </button>
                <button
                  className={sessionListMode === "more" ? "is-selected" : ""}
                  type="button"
                  aria-pressed={sessionListMode === "more"}
                  onClick={() => onSessionListModeChange("more")}
                >
                  More
                </button>
              </div>

              <nav className="workspace-list">
                <WorkspaceGroupList
                  activeSessionId={activeSessionId}
                  expandedWorkspaces={expandedWorkspaces}
                  groups={workspaceGroups}
                  sessionListMode={sessionListMode}
                  runningSessionIds={runningSessionIds}
                  onOpenSession={onOpenSession}
                  onStartNewSession={onStartNewSession}
                  onToggleWorkspace={onToggleWorkspace}
                />
                {sessionCount === 0 && <p className="empty-sidebar">No sessions yet</p>}
                {sessionCount > 0 && visibleSessionCount === 0 && (
                  <p className="empty-sidebar">No active sessions</p>
                )}
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
  sessionListMode,
  runningSessionIds,
  onOpenSession,
  onStartNewSession,
  onToggleWorkspace,
}: {
  activeSessionId?: string;
  expandedWorkspaces: Set<string>;
  groups: WorkspaceDisplayGroup[];
  sessionListMode: SessionListMode;
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
              sessionListMode={sessionListMode}
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
  sessionListMode,
  workspace,
  onOpenSession,
  onStartNewSession,
  onToggleWorkspace,
}: {
  activeSessionId?: string;
  expanded: boolean;
  runningSessionIds: Set<string>;
  sessionListMode: SessionListMode;
  workspace: WorkspaceDisplayItem;
  onOpenSession: (sessionId: string) => void;
  onStartNewSession: (workspace?: string) => void;
  onToggleWorkspace: (workspace: string) => void;
}) {
  const useSeparateToggle = sessionListMode === "active";

  return (
    <section className="workspace-group">
      <div className={`workspace-row ${useSeparateToggle ? "has-workspace-toggle" : ""}`}>
        {useSeparateToggle ? (
          <>
            <div
              className="workspace-label"
              aria-label={workspace.workspace}
              title={workspace.workspace}
            >
              <span>{workspace.label}</span>
            </div>
            <button
              className="workspace-toggle"
              type="button"
              aria-expanded={expanded}
              aria-label={`${expanded ? "Collapse" : "Expand"} ${workspace.workspace}`}
              title={expanded ? "Collapse workspace" : "Expand workspace"}
              onClick={() => onToggleWorkspace(workspace.workspace)}
            >
              {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            </button>
          </>
        ) : (
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
        )}
        <button
          className="workspace-new-session"
          type="button"
          aria-label={`New session in ${workspace.workspace}`}
          title="New session in workspace"
          onClick={() => onStartNewSession(workspace.workspace)}
        >
          <Plus size={15} />
        </button>
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
