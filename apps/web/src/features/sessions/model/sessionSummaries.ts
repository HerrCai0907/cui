import type { ApiSession, ApiSessionListItem, SessionSummary } from "../../../types";
import { getLastSeenRound, type SessionAttentionState } from "./sessionBrowserState";

export type WorkspaceDisplayItem = {
  workspace: string;
  sessions: SessionSummary[];
};

export type WorkspaceTreeNode = {
  id: string;
  label: string;
  path: string;
  workspace?: WorkspaceDisplayItem;
  children: WorkspaceTreeNode[];
};

export type ActiveSidebarSessionPartition = {
  active: SessionSummary[];
  activeWorkspaces: string[];
  more: SessionSummary[];
};

export const ACTIVE_RECENT_SESSION_COUNT_PER_WORKSPACE = 1;
export const ACTIVE_RECENT_WORKSPACE_COUNT = 6;

export function toSessionSummary(session: ApiSession | ApiSessionListItem): SessionSummary {
  const lastSeenRound = getLastSeenRound(session.id);
  const currentRound = getCurrentRound(session);

  return {
    id: session.id,
    workspace: session.workspace,
    title: session.title,
    summary: session.summary,
    doneAt: session.doneAt,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    currentRound,
    queuedPrompts: session.queuedPrompts,
    isRunning: session.isRunning ?? Boolean(session.runningTurnId),
    hasUnreadRound: lastSeenRound !== null && lastSeenRound !== currentRound,
  };
}

export function groupSessionsByWorkspace(
  sessions: SessionSummary[],
): Record<string, SessionSummary[]> {
  return sessions.reduce<Record<string, SessionSummary[]>>((groups, session) => {
    groups[session.workspace] = groups[session.workspace] ?? [];
    groups[session.workspace].push(session);

    return groups;
  }, {});
}

export function partitionActiveSessionsForSidebar(
  sessions: SessionSummary[],
  attentionState: SessionAttentionState,
  highlightedSessionIds: Set<string> = new Set(),
  highlightedWorkspaceIds: Set<string> = new Set(),
  recentWorkspaceCount = ACTIVE_RECENT_WORKSPACE_COUNT,
): ActiveSidebarSessionPartition {
  const activeCandidateSessions = sessions.filter((session) => !session.doneAt);
  const activeSidebarSessionIds = new Set<string>();
  const sessionsByWorkspace = groupSessionsByWorkspace(sessions);
  const activeCandidateSessionsByWorkspace = groupSessionsByWorkspace(activeCandidateSessions);
  const activeWorkspaceIds = new Set(highlightedWorkspaceIds);

  Object.entries(sessionsByWorkspace).forEach(([workspace, workspaceSessions]) => {
    if (
      workspaceSessions.some(
        (session) =>
          highlightedSessionIds.has(session.id) || session.isRunning || session.hasUnreadRound,
      )
    ) {
      activeWorkspaceIds.add(workspace);
    }
  });

  Object.keys(sessionsByWorkspace)
    .filter((workspace) => (attentionState.workspaces[workspace] ?? 0) > 0)
    .sort((left, right) => compareWorkspacesByAttention(left, right, attentionState))
    .slice(0, recentWorkspaceCount)
    .forEach((workspace) => {
      activeWorkspaceIds.add(workspace);
    });

  Object.entries(activeCandidateSessionsByWorkspace).forEach(([workspace, workspaceSessions]) => {
    if (!activeWorkspaceIds.has(workspace)) {
      return;
    }

    workspaceSessions.forEach((session) => {
      if (highlightedSessionIds.has(session.id) || session.isRunning || session.hasUnreadRound) {
        activeSidebarSessionIds.add(session.id);
      }
    });

    workspaceSessions
      .filter((session) => !activeSidebarSessionIds.has(session.id))
      .sort((left, right) => compareSessionsByAttention(left, right, attentionState))
      .slice(0, ACTIVE_RECENT_SESSION_COUNT_PER_WORKSPACE)
      .forEach((session) => {
        activeSidebarSessionIds.add(session.id);
      });
  });

  return {
    active: sortSessionsForActiveSidebar(
      activeCandidateSessions.filter((session) => activeSidebarSessionIds.has(session.id)),
    ),
    activeWorkspaces: sortActiveWorkspaces([...activeWorkspaceIds]),
    more: sortSessionsForAllSessions(sessions, attentionState),
  };
}

