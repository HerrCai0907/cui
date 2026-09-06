import assert from "node:assert/strict";
import test from "node:test";
import {
  extractResponseDeltas,
  extractFinalResponse,
  extractProcessError,
} from "../../apps/api/src/infrastructure/ai/traexEvents.js";

test("Codex completed messages stream once, excluding tools and partial snapshots", () => {
  const item = { id: "item_1", type: "agent_message", text: "你好\nCodex" };
  assert.deepEqual(extractResponseDeltas({ type: "item.started", item }), []);
  assert.deepEqual(extractResponseDeltas({ type: "item.updated", item }), []);
  assert.deepEqual(extractResponseDeltas({ type: "item.completed", item }), ["你好\nCodex\n\n"]);
  assert.deepEqual(
    extractResponseDeltas({
      type: "item.completed",
      item: { type: "command_execution", text: "tool" },
    }),
    [],
  );
  assert.deepEqual(extractResponseDeltas({ type: "text_delta", text: "TraeX" }), ["TraeX"]);
  assert.deepEqual(
    extractResponseDeltas({
      type: "event_msg",
      payload: { type: "agent_message_delta", delta: "delta" },
    }),
    ["delta"],
  );
});

test("Codex fallback selects the last assistant message without commentary or tool text", () => {
  assert.equal(
    extractFinalResponse([
      { type: "item.completed", item: { type: "agent_message", text: "Working..." } },
      { type: "item.completed", item: { type: "agent_message", text: '{"title":"Done"}' } },
      { type: "item.completed", item: { type: "command_execution", text: "command" } },
      { type: "turn.completed" },
    ]),
    '{"title":"Done"}',
  );
});

test("recoverable Codex errors do not fail a successful turn", () => {
  const events = [{ type: "error", message: "Reconnecting" }, { type: "turn.completed" }];
  assert.equal(extractProcessError(events, false), undefined);
  assert.equal(extractProcessError(events, true), "Reconnecting");
});
