import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { JsonSessionStore } from "../../apps/api/src/infrastructure/store/JsonSessionStore.js";
import type { ChatMessage, ChatRound, ChatSession } from "../../apps/api/src/types.js";

test("JsonSessionStore reads legacy embedded sessions and writes normalized store data", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "cui-json-session-store-"));
  const storePath = join(cwd, "sessions.json");
  const message = createMessage("message-1");
  const round = createRound(1);
  const legacySession: ChatSession = {
    id: "session-1",
    workspace: cwd,
    title: "Legacy session",
    summary: "Stored before normalization.",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    messages: [message],
    rounds: [round],
  };

  try {
    await writeFile(storePath, `${JSON.stringify({ sessions: [legacySession] }, null, 2)}\n`);

    const store = new JsonSessionStore(storePath);
    const loadedSession = await store.getSession("session-1");

    assert.deepEqual(loadedSession, legacySession);

    const appendedMessage = createMessage("message-2");
    await store.appendMessages("session-1", [appendedMessage]);

    const rawStore = JSON.parse(await readFile(storePath, "utf8")) as {
      sessions: Array<Record<string, unknown>>;
      messagesBySessionId: Record<string, ChatMessage[]>;
      roundsBySessionId: Record<string, ChatRound[]>;
      version: number;
    };

    assert.equal(rawStore.version, 2);
    assert.deepEqual(rawStore.sessions, [
      {
        id: "session-1",
        workspace: cwd,
        title: "Legacy session",
        summary: "Stored before normalization.",
        createdAt: "2026-08-22T00:00:00.000Z",
        updatedAt: rawStore.sessions[0].updatedAt,
      },
    ]);
    assert.equal("messages" in rawStore.sessions[0], false);
    assert.equal("rounds" in rawStore.sessions[0], false);
    assert.deepEqual(rawStore.messagesBySessionId["session-1"], [message, appendedMessage]);
    assert.deepEqual(rawStore.roundsBySessionId["session-1"], [round]);
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("JsonSessionStore stores session metadata, messages, and rounds separately", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "cui-json-session-store-"));
  const storePath = join(cwd, "sessions.json");
  const message = createMessage("message-1");
  const round = createRound(1);
  const session: ChatSession = {
    id: "session-1",
    workspace: cwd,
    title: "Normalized session",
    summary: "",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    messages: [message],
    rounds: [round],
  };

  try {
    const store = new JsonSessionStore(storePath);

    await store.createSession(session);

    const rawStore = JSON.parse(await readFile(storePath, "utf8")) as {
      sessions: Array<Record<string, unknown>>;
      messagesBySessionId: Record<string, ChatMessage[]>;
      roundsBySessionId: Record<string, ChatRound[]>;
      version: number;
    };

    assert.equal(rawStore.version, 2);
    assert.equal(rawStore.sessions.length, 1);
    assert.equal("messages" in rawStore.sessions[0], false);
    assert.equal("rounds" in rawStore.sessions[0], false);
    assert.deepEqual(rawStore.messagesBySessionId["session-1"], [message]);
    assert.deepEqual(rawStore.roundsBySessionId["session-1"], [round]);
    assert.deepEqual(await store.getSession("session-1"), session);
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("JsonSessionStore stores done state and clears it when appending messages", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "cui-json-session-store-"));
  const storePath = join(cwd, "sessions.json");
  const session: ChatSession = {
    id: "session-1",
    workspace: cwd,
    title: "Done session",
    summary: "",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    messages: [],
  };

  try {
    const store = new JsonSessionStore(storePath);

    await store.createSession(session);
    const doneSession = await store.updateSessionDoneAt("session-1", "2026-08-22T00:00:10.000Z");

    assert.equal(doneSession.doneAt, "2026-08-22T00:00:10.000Z");
    assert.equal((await store.getSession("session-1"))?.doneAt, "2026-08-22T00:00:10.000Z");

    const appendedSession = await store.appendMessages("session-1", [createMessage("message-1")]);

    assert.equal(appendedSession.doneAt, undefined);
    assert.equal((await store.getSession("session-1"))?.doneAt, undefined);
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

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
    afterDiff: "diff --git a/example.ts b/example.ts",
    diff: "diff --git a/example.ts b/example.ts",
    hasChanges: true,
    createdAt: "2026-08-22T00:00:00.000Z",
  };
}
