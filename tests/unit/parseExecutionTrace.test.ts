import assert from "node:assert/strict";
import test from "node:test";
import { parseExecutionTrace } from "../../apps/web/src/features/trace/model/parseExecutionTrace.js";

test("parseExecutionTrace maps unified harness messages to execution trace events", () => {
  const events = parseExecutionTrace(
    [
      JSON.stringify({
        type: "lifecycle",
        name: "thread.started",
        threadId: "session-1",
        raw: { type: "thread.started", thread_id: "session-1" },
      }),
      JSON.stringify({
        type: "assistant_message",
        text: "Visible assistant trace.",
        raw: {},
      }),
      JSON.stringify({
        type: "command_execution",
        id: "command_1",
        phase: "completed",
        command: "npm test",
        aggregatedOutput: "ok",
        exitCode: 0,
        status: "completed",
        raw: {},
      }),
      JSON.stringify({
        type: "todo_list",
        id: "todo_1",
        phase: "updated",
        items: [{ text: "Ship unified messages", completed: false }],
        raw: {},
      }),
    ].join("\n"),
  );

  assert.deepEqual(events, [
    {
      type: "thread.started",
      thread_id: "session-1",
    },
    {
      type: "item.completed",
      item: {
        id: "",
        type: "agent_message",
        text: "Visible assistant trace.",
      },
    },
    {
      type: "item.completed",
      item: {
        id: "command_1",
        type: "command_execution",
        command: "npm test",
        aggregated_output: "ok",
        exit_code: 0,
        status: "completed",
      },
    },
    {
      type: "item.updated",
      item: {
        id: "todo_1",
        type: "todo_list",
        items: [{ text: "Ship unified messages", completed: false }],
      },
    },
  ]);
});

test("parseExecutionTrace keeps legacy item trace compatibility", () => {
  const events = parseExecutionTrace(
    JSON.stringify({
      type: "item.completed",
      item: {
        id: "command_1",
        type: "command_execution",
        command: "npm test",
        aggregated_output: "ok",
        exit_code: 0,
        status: "completed",
      },
    }),
  );

  assert.deepEqual(events, [
    {
      type: "item.completed",
      item: {
        id: "command_1",
        type: "command_execution",
        command: "npm test",
        aggregated_output: "ok",
        exit_code: 0,
        status: "completed",
      },
    },
  ]);
});
