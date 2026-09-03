import assert from "node:assert/strict";
import test from "node:test";
import {
  getSession,
  getSessionMessages,
} from "../../apps/web/src/features/sessions/api/sessionsApi.js";
import { createRunEventsPath } from "../../apps/web/src/features/sessions/hooks/useRunStream.js";

type FetchCall = {
  url: string;
  init?: RequestInit;
};

test("getSession requests a small tail window with visible trace message types", async () => {
  await withFetchStub(async (calls) => {
    await getSession("session 1", {
      messageWindow: "tail",
      messageLimit: 2,
      traceMessageTypes: ["assistant_message", "todo_list"],
    });

    const url = new URL(calls[0]?.url ?? "", "http://localhost");

    assert.equal(url.pathname, "/api/v1/sessions/session%201");
    assert.equal(url.searchParams.get("messageWindow"), "tail");
    assert.equal(url.searchParams.get("messageLimit"), "2");
    assert.equal(url.searchParams.get("traceMessageTypes"), "assistant_message,todo_list");
  });
});

test("getSessionMessages requests visible trace message types", async () => {
  await withFetchStub(async (calls) => {
    await getSessionMessages("session-1", {
      beforeMessageId: "message-5",
      limit: 4,
      traceMessageTypes: ["assistant_message", "todo_list"],
    });

    const url = new URL(calls[0]?.url ?? "", "http://localhost");

    assert.equal(url.pathname, "/api/v1/sessions/session-1/messages");
    assert.equal(url.searchParams.get("beforeMessageId"), "message-5");
    assert.equal(url.searchParams.get("limit"), "4");
    assert.equal(url.searchParams.get("traceMessageTypes"), "assistant_message,todo_list");
  });
});

test("createRunEventsPath requests visible trace message types", () => {
  const url = new URL(
    createRunEventsPath("run 1", ["assistant_message", "todo_list"]),
    "http://localhost",
  );

  assert.equal(url.pathname, "/api/v1/runs/run%201/events");
  assert.equal(url.searchParams.get("traceMessageTypes"), "assistant_message,todo_list");
});

async function withFetchStub(run: (calls: FetchCall[]) => Promise<void>): Promise<void> {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const calls: FetchCall[] = [];

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: { href: "http://localhost:5173/" },
    },
  });
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (url: string, init?: RequestInit) => {
      calls.push({ url, init });

      return new Response(
        JSON.stringify({
          session: {
            id: "session-1",
            workspace: "/workspace",
            title: "Session",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            messages: [],
            currentRound: 0,
            isRunning: false,
          },
          messages: [],
          pageInfo: {
            total: 0,
            returned: 0,
            hasMoreBefore: false,
            hasMoreAfter: false,
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    },
  });

  try {
    await run(calls);
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: originalFetch,
    });
  }
}
