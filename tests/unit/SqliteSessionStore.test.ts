import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { SqliteSessionStore } from "../../apps/api/src/infrastructure/store/SqliteSessionStore.js";
import type {
  AtomicDiffReview,
  ChatMessage,
  ChatRound,
  ChatSession,
} from "../../apps/api/src/types.js";

test("SqliteSessionStore runs SQL migrations and persists sessions", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "cui-sqlite-session-store-"));
  const databasePath = join(cwd, "cui.sqlite");

  try {
    const store = new SqliteSessionStore(databasePath);
    const session = createSession(cwd, {
      messages: [createMessage("message-1")],
      rounds: [createRound(1)],
    });

    await store.createSession(session);

    assert.deepEqual(await store.getSession("session-1"), {
      ...session,
      rounds: [
        {
          ...session.rounds?.[0],
          beforeDiff: "",
          afterDiff: "",
        },
      ],
    });

    store.close();

    const reopenedStore = new SqliteSessionStore(databasePath);

    assert.equal((await reopenedStore.getSession("session-1"))?.messages[0]?.id, "message-1");
    assert.equal((await reopenedStore.getRound("session-1", 1))?.diff, "diff --git a/a.ts b/a.ts");

    reopenedStore.close();

    const db = new Database(databasePath, { readonly: true });

    try {
      assert.deepEqual(db.prepare("SELECT version FROM schema_migrations").all(), [
        { version: "001_initial_schema" },
      ]);
      assert.equal(
        (db.prepare("SELECT COUNT(*) AS total FROM messages").get() as { total: number }).total,
        1,
      );
      assert.equal(
        (db.prepare("SELECT COUNT(*) AS total FROM rounds").get() as { total: number }).total,
        1,
      );
    } finally {
      db.close();
    }
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("SqliteSessionStore paginates index entries without promoting pinned sessions", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "cui-sqlite-session-store-"));
  const databasePath = join(cwd, "cui.sqlite");
  const store = new SqliteSessionStore(databasePath);

  try {
    for (const index of [0, 1, 2, 3]) {
      await store.createSession(
        createSession(cwd, {
          id: `session-${index}`,
          title: `Session ${index}`,
          updatedAt: new Date(Date.UTC(2026, 7, 22, 0, 0, index)).toISOString(),
        }),
      );
    }

    const db = new Database(databasePath);
    try {
      db.prepare("UPDATE sessions SET pinned = 1 WHERE id = ?").run("session-0");
    } finally {
      db.close();
    }

    const firstPage = await store.listSessionIndexEntries({ page: 1, pageSize: 2 });
    const secondPage = await store.listSessionIndexEntries({ page: 2, pageSize: 2 });

    assert.deepEqual(
      firstPage.sessions.map((session) => session.id),
      ["session-3", "session-2"],
    );
    assert.deepEqual(
      secondPage.sessions.map((session) => session.id),
      ["session-1", "session-0"],
    );
    assert.equal(firstPage.pagination.total, 4);
  } finally {
    store.close();
    await rm(cwd, { force: true, recursive: true });
  }
});