function sortActiveWorkspaces(workspaces: string[]): string[] {
  return [...workspaces].sort((left, right) => left.localeCompare(right));
}

export function sortSessionsForActiveSidebar(sessions: SessionSummary[]): SessionSummary[] {
  return [...sessions].sort((left, right) => {
    const workspaceOrder = left.workspace.localeCompare(right.workspace);

    if (workspaceOrder !== 0) {
      return workspaceOrder;
    }

    const createdAtOrder = right.createdAt.localeCompare(left.createdAt);

    return createdAtOrder !== 0 ? createdAtOrder : right.id.localeCompare(left.id);
  });
}

export function sortSessionsForAllSessions(
  sessions: SessionSummary[],
  attentionState: SessionAttentionState,
): SessionSummary[] {
  return [...sessions].sort((left, right) => {
    const leftAttention = getSessionAttention(left, attentionState);
    const rightAttention = getSessionAttention(right, attentionState);
    const attentionOrder = rightAttention - leftAttention;

    if (attentionOrder !== 0) {
      return attentionOrder;
    }

    return compareSessionsByUpdatedAt(left, right);
  });
}

export function getCurrentRound(session: ApiSession | ApiSessionListItem): number {
  if (Number.isInteger(session.currentRound) && session.currentRound >= 0) {
    return session.currentRound;
  }

  if (!("messages" in session)) {
    return 0;
  }

  const storedRound = Math.max(0, ...(session.rounds?.map(({ round }) => round) ?? []));
  const messageRound = Math.max(
    0,
    ...session.messages
      .map(({ round }) => round ?? 0)
      .filter((round) => Number.isInteger(round) && round > 0),
  );
  const completedTurnCount = Math.max(
    countAssistantMessages(session, "trace"),
    countAssistantMessages(session, "response"),
  );

  return Math.max(storedRound, messageRound, completedTurnCount);
}

function countAssistantMessages(session: ApiSession, kind: "response" | "trace"): number {
  return session.messages.filter((message) => message.role === "assistant" && message.kind === kind)
    .length;
}

function compareSessionsByUpdatedAt(left: SessionSummary, right: SessionSummary): number {
  const updatedAtOrder = right.updatedAt.localeCompare(left.updatedAt);

  return updatedAtOrder !== 0 ? updatedAtOrder : right.id.localeCompare(left.id);
}

function compareSessionsByAttention(
  left: SessionSummary,
  right: SessionSummary,
  attentionState: SessionAttentionState,
): number {
  const attentionOrder =
    getSessionAttention(right, attentionState) - getSessionAttention(left, attentionState);

  if (attentionOrder !== 0) {
    return attentionOrder;
  }

  return compareSessionsByUpdatedAt(left, right);
}

function getSessionAttention(
  session: SessionSummary,
  attentionState: SessionAttentionState,
): number {
  return attentionState.sessions[session.id] ?? 0;
}

function compareWorkspacesByAttention(
  left: string,
  right: string,
  attentionState: SessionAttentionState,
): number {
  const attentionOrder =
    (attentionState.workspaces[right] ?? 0) - (attentionState.workspaces[left] ?? 0);

  if (attentionOrder !== 0) {
    return attentionOrder;
  }

  return left.localeCompare(right);
}

export function groupWorkspacesForDisplay(
  workspaces: Record<string, SessionSummary[]>,
): WorkspaceTreeNode[] {
  const roots = new Map<string, WorkspaceTreeBuildNode>();

  Object.entries(workspaces).forEach(([workspace, sessions]) => {
    const parsed = parseWorkspacePath(workspace);
    const item = {
      workspace,
      sessions,
    };

    insertWorkspacePath(roots, parsed, item);
  });

  return sortTreeNodes([...roots.values()].map(compressWorkspaceTreeNode));
}

type ParsedWorkspacePath = {
  root: string;
  segments: string[];
};

type WorkspacePathItem = {
  workspace: string;
  sessions: SessionSummary[];
};

