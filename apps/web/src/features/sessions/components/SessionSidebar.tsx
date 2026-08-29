import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  FileText,
  Folder,
  FolderOpen,
  Hash,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
} from "lucide-react";
import { formatRelativeTime } from "../../../shared/lib/dates";
import type { SessionSummary } from "../../../types";
import type { ReviewNavigation, ReviewNavigationTarget } from "../../review/model/reviewNavigation";
import type { SessionListMode } from "../model/sessionBrowserState";
import {
  groupWorkspacesForDisplay,
  type WorkspaceDisplayItem,
  type WorkspaceTreeNode,
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
  sessionPage: number;
  sessionPageLoading: boolean;
  sessionTotalPages: number;
  visibleSessionCount: number;
  activeSessionId?: string;
  configOpen?: boolean;
  pendingDoneSessionIds: Set<string>;
  runningSessionIds: Set<string>;
  reviewNavigation?: ReviewNavigation | null;
  reviewNavigationActive?: boolean;
  onOpenChange: (open: boolean) => void;
  onWidthChange: (width: number) => void;
  onSessionListModeChange: (mode: SessionListMode) => void;
  onSessionPageChange: (page: number) => void;
  onStartNewSession: (workspace?: string) => void;
  onToggleWorkspace: (workspace: string) => void;
  onOpenSession: (sessionId: string) => void;
  onMarkSessionDone: (sessionId: string) => void;
  onNavigateReview?: (target: ReviewNavigationTarget) => void;
  onOpenConfig: () => void;
};

export function SessionSidebar({
  open,
  width,
  workspaces,
  expandedWorkspaces,
  sessionListMode,
  sessionCount,
  sessionPage,
  sessionPageLoading,
  sessionTotalPages,
  visibleSessionCount,
  activeSessionId,
  configOpen,
  pendingDoneSessionIds,
  runningSessionIds,
  reviewNavigation,
  reviewNavigationActive,
  onOpenChange,
  onWidthChange,
  onSessionListModeChange,
  onSessionPageChange,
  onStartNewSession,
  onToggleWorkspace,
  onOpenSession,
  onMarkSessionDone,
  onNavigateReview,
  onOpenConfig,
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

              <button
                className={`sidebar-nav-button ${configOpen ? "is-active" : ""}`}
                type="button"
                aria-current={configOpen ? "page" : undefined}
                onClick={onOpenConfig}
              >
                <Settings size={16} />
                Config
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
                  pendingDoneSessionIds={pendingDoneSessionIds}
                  sessionListMode={sessionListMode}
                  runningSessionIds={runningSessionIds}
                  onOpenSession={onOpenSession}
                  onMarkSessionDone={onMarkSessionDone}
                  onStartNewSession={onStartNewSession}
                  onToggleWorkspace={onToggleWorkspace}
                />
                {sessionCount === 0 && workspaceGroups.length === 0 && (
                  <p className="empty-sidebar">No sessions yet</p>
                )}
                {sessionCount > 0 && workspaceGroups.length === 0 && visibleSessionCount === 0 && (
                  <p className="empty-sidebar">
                    {sessionListMode === "active"
                      ? "No active sessions"
                      : "No sessions on this page"}
                  </p>
                )}
              </nav>
              {sessionListMode === "more" && (
                <div className="session-page-control" aria-label="Session pages">
                  <button
                    className="icon-button"
                    type="button"
                    aria-label="Previous session page"
                    title="Previous page"
                    disabled={sessionPage <= 1 || sessionPageLoading}
                    onClick={() => onSessionPageChange(sessionPage - 1)}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span>
                    {sessionPage} / {sessionTotalPages}
                  </span>
                  <button
                    className="icon-button"
                    type="button"
                    aria-label="Next session page"
                    title="Next page"
                    disabled={sessionPage >= sessionTotalPages || sessionPageLoading}
                    onClick={() => onSessionPageChange(sessionPage + 1)}
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              )}
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
  pendingDoneSessionIds,
  sessionListMode,
  runningSessionIds,
  onOpenSession,
  onMarkSessionDone,
  onStartNewSession,
  onToggleWorkspace,
}: {
  activeSessionId?: string;
  expandedWorkspaces: Set<string>;
  groups: WorkspaceTreeNode[];
  pendingDoneSessionIds: Set<string>;
  sessionListMode: SessionListMode;
  runningSessionIds: Set<string>;
  onOpenSession: (sessionId: string) => void;
  onMarkSessionDone: (sessionId: string) => void;
  onStartNewSession: (workspace?: string) => void;
  onToggleWorkspace: (workspace: string) => void;
}) {
  return (
    <div className="workspace-tree" role="tree">
      {groups.map((node) => (
        <WorkspaceTreeNodeView
          activeSessionId={activeSessionId}
          depth={0}
          expandedWorkspaces={expandedWorkspaces}
          key={node.id}
          node={node}
          pendingDoneSessionIds={pendingDoneSessionIds}
          runningSessionIds={runningSessionIds}
          sessionListMode={sessionListMode}
          onOpenSession={onOpenSession}
          onMarkSessionDone={onMarkSessionDone}
          onStartNewSession={onStartNewSession}
          onToggleWorkspace={onToggleWorkspace}
        />
      ))}
    </div>
  );
}

