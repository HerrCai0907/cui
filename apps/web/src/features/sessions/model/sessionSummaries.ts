import type { ApiSession, SessionSummary } from "../../../types";
import { getLastSeenRound, type SessionAttentionState } from "./sessionBrowserState";

export type WorkspaceDisplayItem = {
  workspace: string;
  label: string;
  sessions: SessionSummary[];
};

export type WorkspaceDisplayGroup = {
  id: string;
  prefix?: string;
  workspaces: WorkspaceDisplayItem[];
};

export type ActiveSidebarSessionPartition = {
  active: SessionSummary[];
  more: SessionSummary[];
};

export const ACTIVE_RECENT_SESSION_COUNT_PER_WORKSPACE = 1;
export const ACTIVE_RECENT_WORKSPACE_COUNT = 6;

export function toSessionSummary(session: ApiSession): SessionSummary {
  const lastSeenRound = getLastSeenRound(session.id);
  const currentRound = getCurrentRound(session);

  return {
    id: session.id,
    workspace: session.workspace,
    title: session.title,
    summary: session.summary,
    updatedAt: session.updatedAt,
    currentRound,
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
  const activeSidebarSessionIds = new Set<string>();
  const sessionsByWorkspace = groupSessionsByWorkspace(sessions);
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

  Object.entries(sessionsByWorkspace).forEach(([workspace, workspaceSessions]) => {
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
      sessions.filter((session) => activeSidebarSessionIds.has(session.id)),
      attentionState,
      highlightedSessionIds,
    ),
    more: sortSessionsForAllSessions(sessions, attentionState),
  };
}

export function sortSessionsForActiveSidebar(
  sessions: SessionSummary[],
  attentionState: SessionAttentionState,
  highlightedSessionIds: Set<string> = new Set(),
): SessionSummary[] {
  return [...sessions].sort((left, right) => {
    const workspaceOrder = compareWorkspacesByAttention(
      left.workspace,
      right.workspace,
      attentionState,
    );

    if (workspaceOrder !== 0) {
      return workspaceOrder;
    }

    const activeStateOrder =
      getActiveSessionRank(left, highlightedSessionIds) -
      getActiveSessionRank(right, highlightedSessionIds);

    if (activeStateOrder !== 0) {
      return activeStateOrder;
    }

    return compareSessionsByAttention(left, right, attentionState);
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

export function getCurrentRound(session: ApiSession): number {
  if (Number.isInteger(session.currentRound) && session.currentRound >= 0) {
    return session.currentRound;
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

function getActiveSessionRank(session: SessionSummary, highlightedSessionIds: Set<string>): number {
  if (highlightedSessionIds.has(session.id)) {
    return 0;
  }

  if (session.isRunning) {
    return 1;
  }

  if (session.hasUnreadRound) {
    return 2;
  }

  return 3;
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
): WorkspaceDisplayGroup[] {
  const roots = new Map<string, WorkspacePathNode>();

  Object.entries(workspaces).forEach(([workspace, sessions]) => {
    const parsed = parseWorkspacePath(workspace);
    const root = getOrCreateChild(roots, parsed.root);
    const item = {
      workspace,
      sessions,
      parsed,
    };

    root.count += 1;
    insertWorkspacePath(root, parsed.segments, item);
  });

  return Array.from(roots.entries()).flatMap(([root, node]) =>
    collectDisplayGroups(node, root, []),
  );
}

type ParsedWorkspacePath = {
  root: string;
  segments: string[];
};

type WorkspacePathItem = {
  workspace: string;
  sessions: SessionSummary[];
  parsed: ParsedWorkspacePath;
};

type WorkspacePathNode = {
  count: number;
  entries: WorkspacePathItem[];
  children: Map<string, WorkspacePathNode>;
};

function createWorkspacePathNode(): WorkspacePathNode {
  return {
    count: 0,
    entries: [],
    children: new Map(),
  };
}

function getOrCreateChild(
  children: Map<string, WorkspacePathNode>,
  segment: string,
): WorkspacePathNode {
  const existing = children.get(segment);

  if (existing) {
    return existing;
  }

  const child = createWorkspacePathNode();

  children.set(segment, child);

  return child;
}

function insertWorkspacePath(node: WorkspacePathNode, segments: string[], item: WorkspacePathItem) {
  let current = node;

  segments.forEach((segment) => {
    current = getOrCreateChild(current.children, segment);
    current.count += 1;
  });

  current.entries.push(item);
}

function collectDisplayGroups(
  node: WorkspacePathNode,
  root: string,
  prefixSegments: string[],
): WorkspaceDisplayGroup[] {
  if (node.count < 2) {
    return collectSingleWorkspaceGroups(node);
  }

  let displayNode = node;
  const displayPrefixSegments = [...prefixSegments];

  while (displayNode.entries.length === 0 && displayNode.children.size === 1) {
    const [segment, child] = Array.from(displayNode.children.entries())[0];

    displayPrefixSegments.push(segment);
    displayNode = child;
  }

  const prefix = formatWorkspacePath(root, displayPrefixSegments);
  const repeatedChildren = Array.from(displayNode.children.entries()).filter(
    ([, child]) => child.count > 1,
  );
  const singletonChildren = Array.from(displayNode.children.values()).filter(
    (child) => child.count === 1,
  );

  if (
    displayNode.count > 1 &&
    prefix !== root &&
    prefix.length > 0 &&
    (displayNode.entries.length > 0 || repeatedChildren.length === 0)
  ) {
    return [
      {
        id: `prefix:${root}:${displayPrefixSegments.join("/")}`,
        prefix,
        workspaces: collectWorkspaceItems(displayNode, root, displayPrefixSegments),
      },
    ];
  }

  return [
    ...displayNode.entries.map((item) => toSingleWorkspaceGroup(item)),
    ...repeatedChildren.flatMap(([segment, child]) =>
      collectDisplayGroups(child, root, [...displayPrefixSegments, segment]),
    ),
    ...singletonChildren.flatMap((child) => collectSingleWorkspaceGroups(child)),
  ];
}

function collectSingleWorkspaceGroups(node: WorkspacePathNode): WorkspaceDisplayGroup[] {
  return [
    ...node.entries.map((item) => toSingleWorkspaceGroup(item)),
    ...Array.from(node.children.values()).flatMap((child) => collectSingleWorkspaceGroups(child)),
  ];
}

function toSingleWorkspaceGroup(item: WorkspacePathItem): WorkspaceDisplayGroup {
  return {
    id: item.workspace,
    workspaces: [
      {
        workspace: item.workspace,
        label: item.workspace,
        sessions: item.sessions,
      },
    ],
  };
}

function collectWorkspaceItems(
  node: WorkspacePathNode,
  root: string,
  prefixSegments: string[],
): WorkspaceDisplayItem[] {
  return [
    ...node.entries.map((item) => ({
      workspace: item.workspace,
      label: formatWorkspaceSuffix(item.parsed, root, prefixSegments),
      sessions: item.sessions,
    })),
    ...Array.from(node.children.values()).flatMap((child) =>
      collectWorkspaceItems(child, root, prefixSegments),
    ),
  ];
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

function formatWorkspaceSuffix(
  path: ParsedWorkspacePath,
  root: string,
  prefixSegments: string[],
): string {
  if (path.root !== root) {
    return formatWorkspacePath(path.root, path.segments);
  }

  const suffixSegments = path.segments.slice(prefixSegments.length);

  return suffixSegments.length > 0 ? suffixSegments.join("/") : ".";
}