test("SqliteSessionStore deletes expired sessions and cascades session data", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "cui-sqlite-session-store-"));
  const databasePath = join(cwd, "cui.sqlite");
  const store = new SqliteSessionStore(databasePath);
  const artifactDirectory = join(cwd, "session-artifacts", "expired-session");

  try {
    await store.createSession(
      createSession(cwd, {
        id: "expired-session",
        updatedAt: "2026-08-01T00:00:00.000Z",
        messages: [createMessage("expired-message")],
        rounds: [createRound(1)],
      }),
    );
    await store.enqueuePrompt("expired-session", {
      id: "queued-1",
      mode: "chat",
      prompt: "Queued follow-up.",
      createdAt: "2026-08-01T00:00:01.000Z",
    });
    await store.createSession(
      createSession(cwd, {
        id: "retained-session",
        updatedAt: "2028-08-22T00:00:00.000Z",
      }),
    );
    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(join(artifactDirectory, "index.json"), "{}", "utf8");

    assert.equal(await store.deleteExpiredSessions("2027-08-15T00:00:00.000Z"), 1);
    assert.deepEqual(
      (await store.listSessionIndexEntries()).sessions.map((session) => session.id),
      ["retained-session"],
    );
    assert.equal(await store.getSession("expired-session"), undefined);
    await assert.rejects(
      () => writeFile(join(artifactDirectory, "index.json"), "{}", "utf8"),
      /ENOENT/,
    );

    const db = new Database(databasePath, { readonly: true });
    try {
      assert.equal(
        (db.prepare("SELECT COUNT(*) AS total FROM messages").get() as { total: number }).total,
        0,
      );
      assert.equal(
        (db.prepare("SELECT COUNT(*) AS total FROM rounds").get() as { total: number }).total,
        0,
      );
      assert.equal(
        (db.prepare("SELECT COUNT(*) AS total FROM queued_prompts").get() as { total: number })
          .total,
        0,
      );
    } finally {
      db.close();
    }
  } finally {
    store.close();
    await rm(cwd, { force: true, recursive: true });
  }
});

test("SqliteSessionStore persists and shifts queued prompts", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "cui-sqlite-session-store-"));
  const store = new SqliteSessionStore(join(cwd, "cui.sqlite"));

  try {
    await store.createSession(createSession(cwd));
    await store.enqueuePrompt("session-1", {
      id: "queued-1",
      mode: "chat",
      prompt: "Queued follow-up.",
      createdAt: "2026-08-22T00:00:01.000Z",
      models: {
        normal: "GPT-5.4",
      },
    });

    const queuedSession = await store.getSession("session-1");
    const listedSessions = await store.listSessionIndexEntries();

    assert.equal(queuedSession?.queuedPrompts?.[0]?.models?.normal, "GPT-5.4");
    assert.deepEqual(await store.listQueuedSessionIds(), ["session-1"]);
    assert.equal(await store.hasQueuedPrompt("queued-1"), true);
    assert.deepEqual(listedSessions.sessions[0]?.queuedPrompts, [
      {
        id: "queued-1",
        mode: "chat",
        prompt: "Queued follow-up.",
        createdAt: "2026-08-22T00:00:01.000Z",
      },
    ]);

    const shiftedPrompt = await store.shiftQueuedPrompt("session-1");

    assert.equal(shiftedPrompt?.id, "queued-1");
    assert.equal((await store.getSession("session-1"))?.queuedPrompts?.length ?? 0, 0);
    assert.deepEqual(await store.listQueuedSessionIds(), []);
    assert.equal(await store.hasQueuedPrompt("queued-1"), false);
    assert.equal(await store.shiftQueuedPrompt("session-1"), undefined);
  } finally {
    store.close();
    await rm(cwd, { force: true, recursive: true });
  }
});

test("SqliteSessionStore updates round atomic reviews", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "cui-sqlite-session-store-"));
  const store = new SqliteSessionStore(join(cwd, "cui.sqlite"));
  const atomicReview: AtomicDiffReview = {
    status: "ready",
    generatedAt: "2026-08-22T00:00:01.000Z",
    analysisSessionId: "review-session-1",
    items: [],
    rawResponse: "{}",
  };

  try {
    await store.createSession(createSession(cwd, { rounds: [createRound(1)] }));

    const round = await store.updateRoundAtomicReview("session-1", 1, atomicReview);

    assert.deepEqual(round.atomicReview, atomicReview);
    assert.deepEqual((await store.getRound("session-1", 1))?.atomicReview, atomicReview);
  } finally {
    store.close();
    await rm(cwd, { force: true, recursive: true });
  }
});

function createSession(workspace: string, overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: "session-1",
    workspace,
    title: "SQLite session",
    summary: "",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    messages: [],
    ...overrides,
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
