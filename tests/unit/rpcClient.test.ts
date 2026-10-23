import assert from "node:assert/strict";
import test from "node:test";
import { rpcRequest } from "../../apps/web/src/shared/api/rpcClient.js";
import { withWebSocketRpcStub } from "./rpcTestHelpers.js";

test("routes state refresh and user action requests over separate RPC sockets", async () => {
  const requestUrls = new Map<string, string>();

  await withWebSocketRpcStub(
    (request, socket) => {
      requestUrls.set(request.method, socket.url);

      if (request.method === "sessions.list") {
        return {
          sessions: [],
          pagination: {
            page: 1,
            pageSize: 1,
            total: 0,
            totalPages: 1,
            hasPreviousPage: false,
            hasNextPage: false,
          },
        };
      }

      return {
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
      };
    },
    async () => {
      await rpcRequest("sessions.list", {});
      await rpcRequest("sessions.create", { workspace: "/workspace" });
    },
  );

  assert.equal(requestUrls.get("sessions.list"), "ws://localhost:5173/api/v1/rpc/state");
  assert.equal(requestUrls.get("sessions.create"), "ws://localhost:5173/api/v1/rpc/actions");
});
