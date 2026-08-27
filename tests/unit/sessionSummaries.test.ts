import assert from "node:assert/strict";
import test from "node:test";
import {
  groupWorkspacesForDisplay,
  partitionActiveSessionsForSidebar,
  type WorkspaceTreeNode,
} from "../../apps/web/src/features/sessions/model/sessionSummaries.js";
import type { SessionSummary } from "../../apps/web/src/types.js";

test("groupWorkspacesForDisplay builds a workspace file tree", () => {
  assert.deepEqual(
    stripSessions(
      groupWorkspacesForDisplay({
        "/Users/bytedance/cui": [],
        "/Users/bytedance/oss/go": [],
      }),
    ),
    [
      {
        id: "/Users/bytedance",
        label: "/Users/bytedance",
        path: "/Users/bytedance",
        children: [
          {
            id: "/Users/bytedance/cui",
            label: "cui",
            path: "/Users/bytedance/cui",
            workspace: "/Users/bytedance/cui",
            children: [],
          },
          {
            id: "/Users/bytedance/oss/go",
            label: "oss/go",
            path: "/Users/bytedance/oss/go",
            workspace: "/Users/bytedance/oss/go",
            children: [],
          },
        ],
      },
    ],
  );
});

test("groupWorkspacesForDisplay compresses single-child directory chains", () => {
  assert.deepEqual(
    stripSessions(
      groupWorkspacesForDisplay({
        "/Users/bytedance/cui": [],
      }),
    ),
    [
      {
        id: "/Users/bytedance/cui",
        label: "/Users/bytedance/cui",
        path: "/Users/bytedance/cui",
        workspace: "/Users/bytedance/cui",
        children: [],
      },
    ],
  );
});

test("groupWorkspacesForDisplay keeps workspace nodes that also have descendants", () => {
  assert.deepEqual(
    stripSessions(
      groupWorkspacesForDisplay({
        "/Users/bytedance": [],
        "/Users/bytedance/cui": [],
      }),
    ),
    [
      {
        id: "/Users/bytedance",
        label: "/Users/bytedance",
        path: "/Users/bytedance",
        workspace: "/Users/bytedance",
        children: [
          {
            id: "/Users/bytedance/cui",
            label: "cui",
            path: "/Users/bytedance/cui",
            workspace: "/Users/bytedance/cui",
            children: [],
          },
        ],
      },
    ],
  );
});

test("groupWorkspacesForDisplay includes unrelated paths under their roots", () => {
  assert.deepEqual(
    stripSessions(
      groupWorkspacesForDisplay({
        "/Users/bytedance/cui": [],
        "/Users/bytedance/oss/go": [],
        "/tmp/project": [],
      }),
    ),
    [
      {
        id: "/",
        label: "/",
        path: "/",
        children: [
          {
            id: "/Users/bytedance",
            label: "Users/bytedance",
            path: "/Users/bytedance",
            children: [
              {
                id: "/Users/bytedance/cui",
                label: "cui",
                path: "/Users/bytedance/cui",
                workspace: "/Users/bytedance/cui",
                children: [],
              },
              {
                id: "/Users/bytedance/oss/go",
                label: "oss/go",
                path: "/Users/bytedance/oss/go",
                workspace: "/Users/bytedance/oss/go",
                children: [],
              },
            ],
          },
          {
            id: "/tmp/project",
            label: "tmp/project",
            path: "/tmp/project",
            workspace: "/tmp/project",
            children: [],
          },
        ],
      },
    ],
  );
});

test("partitionActiveSessionsForSidebar keeps active sessions and one recent session per active workspace", () => {
  const sessions = createSessions(6);
  sessions[2] = {
    ...sessions[2],
    isRunning: true,
  };
  sessions[5] = {
    ...sessions[5],
    hasUnreadRound: true,
  };

  const partition = partitionActiveSessionsForSidebar(
    sessions,
    {
      sessions: {
        "session-1": 200,
        "session-4": 100,
      },
      workspaces: {
        "/workspace/a": 20,
        "/workspace/b": 10,
      },
    },
    new Set(["session-0"]),
  );

  assert.deepEqual(
    partition.active.map((session) => session.id),
    ["session-4", "session-2", "session-0", "session-5", "session-1"],
  );
  assert.deepEqual(
    partition.more.map((session) => session.id),
    ["session-1", "session-4", "session-0", "session-2", "session-3", "session-5"],
  );
});

