import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WorkerSessionStore } from "../../apps/api/src/infrastructure/store/WorkerSessionStore.js";
import type { ChatMessage, ChatRound, ChatSession } from "../../apps/api/src/types.js";

test("WorkerSessionStore proxies SQLite session operations through a worker thread", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "cui-worker-session-store-"));
  const store = new WorkerSessionStore(join(cwd, "cui.sqlite"));

  try {
    await store.createSession(createSession(cwd));
    const appended = await store.appendRoundAndMessages("session-1", createRound(1), [
      createMessage("message-1"),
    ]);
    const listed = await store.listSessionIndexEntries();

    assert.equal(appended.messages[0]?.id, "message-1");
    assert.equal(appended.rounds?.[0]?.round, 1);
    assert.deepEqual(
      listed.sessions.map((session) => session.id),
      ["session-1"],
    );
    assert.equal((await store.getRound("session-1", 1))?.diff, "diff --git a/a.ts b/a.ts");
  } finally {
    store.close();
    await rm(cwd, { force: true, recursive: true });
  }
});

function createSession(workspace: string): ChatSession {
  return {
    id: "session-1",
    workspace,
    title: "Worker session",
    summary: "",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    messages: [],
  };
}

function createMessage(id: string): ChatMessage {
  return {
    id,
    role: "assistant",
    kind: "response",
    round: 1,
    content: `Message ${id}`,
    createdAt: "2026-08-22T00:00:00.000Z",
  };
}

function createRound(round: number): ChatRound {
  return {
    round,
    baseCommit: "abc123",
    beforeDiff: "",
    afterDiff: "diff --git a/a.ts b/a.ts",
    diff: "diff --git a/a.ts b/a.ts",
    hasChanges: true,
    createdAt: "2026-08-22T00:00:00.000Z",
  };
}
