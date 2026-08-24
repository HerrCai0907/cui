import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultAppConfig,
  getExecutionTraceMessageType,
} from "../../apps/web/src/features/config/model/appConfig.js";
import type { ExecutionTraceEvent } from "../../apps/web/src/types.js";

test("default app config only shows assistant execution trace messages", () => {
  const config = createDefaultAppConfig();

  assert.equal(config.executionTrace.visibleMessageTypes.assistant_message, true);
  assert.equal(config.executionTrace.visibleMessageTypes.command_execution, false);
  assert.equal(config.executionTrace.visibleMessageTypes.reasoning, false);
  assert.equal(config.executionTrace.visibleMessageTypes.file_change, false);
  assert.equal(config.executionTrace.visibleMessageTypes.todo_list, false);
  assert.equal(config.executionTrace.visibleMessageTypes.lifecycle, false);
  assert.equal(config.executionTrace.visibleMessageTypes.metadata, false);
  assert.equal(config.executionTrace.visibleMessageTypes.stdout, false);
  assert.equal(config.executionTrace.visibleMessageTypes.unknown, false);
});

test("execution trace message type classification handles supported events", () => {
  const events: Array<[ExecutionTraceEvent, string]> = [
    [
      {
        type: "item.completed",
        item: { id: "item_assistant", type: "agent_message", text: "done" },
      },
      "assistant_message",
    ],
    [
      {
        type: "item.completed",
        item: { id: "item_command", type: "command_execution" },
      },
      "command_execution",
    ],
    [
      {
        type: "item.completed",
        item: { id: "item_reasoning", type: "reasoning" },
      },
      "reasoning",
    ],
    [
      {
        type: "item.completed",
        item: { id: "item_file_change", type: "unknown", originalType: "file_change" },
      },
      "file_change",
    ],
    [
      {
        type: "item.updated",
        item: { id: "item_todo", type: "todo_list", items: [] },
      },
      "todo_list",
    ],
    [{ type: "turn.completed" }, "lifecycle"],
    [{ type: "session_meta", payload: {} }, "metadata"],
    [{ type: "text_delta", text: "stream" }, "assistant_message"],
    [{ type: "stdout", text: "output" }, "stdout"],
  ];

  assert.deepEqual(
    events.map(([event, expected]) => [getExecutionTraceMessageType(event), expected]),
    events.map(([, expected]) => [expected, expected]),
  );
});
