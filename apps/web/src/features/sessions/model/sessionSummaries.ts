import type { ApiSession, SessionSummary } from '../../../types';
import { getLastSeenRound } from './sessionBrowserState';

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

export type SidebarSessionPartition = {
  current: SessionSummary[];
  history: SessionSummary[];
};

export const SIDEBAR_CURRENT_SESSION_MINIMUM = 16;

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
    hasUnreadRound:
      lastSeenRound !== null && lastSeenRound !== currentRound,
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

export function partitionSessionsForSidebar(
  sessions: SessionSummary[],
  minimumCurrentCount = SIDEBAR_CURRENT_SESSION_MINIMUM,
): SidebarSessionPartition {
  const sortedSessions = [...sessions].sort(compareSessionsByUpdatedAt);
  const currentSessionIds = new Set(
    sortedSessions
      .filter((session) => session.isRunning || session.hasUnreadRound)
      .map((session) => session.id),
  );
  const targetCurrentCount = Math.max(
    minimumCurrentCount,
    currentSessionIds.size,
  );

  for (const session of sortedSessions) {
    if (currentSessionIds.size >= targetCurrentCount) {
      break;
    }

    currentSessionIds.add(session.id);
  }

  return {
    current: sortedSessions.filter((session) =>
      currentSessionIds.has(session.id),
    ),
    history: sortedSessions.filter(
      (session) => !currentSessionIds.has(session.id),
    ),
  };
}

export function getCurrentRound(session: ApiSession): number {
  if (Number.isInteger(session.currentRound) && session.currentRound >= 0) {
    return session.currentRound;
  }

  const storedRound = Math.max(
    0,
    ...(session.rounds?.map(({ round }) => round) ?? []),
  );
  const messageRound = Math.max(
    0,
    ...session.messages
      .map(({ round }) => round ?? 0)
      .filter((round) => Number.isInteger(round) && round > 0),
  );
  const completedTurnCount = Math.max(
    countAssistantMessages(session, 'trace'),
    countAssistantMessages(session, 'response'),
  );

  return Math.max(storedRound, messageRound, completedTurnCount);
}

function countAssistantMessages(
  session: ApiSession,
  kind: 'response' | 'trace',
): number {
  return session.messages.filter(
    (message) => message.role === 'assistant' && message.kind === kind,
  ).length;
}

function compareSessionsByUpdatedAt(
  left: SessionSummary,
  right: SessionSummary,
): number {
  const updatedAtOrder = right.updatedAt.localeCompare(left.updatedAt);

  return updatedAtOrder !== 0 ? updatedAtOrder : right.id.localeCompare(left.id);
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

function insertWorkspacePath(
  node: WorkspacePathNode,
  segments: string[],
  item: WorkspacePathItem,
) {
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
        id: `prefix:${root}:${displayPrefixSegments.join('/')}`,
        prefix,
        workspaces: collectWorkspaceItems(
          displayNode,
          root,
          displayPrefixSegments,
        ),
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

function collectSingleWorkspaceGroups(
  node: WorkspacePathNode,
): WorkspaceDisplayGroup[] {
  return [
    ...node.entries.map((item) => toSingleWorkspaceGroup(item)),
    ...Array.from(node.children.values()).flatMap((child) =>
      collectSingleWorkspaceGroups(child),
    ),
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
  const withoutTrailingSeparators =
    trimmed.replace(/[\\/]+$/g, '') || trimmed;
  const windowsMatch = /^([A-Za-z]:)[\\/]*(.*)$/.exec(
    withoutTrailingSeparators,
  );

  if (windowsMatch) {
    return {
      root: `${windowsMatch[1]}/`,
      segments: splitPathSegments(windowsMatch[2]),
    };
  }

  if (withoutTrailingSeparators.startsWith('/')) {
    return {
      root: '/',
      segments: splitPathSegments(withoutTrailingSeparators.slice(1)),
    };
  }

  return {
    root: '',
    segments: splitPathSegments(withoutTrailingSeparators),
  };
}

function splitPathSegments(path: string): string[] {
  return path.split(/[\\/]+/).filter(Boolean);
}

function formatWorkspacePath(root: string, segments: string[]): string {
  if (root === '/') {
    return segments.length > 0 ? `/${segments.join('/')}` : root;
  }

  return `${root}${segments.join('/')}`;
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

  return suffixSegments.length > 0 ? suffixSegments.join('/') : '.';
}
