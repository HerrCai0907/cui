import assert from "node:assert/strict";
import test from "node:test";
import {
  appendResponseDelta,
  applyStreamMessageState,
  createStreamMessageState,
} from "../../apps/web/src/features/sessions/model/streamMessages.js";
import type { ApiSession } from "../../apps/web/src/types.js";

test("applyStreamMessageState labels streaming assistant messages with the run model", () => {
  const state = createStreamMessageState("GPT-5.4 / High");
  state.streamedTrace = JSON.stringify({ type: "turn.started" });
  state.streamedResponse = "Working...";

  const session = applyStreamMessageState(createSession(), {
    state,
    sessionId: "session-1",
    traceMessageId: "stream-run-1-trace",
    responseMessageId: "stream-run-1-response",
  });

  assert.equal(session.messages[0]?.kind, "trace");
  assert.equal(session.messages[0]?.model, "GPT-5.4 / High");
  assert.equal(session.messages[1]?.kind, "response");
  assert.equal(session.messages[1]?.model, "GPT-5.4 / High");
});

test("appendResponseDelta preserves the streaming response model", () => {
  const state = createStreamMessageState("Seed-2.1-Turbo");
  const session = appendResponseDelta(createSession(), {
    state,
    sessionId: "session-1",
    responseMessageId: "stream-run-1-response",
    text: "Hello",
  });

  assert.equal(session.messages[0]?.kind, "response");
  assert.equal(session.messages[0]?.model, "Seed-2.1-Turbo");
});

test("applyStreamMessageState anchors streaming traces after the prompt message", () => {
  const state = createStreamMessageState("GPT-5.4");
  state.streamedTrace = JSON.stringify({ type: "turn.started" });
  const session = applyStreamMessageState(
    createSession([
      createMessage("older-message", "user", "Older loaded message"),
      createMessage("prompt-message", "user", "Current prompt"),
    ]),
    {
      state,
      sessionId: "session-1",
      traceMessageId: "stream-run-1-trace",
      responseMessageId: "stream-run-1-response",
      traceInsertAfterMessageId: "prompt-message",
      traceInsertIndex: 1,
    },
  );

  assert.deepEqual(
    session.messages.map((message) => message.id),
    ["older-message", "prompt-message", "stream-run-1-trace"],
  );
});

function createSession(messages: ApiSession["messages"] = []): ApiSession {
  return {
    id: "session-1",
    workspace: "/tmp/cui",
    title: "Streaming model labels",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    messages,
    currentRound: 0,
    isRunning: true,
  };
}

function createMessage(
  id: string,
  role: ApiSession["messages"][number]["role"],
  content: string,
): ApiSession["messages"][number] {
  return {
    id,
    role,
    content,
    createdAt: "2026-08-22T00:00:00.000Z",
  };
}
