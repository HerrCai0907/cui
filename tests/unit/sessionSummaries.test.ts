import assert from "node:assert/strict";
import test from "node:test";
import {
  groupWorkspacesForDisplay,
  partitionActiveSessionsForSidebar,
  type WorkspaceDisplayGroup,
} from "../../apps/web/src/features/sessions/model/sessionSummaries.js";
import type { SessionSummary } from "../../apps/web/src/types.js";

test("groupWorkspacesForDisplay merges shared path prefixes", () => {
  assert.deepEqual(
    stripSessions(
      groupWorkspacesForDisplay({
        "/Users/bytedance/cui": [],
        "/Users/bytedance/oss/go": [],
      }),
    ),
    [
      {
        id: "prefix:/:Users/bytedance",
        prefix: "/Users/bytedance",
        workspaces: [
          {
            workspace: "/Users/bytedance/cui",
            label: "cui",
          },
          {
            workspace: "/Users/bytedance/oss/go",
            label: "oss/go",
          },
        ],
      },
    ],
  );
});

test("groupWorkspacesForDisplay leaves unrelated single workspace labels complete", () => {
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
        id: "prefix:/:Users/bytedance",
        prefix: "/Users/bytedance",
        workspaces: [
          {
            workspace: "/Users/bytedance/cui",
            label: "cui",
          },
          {
            workspace: "/Users/bytedance/oss/go",
            label: "oss/go",
          },
        ],
      },
      {
        id: "/tmp/project",
        workspaces: [
          {
            workspace: "/tmp/project",
            label: "/tmp/project",
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

function stripSessions(groups: WorkspaceDisplayGroup[]) {
  return groups.map((group) => ({
    id: group.id,
    ...(group.prefix ? { prefix: group.prefix } : {}),
    workspaces: group.workspaces.map((workspace) => ({
      workspace: workspace.workspace,
      label: workspace.label,
    })),
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