test("partitionActiveSessionsForSidebar sorts Active by immutable workspace and session keys", () => {
  const sessions = createSessions(6).map((session, index) => ({
    ...session,
    updatedAt: new Date(Date.UTC(2026, 0, 1, 1, index)).toISOString(),
  }));

  const partition = partitionActiveSessionsForSidebar(
    sessions,
    {
      sessions: {
        "session-5": 300,
        "session-1": 200,
        "session-3": 100,
      },
      workspaces: {
        "/workspace/b": 20,
        "/workspace/a": 10,
      },
    },
    new Set(sessions.map((session) => session.id)),
    new Set(["/workspace/a", "/workspace/b"]),
  );

  assert.deepEqual(
    partition.active.map((session) => session.id),
    ["session-4", "session-2", "session-0", "session-5", "session-3", "session-1"],
  );
});

test("partitionActiveSessionsForSidebar excludes workspaces without attention from Active", () => {
  const sessions = createSessions(4);

  const partition = partitionActiveSessionsForSidebar(sessions, {
    sessions: {},
    workspaces: {},
  });

  assert.deepEqual(partition.active, []);
  assert.deepEqual(
    partition.more.map((session) => session.id),
    ["session-0", "session-1", "session-2", "session-3"],
  );
});

test("partitionActiveSessionsForSidebar keeps done sessions out of Active only", () => {
  const sessions = createSessions(3);
  sessions[0] = {
    ...sessions[0],
    doneAt: "2026-08-22T00:00:00.000Z",
  };

  const partition = partitionActiveSessionsForSidebar(
    sessions,
    {
      sessions: {
        "session-0": 300,
        "session-1": 200,
      },
      workspaces: {
        "/workspace/a": 100,
        "/workspace/b": 90,
      },
    },
    new Set(["session-0"]),
  );

  assert.equal(
    partition.active.some((session) => session.id === "session-0"),
    false,
  );
  assert.deepEqual(
    partition.more.map((session) => session.id),
    ["session-0", "session-1", "session-2"],
  );
});

test("partitionActiveSessionsForSidebar uses done sessions when retaining active workspaces", () => {
  const sessions = createSessions(4);
  sessions[0] = {
    ...sessions[0],
    doneAt: "2026-08-22T00:00:00.000Z",
  };
  sessions[1] = {
    ...sessions[1],
    workspace: "/workspace/done-only",
    doneAt: "2026-08-22T00:00:00.000Z",
  };

  const partition = partitionActiveSessionsForSidebar(
    sessions,
    {
      sessions: {
        "session-0": 300,
        "session-1": 200,
      },
      workspaces: {
        "/workspace/a": 100,
        "/workspace/done-only": 90,
      },
    },
    new Set(["session-0"]),
  );

  assert.deepEqual(partition.activeWorkspaces, ["/workspace/a", "/workspace/done-only"]);
  assert.deepEqual(
    partition.active.map((session) => session.id),
    ["session-2"],
  );
});

test("partitionActiveSessionsForSidebar limits recent workspaces but always keeps running workspaces", () => {
  const sessions = createSessions(8).map((session, index) => ({
    ...session,
    workspace: `/workspace/${index}`,
  }));
  sessions[7] = {
    ...sessions[7],
    isRunning: true,
  };

  const partition = partitionActiveSessionsForSidebar(
    sessions,
    {
      sessions: {},
      workspaces: {
        "/workspace/0": 100,
        "/workspace/1": 90,
        "/workspace/2": 80,
      },
    },
    new Set(),
    new Set(),
    2,
  );

  assert.deepEqual(
    partition.active.map((session) => session.id),
    ["session-0", "session-1", "session-7"],
  );
});

test("partitionActiveSessionsForSidebar keeps highlighted workspaces without sessions", () => {
  const partition = partitionActiveSessionsForSidebar(
    [],
    {
      sessions: {},
      workspaces: {},
    },
    new Set(),
    new Set(["/workspace/empty"]),
  );

  assert.deepEqual(partition.activeWorkspaces, ["/workspace/empty"]);
  assert.deepEqual(partition.active, []);
});

function stripSessions(nodes: WorkspaceTreeNode[]): unknown[] {
  return nodes.map((node) => ({
    id: node.id,
    label: node.label,
    path: node.path,
    ...(node.workspace ? { workspace: node.workspace.workspace } : {}),
    children: stripSessions(node.children),
  }));
}

function createSessions(count: number): SessionSummary[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `session-${index}`,
    workspace: index % 2 === 0 ? "/workspace/a" : "/workspace/b",
    title: `Session ${index}`,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    updatedAt: new Date(Date.UTC(2026, 0, 1, 0, count - index)).toISOString(),
    currentRound: 1,
    isRunning: false,
    hasUnreadRound: false,
  }));
}
