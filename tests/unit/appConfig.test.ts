import assert from "node:assert/strict";
import test from "node:test";
import {
  APP_CONFIG_STORAGE_KEY,
  createModelRequestPreferences,
  createDefaultAppConfig,
  getExecutionTraceMessageType,
  loadAppConfig,
  saveAppConfig,
} from "../../apps/web/src/features/config/model/appConfig.js";
import type { ExecutionTraceEvent } from "../../apps/web/src/types.js";

type MemoryStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

test("default app config only shows assistant execution trace messages", () => {
  const config = createDefaultAppConfig();

  assert.deepEqual(config.models, {
    normal: "",
    summary: "",
    atomicReview: "",
  });
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

test("app config persists selected models and omits default model requests", () => {
  const storage = new Map<string, string>();
  const originalWindow = globalThis.window;

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        },
        removeItem: (key: string) => {
          storage.delete(key);
        },
      } satisfies MemoryStorage,
    },
  });

  try {
    const config = createDefaultAppConfig();

    config.models.normal = "GPT-5.4";
    config.models.summary = "Seed-2.1-Turbo";
    config.models.atomicReview = "DeepSeek-V4-Pro";
    saveAppConfig(config);

    const loaded = loadAppConfig();

    assert.deepEqual(loaded.models, config.models);
    assert.deepEqual(createModelRequestPreferences(loaded.models), {
      normal: "GPT-5.4",
      summary: "Seed-2.1-Turbo",
      atomicReview: "DeepSeek-V4-Pro",
    });
    assert.equal(createModelRequestPreferences(createDefaultAppConfig().models), undefined);
    assert.equal(JSON.parse(storage.get(APP_CONFIG_STORAGE_KEY) ?? "{}").models.normal, "GPT-5.4");
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  }
});
