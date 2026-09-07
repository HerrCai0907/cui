import assert from "node:assert/strict";
import test from "node:test";
import {
  extractResponseDeltas,
  extractFinalResponse,
  extractProcessError,
  formatTraceEvents,
  shouldIncludeEventInTrace,
  toTraceEvent,
} from "../../apps/api/src/infrastructure/ai/aiEvents.js";

test("Codex completed messages stream once, excluding tools and partial snapshots", () => {
  const item = { id: "item_1", type: "agent_message", text: "你好\nCodex" };
  assert.deepEqual(extractResponseDeltas({ type: "item.started", item }, "codex"), []);
  assert.deepEqual(extractResponseDeltas({ type: "item.updated", item }, "codex"), []);
  assert.deepEqual(extractResponseDeltas({ type: "item.completed", item }, "codex"), [
    "你好\nCodex\n\n",
  ]);
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
  assert.deepEqual(
    extractResponseDeltas({
      type: "event_msg",
      payload: { type: "agent_message", message: "trace only" },
    }),
    [],
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

test("trace excludes events already consumed as assistant response text", () => {
  assert.equal(
    shouldIncludeEventInTrace(
      {
        type: "item.completed",
        item: { id: "item_1", type: "agent_message", text: "Done." },
      },
      "codex",
    ),
    false,
  );
  assert.equal(
    shouldIncludeEventInTrace(
      {
        type: "item.completed",
        item: { id: "item_1", type: "agent_message", text: "Done." },
      },
      "traex",
    ),
    true,
  );
  assert.equal(shouldIncludeEventInTrace({ type: "text_delta", text: "Done." }), false);
  assert.equal(
    shouldIncludeEventInTrace({
      type: "event_msg",
      payload: { type: "agent_message", message: "Done." },
    }),
    true,
  );
  assert.equal(
    shouldIncludeEventInTrace({
      type: "event_msg",
      payload: { type: "agent_message_delta", delta: "Done." },
    }),
    false,
  );
  assert.equal(
    shouldIncludeEventInTrace({
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Done." }],
      },
    }),
    false,
  );
  assert.equal(
    shouldIncludeEventInTrace({
      type: "item.completed",
      item: { id: "command_1", type: "command_execution", command: "npm test" },
    }),
    true,
  );
  assert.equal(shouldIncludeEventInTrace({ type: "turn.completed" }), true);
});

test("trace formatting keeps TraeX assistant messages and excludes final response payloads", () => {
  const trace = formatTraceEvents(
    [
      { type: "thread.started", thread_id: "session-1" },
      {
        type: "item.completed",
        item: { id: "item_1", type: "agent_message", text: "Assistant trace" },
      },
      {
        type: "response_item",
        payload: { type: "agent_message", text: "Final answer" },
      },
      {
        type: "item.completed",
        item: {
          id: "command_1",
          type: "command_execution",
          command: "npm test",
          status: "completed",
          exit_code: 0,
        },
      },
    ],
    "traex",
  );

  assert.deepEqual(
    trace.split("\n").map((line) => JSON.parse(line)),
    [
      {
        type: "lifecycle",
        name: "thread.started",
        threadId: "session-1",
        raw: { type: "thread.started", thread_id: "session-1" },
      },
      {
        type: "assistant_message",
        text: "Assistant trace",
        raw: {
          type: "item.completed",
          item: { id: "item_1", type: "agent_message", text: "Assistant trace" },
        },
      },
      {
        type: "command_execution",
        id: "command_1",
        phase: "completed",
        command: "npm test",
        exitCode: 0,
        status: "completed",
        raw: {
          type: "item.completed",
          item: {
            id: "command_1",
            type: "command_execution",
            command: "npm test",
            status: "completed",
            exit_code: 0,
          },
        },
      },
    ],
  );
});

test("trace formatting excludes Codex assistant responses", () => {
  const trace = formatTraceEvents([
    { type: "thread.started", thread_id: "session-1" },
    {
      type: "response_item",
      payload: { type: "agent_message", text: "Final answer" },
    },
    {
      type: "item.completed",
      item: {
        id: "command_1",
        type: "command_execution",
        command: "npm test",
        status: "completed",
        exit_code: 0,
      },
    },
  ]);

  assert.deepEqual(
    trace.split("\n").map((line) => JSON.parse(line)),
    [
      {
        type: "lifecycle",
        name: "thread.started",
        threadId: "session-1",
        raw: { type: "thread.started", thread_id: "session-1" },
      },
      {
        type: "command_execution",
        id: "command_1",
        phase: "completed",
        command: "npm test",
        exitCode: 0,
        status: "completed",
        raw: {
          type: "item.completed",
          item: {
            id: "command_1",
            type: "command_execution",
            command: "npm test",
            status: "completed",
            exit_code: 0,
          },
        },
      },
    ],
  );
});

test("streaming trace events are already normalized for frontend consumption", () => {
  assert.deepEqual(
    toTraceEvent(
      {
        type: "item.completed",
        item: { id: "assistant_1", type: "agent_message", text: "Done." },
      },
      "codex",
    ),
    undefined,
  );
  assert.deepEqual(
    toTraceEvent(
      {
        type: "item.completed",
        item: { id: "assistant_1", type: "agent_message", text: "Done." },
      },
      "traex",
    ),
    {
      type: "assistant_message",
      text: "Done.",
      raw: {
        type: "item.completed",
        item: { id: "assistant_1", type: "agent_message", text: "Done." },
      },
    },
  );
  assert.deepEqual(
    toTraceEvent({
      type: "item.completed",
      item: {
        id: "command_1",
        type: "command_execution",
        command: "npm test",
      },
    }),
    {
      type: "command_execution",
      id: "command_1",
      phase: "completed",
      command: "npm test",
      aggregatedOutput: undefined,
      exitCode: undefined,
      status: undefined,
      raw: {
        type: "item.completed",
        item: {
          id: "command_1",
          type: "command_execution",
          command: "npm test",
        },
      },
    },
  );
});
