import assert from "node:assert/strict";
import test from "node:test";
import {
  groupWorkspacesForDisplay,
  partitionSessionsForSidebar,
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

test("partitionSessionsForSidebar keeps every session when there are at most 16", () => {
  const sessions = createSessions(16);

  const partition = partitionSessionsForSidebar(sessions);

  assert.deepEqual(
    partition.current.map((session) => session.id),
    sessions.map((session) => session.id),
  );
  assert.deepEqual(partition.history, []);
});

test("partitionSessionsForSidebar keeps the newest 16 sessions globally", () => {
  const sessions = createSessions(18).reverse();

  const partition = partitionSessionsForSidebar(sessions);

  assert.deepEqual(
    partition.current.map((session) => session.id),
    createSessions(16).map((session) => session.id),
  );
  assert.deepEqual(
    partition.history.map((session) => session.id),
    ["session-16", "session-17"],
  );
});

test("partitionSessionsForSidebar keeps running and unread sessions out of history", () => {
  const sessions = createSessions(18);

  sessions[16] = {
    ...sessions[16],
    isRunning: true,
  };
  sessions[17] = {
    ...sessions[17],
    hasUnreadRound: true,
  };

  const partition = partitionSessionsForSidebar(sessions);

  assert.deepEqual(
    partition.current.map((session) => session.id),
    [
      "session-0",
      "session-1",
      "session-2",
      "session-3",
      "session-4",
      "session-5",
      "session-6",
      "session-7",
      "session-8",
      "session-9",
      "session-10",
      "session-11",
      "session-12",
      "session-13",
      "session-16",
      "session-17",
    ],
  );
  assert.deepEqual(
    partition.history.map((session) => session.id),
    ["session-14", "session-15"],
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
    updatedAt: new Date(Date.UTC(2026, 0, 1, 0, count - index)).toISOString(),
    currentRound: 1,
    isRunning: false,
    hasUnreadRound: false,
  }));
}
