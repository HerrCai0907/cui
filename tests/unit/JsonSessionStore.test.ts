import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { JsonSessionStore } from "../../apps/api/src/infrastructure/store/JsonSessionStore.js";
import type { ChatMessage, ChatRound, ChatSession } from "../../apps/api/src/types.js";

test("JsonSessionStore rejects old v2 aggregate session store data", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "cui-json-session-store-"));
  const storePath = join(cwd, "sessions.json");
  const message = createMessage("message-1");
  const legacySession: ChatSession = {
    id: "session-1",
    workspace: cwd,
    title: "Legacy session",
    summary: "Stored before normalization.",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    messages: [message],
    rounds: [createRound(1)],
  };

  try {
    await writeFile(
      storePath,
      `${JSON.stringify(
        {
          version: 2,
          sessions: [legacySession],
          messagesBySessionId: {
            "session-1": [message],
          },
          roundsBySessionId: {
            "session-1": [createRound(1)],
          },
        },
        null,
        2,
      )}\n`,
    );

    const store = new JsonSessionStore(storePath);

    await assert.rejects(() => store.getSession("session-1"), /Unsupported session store version/);
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("JsonSessionStore stores session index and per-session details separately", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "cui-json-session-store-"));
  const storePath = join(cwd, "sessions.json");
  const detailPath = join(cwd, "sessions", "session-1.json");
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
      version: number;
    };
    const rawDetail = JSON.parse(await readFile(detailPath, "utf8")) as {
      id: string;
      messages: ChatMessage[];
      rounds: ChatRound[];
      version: number;
    };

    assert.equal(rawStore.version, 3);
    assert.equal(rawStore.sessions.length, 1);
    assert.equal("messages" in rawStore.sessions[0], false);
    assert.equal("rounds" in rawStore.sessions[0], false);
    assert.equal(rawStore.sessions[0].currentRound, 1);
    assert.equal("messagesBySessionId" in rawStore, false);
    assert.equal("roundsBySessionId" in rawStore, false);
    assert.deepEqual(rawDetail, {
      version: 3,
      id: "session-1",
      messages: [message],
      rounds: [round],
    });
    assert.deepEqual(await store.getSession("session-1"), session);
    assert.deepEqual(await store.listSessionIndexEntries(), {
      sessions: [
        {
          id: "session-1",
          workspace: cwd,
          title: "Normalized session",
          summary: "",
          createdAt: "2026-08-22T00:00:00.000Z",
          updatedAt: "2026-08-22T00:00:00.000Z",
          currentRound: 1,
        },
      ],
      pagination: {
        page: 1,
        pageSize: 30,
        total: 1,
        totalPages: 1,
        hasPreviousPage: false,
        hasNextPage: false,
      },
    });
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("JsonSessionStore paginates session index entries by updated time", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "cui-json-session-store-"));
  const storePath = join(cwd, "sessions.json");

  try {
    const store = new JsonSessionStore(storePath);

    for (const index of [0, 1, 2, 3, 4]) {
      await store.createSession({
        id: `session-${index}`,
        workspace: cwd,
        title: `Session ${index}`,
        summary: "",
        createdAt: "2026-08-22T00:00:00.000Z",
        updatedAt: new Date(Date.UTC(2026, 7, 22, 0, 0, index)).toISOString(),
        messages: [],
      });
    }

    const page = await store.listSessionIndexEntries({ page: 2, pageSize: 2 });

    assert.deepEqual(
      page.sessions.map((session) => session.id),
      ["session-2", "session-1"],
    );
    assert.deepEqual(page.pagination, {
      page: 2,
      pageSize: 2,
      total: 5,
      totalPages: 3,
      hasPreviousPage: true,
      hasNextPage: true,
    });

    const lastPage = await store.listSessionIndexEntries({ page: 99, pageSize: 2 });

    assert.deepEqual(
      lastPage.sessions.map((session) => session.id),
      ["session-0"],
    );
    assert.equal(lastPage.pagination.page, 3);
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("JsonSessionStore stores done state and clears it when appending messages", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "cui-json-session-store-"));
  const storePath = join(cwd, "sessions.json");
  const detailPath = join(cwd, "sessions", "session-1.json");
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
    assert.equal("doneAt" in JSON.parse(await readFile(detailPath, "utf8")), false);
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("JsonSessionStore reads existing v3 index and per-session detail files", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "cui-json-session-store-"));
  const storePath = join(cwd, "sessions.json");
  const detailDirectory = join(cwd, "sessions");
  const message = createMessage("message-1");
  const round = createRound(1);

  try {
    await mkdir(detailDirectory, { recursive: true });
    await writeFile(
      storePath,
      `${JSON.stringify(
        {
          version: 3,
          sessions: [
            {
              id: "session-1",
              workspace: cwd,
              title: "Existing session",
              summary: "",
              createdAt: "2026-08-22T00:00:00.000Z",
              updatedAt: "2026-08-22T00:00:00.000Z",
            },
          ],
        },
        null,
        2,
      )}\n`,
    );
    await writeFile(
      join(detailDirectory, "session-1.json"),
      `${JSON.stringify(
        {
          version: 3,
          id: "session-1",
          messages: [message],
          rounds: [round],
        },
        null,
        2,
      )}\n`,
    );

    const store = new JsonSessionStore(storePath);

    assert.deepEqual(await store.listSessions(), [
      {
        id: "session-1",
        workspace: cwd,
        title: "Existing session",
        summary: "",
        createdAt: "2026-08-22T00:00:00.000Z",
        updatedAt: "2026-08-22T00:00:00.000Z",
        messages: [message],
        rounds: [round],
      },
    ]);
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