type WorkspaceTreeBuildNode = Omit<WorkspaceTreeNode, "children"> & {
  children: Map<string, WorkspaceTreeBuildNode>;
};

function createWorkspaceTreeBuildNode(
  id: string,
  label: string,
  path: string,
): WorkspaceTreeBuildNode {
  return {
    id,
    label,
    path,
    workspace: undefined,
    children: new Map(),
  };
}

function getOrCreateTreeChild(
  children: Map<string, WorkspaceTreeBuildNode>,
  id: string,
  label: string,
  path: string,
): WorkspaceTreeBuildNode {
  const existing = children.get(id);

  if (existing) {
    return existing;
  }

  const child = createWorkspaceTreeBuildNode(id, label, path);

  children.set(id, child);

  return child;
}

function insertWorkspacePath(
  roots: Map<string, WorkspaceTreeBuildNode>,
  parsed: ParsedWorkspacePath,
  item: WorkspacePathItem,
) {
  let children = roots;
  let current: WorkspaceTreeBuildNode | undefined;

  if (parsed.root) {
    current = getOrCreateTreeChild(roots, parsed.root, parsed.root, parsed.root);
    children = current.children;
  }

  parsed.segments.forEach((segment, index) => {
    const path = formatWorkspacePath(parsed.root, parsed.segments.slice(0, index + 1));

    current = getOrCreateTreeChild(children, path, segment, path);
    children = current.children;
  });

  if (current) {
    current.workspace = item;
    return;
  }

  const relativeRoot = getOrCreateTreeChild(roots, item.workspace, item.workspace, item.workspace);

  relativeRoot.workspace = item;
}

function parseWorkspacePath(workspace: string): ParsedWorkspacePath {
  const trimmed = workspace.trim();
  const withoutTrailingSeparators = trimmed.replace(/[\\/]+$/g, "") || trimmed;
  const windowsMatch = /^([A-Za-z]:)[\\/]*(.*)$/.exec(withoutTrailingSeparators);

  if (windowsMatch) {
    return {
      root: `${windowsMatch[1]}/`,
      segments: splitPathSegments(windowsMatch[2]),
    };
  }

  if (withoutTrailingSeparators.startsWith("/")) {
    return {
      root: "/",
      segments: splitPathSegments(withoutTrailingSeparators.slice(1)),
    };
  }

  return {
    root: "",
    segments: splitPathSegments(withoutTrailingSeparators),
  };
}

function splitPathSegments(path: string): string[] {
  return path.split(/[\\/]+/).filter(Boolean);
}

function formatWorkspacePath(root: string, segments: string[]): string {
  if (root === "/") {
    return segments.length > 0 ? `/${segments.join("/")}` : root;
  }

  return `${root}${segments.join("/")}`;
}

function compressWorkspaceTreeNode(node: WorkspaceTreeBuildNode): WorkspaceTreeBuildNode {
  let compressed = {
    ...node,
    children: new Map(
      [...node.children.entries()].map(([key, child]) => [key, compressWorkspaceTreeNode(child)]),
    ),
  };

  while (!compressed.workspace && compressed.children.size === 1) {
    const child = [...compressed.children.values()][0];

    compressed = {
      id: child.id,
      label: joinCompressedPathLabels(compressed.label, child.label),
      path: child.path,
      workspace: child.workspace,
      children: child.children,
    };
  }

  return compressed;
}

function joinCompressedPathLabels(parent: string, child: string): string {
  if (parent === "/") {
    return `/${child}`;
  }

  if (parent.endsWith("/")) {
    return `${parent}${child}`;
  }

  return `${parent}/${child}`;
}

function sortTreeNodes(nodes: WorkspaceTreeBuildNode[]): WorkspaceTreeNode[] {
  return nodes
    .map((node) => ({
      id: node.id,
      label: node.label,
      path: node.path,
      workspace: node.workspace,
      children: sortTreeNodes([...node.children.values()]),
    }))
    .sort((left, right) => {
      const directoryOrder = Number(!right.workspace) - Number(!left.workspace);

      return directoryOrder !== 0 ? directoryOrder : left.label.localeCompare(right.label);
    });
}
