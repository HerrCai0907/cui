import assert from "node:assert/strict";
import test from "node:test";
import {
  getSession,
  getSessionMessages,
} from "../../apps/web/src/features/sessions/api/sessionsApi.js";
import { withWebSocketRpcStub, type RpcRequest } from "./rpcTestHelpers.js";

test("getSession sends a JSON-RPC request for a small tail window", async () => {
  await withWebSocketRpcStub(
    (request) => {
      assert.equal(request.method, "sessions.get");
      assert.deepEqual(request.params, {
        sessionId: "session 1",
        messageWindow: "tail",
        messageLimit: 2,
        traceMessageTypes: ["assistant_message", "todo_list"],
      });

      return {
        session: createSession("session 1"),
      };
    },
    async () => {
      assert.equal(
        (
          await getSession("session 1", {
            messageWindow: "tail",
            messageLimit: 2,
            traceMessageTypes: ["assistant_message", "todo_list"],
          })
        ).id,
        "session 1",
      );
    },
  );
});

test("getSessionMessages sends visible trace message types through JSON-RPC", async () => {
  await withWebSocketRpcStub(
    (request) => {
      assert.equal(request.method, "sessions.messages");
      assert.deepEqual(request.params, {
        sessionId: "session-1",
        beforeMessageId: "message-5",
        limit: 4,
        traceMessageTypes: ["assistant_message", "todo_list"],
      });

      return {
        messages: [],
        pageInfo: {
          total: 0,
          returned: 0,
          hasMoreBefore: false,
          hasMoreAfter: false,
        },
      };
    },
    async () => {
      const page = await getSessionMessages("session-1", {
        beforeMessageId: "message-5",
        limit: 4,
        traceMessageTypes: ["assistant_message", "todo_list"],
      });

      assert.deepEqual(page.messages, []);
    },
  );
});

function createSession(id: string) {
  return {
    id,
    workspace: "/workspace",
    title: "Session",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    messages: [],
    currentRound: 0,
    isRunning: false,
  };
}