function WorkspaceTreeNodeView({
  activeSessionId,
  depth,
  expandedWorkspaces,
  node,
  pendingDoneSessionIds,
  runningSessionIds,
  sessionListMode,
  onOpenSession,
  onMarkSessionDone,
  onStartNewSession,
  onToggleWorkspace,
}: {
  activeSessionId?: string;
  depth: number;
  expandedWorkspaces: Set<string>;
  node: WorkspaceTreeNode;
  pendingDoneSessionIds: Set<string>;
  runningSessionIds: Set<string>;
  sessionListMode: SessionListMode;
  onOpenSession: (sessionId: string) => void;
  onMarkSessionDone: (sessionId: string) => void;
  onStartNewSession: (workspace?: string) => void;
  onToggleWorkspace: (workspace: string) => void;
}) {
  const workspace = node.workspace;
  const expanded = workspace ? expandedWorkspaces.has(workspace.workspace) : true;
  const hasChildren = node.children.length > 0;

  return (
    <section
      className="workspace-tree-node"
      role="treeitem"
      aria-expanded={hasChildren ? true : expanded}
    >
      {workspace ? (
        <WorkspaceGroup
          activeSessionId={activeSessionId}
          depth={depth}
          expanded={expanded}
          runningSessionIds={runningSessionIds}
          pendingDoneSessionIds={pendingDoneSessionIds}
          sessionListMode={sessionListMode}
          workspace={workspace}
          label={node.label}
          onOpenSession={onOpenSession}
          onMarkSessionDone={onMarkSessionDone}
          onStartNewSession={onStartNewSession}
          onToggleWorkspace={onToggleWorkspace}
        />
      ) : (
        <div
          className="workspace-directory-row"
          style={{ "--workspace-depth": depth } as CSSProperties}
        >
          <Folder size={15} aria-hidden="true" />
          <span title={node.path}>{node.label}</span>
        </div>
      )}
      {hasChildren && (
        <div className="workspace-tree-children" role="group">
          {node.children.map((child) => (
            <WorkspaceTreeNodeView
              activeSessionId={activeSessionId}
              depth={depth + 1}
              expandedWorkspaces={expandedWorkspaces}
              key={child.id}
              node={child}
              pendingDoneSessionIds={pendingDoneSessionIds}
              runningSessionIds={runningSessionIds}
              sessionListMode={sessionListMode}
              onOpenSession={onOpenSession}
              onMarkSessionDone={onMarkSessionDone}
              onStartNewSession={onStartNewSession}
              onToggleWorkspace={onToggleWorkspace}
            />
          ))}
        </div>
      )}
    </section>
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
  depth,
  expanded,
  label,
  runningSessionIds,
  pendingDoneSessionIds,
  sessionListMode,
  workspace,
  onOpenSession,
  onMarkSessionDone,
  onStartNewSession,
  onToggleWorkspace,
}: {
  activeSessionId?: string;
  depth: number;
  expanded: boolean;
  label: string;
  runningSessionIds: Set<string>;
  pendingDoneSessionIds: Set<string>;
  sessionListMode: SessionListMode;
  workspace: WorkspaceDisplayItem;
  onOpenSession: (sessionId: string) => void;
  onMarkSessionDone: (sessionId: string) => void;
  onStartNewSession: (workspace?: string) => void;
  onToggleWorkspace: (workspace: string) => void;
}) {
  const useSeparateToggle = sessionListMode === "active";

  return (
    <section className="workspace-group" style={{ "--workspace-depth": depth } as CSSProperties}>
      <div className={`workspace-row ${useSeparateToggle ? "has-workspace-toggle" : ""}`}>
        {useSeparateToggle ? (
          <>
            <div
              className="workspace-label"
              aria-label={workspace.workspace}
              title={workspace.workspace}
            >
              {expanded ? <FolderOpen size={15} /> : <Folder size={15} />}
              <span>{label}</span>
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
            {expanded ? <FolderOpen size={15} /> : <Folder size={15} />}
            <span>{label}</span>
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
            const isDone = Boolean(session.doneAt) || pendingDoneSessionIds.has(session.id);
            const className = [
              "session-button",
              active ? "is-active" : "",
              isRunning ? "is-running-session" : "",
              hasUnreadRound ? "is-unread-session" : "",
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <div className="session-list-row" key={session.id}>
                <button
                  className={className}
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
                <button
                  className={`session-done-button ${isDone ? "is-done" : ""}`}
                  type="button"
                  aria-label="Mark session done"
                  aria-pressed={isDone}
                  title={isDone ? `${session.title} is done` : `Mark ${session.title} done`}
                  onClick={() => onMarkSessionDone(session.id)}
                >
                  {isDone ? <Check size={13} aria-hidden="true" /> : <span aria-hidden="true" />}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
