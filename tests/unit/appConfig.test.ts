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

test("default app config shows assistant messages and todo lists in execution trace", () => {
  const config = createDefaultAppConfig();

  assert.deepEqual(config.models, {
    normal: "GPT-5.5",
    summary: "GPT-5.4",
    atomicReview: "GPT-5.5",
  });
  assert.equal(config.harness, "traex");
  assert.equal(config.apiBaseUrl, "");
  assert.deepEqual(config.sshTunnel, {
    enabled: false,
    host: "",
    port: 0,
    username: "",
    password: "",
    localPort: 0,
    remoteHost: "",
    remotePort: 0,
  });
  assert.deepEqual(config.reasoningEfforts, {
    normal: "high",
    summary: "low",
    atomicReview: "medium",
  });
  assert.equal(config.executionTrace.visibleMessageTypes.assistant_message, true);
  assert.equal(config.executionTrace.visibleMessageTypes.command_execution, false);
  assert.equal(config.executionTrace.visibleMessageTypes.reasoning, false);
  assert.equal(config.executionTrace.visibleMessageTypes.file_change, false);
  assert.equal(config.executionTrace.visibleMessageTypes.todo_list, true);
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

test("app config persists selected models and reasoning efforts", () => {
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
    config.harness = "codex";
    config.reasoningEfforts.normal = "medium";
    config.reasoningEfforts.summary = "low";
    config.reasoningEfforts.atomicReview = "xhigh";
    config.sshTunnel.enabled = true;
    config.sshTunnel.host = "server.example";
    config.sshTunnel.port = 2222;
    config.sshTunnel.username = "deploy";
    config.sshTunnel.password = "secret";
    config.sshTunnel.localPort = 18443;
    config.sshTunnel.remoteHost = "127.0.0.1";
    config.sshTunnel.remotePort = 18444;
    saveAppConfig(config);

    const loaded = loadAppConfig();

    assert.deepEqual(loaded.models, config.models);
    assert.equal(loaded.harness, "codex");
    assert.deepEqual(loaded.reasoningEfforts, config.reasoningEfforts);
    assert.deepEqual(loaded.sshTunnel, config.sshTunnel);
    assert.deepEqual(
      createModelRequestPreferences(loaded.harness, loaded.models, loaded.reasoningEfforts),
      {
        harness: "codex",
        normal: "GPT-5.4",
        summary: "Seed-2.1-Turbo",
        atomicReview: "DeepSeek-V4-Pro",
        reasoningEfforts: {
          normal: "medium",
          summary: "low",
          atomicReview: "xhigh",
        },
      },
    );
    assert.deepEqual(
      createModelRequestPreferences(
        createDefaultAppConfig().harness,
        createDefaultAppConfig().models,
        createDefaultAppConfig().reasoningEfforts,
      ),
      {
        harness: "traex",
        normal: "GPT-5.5",
        summary: "GPT-5.4",
        atomicReview: "GPT-5.5",
        reasoningEfforts: {
          normal: "high",
          summary: "low",
          atomicReview: "medium",
        },
      },
    );
    assert.equal(JSON.parse(storage.get(APP_CONFIG_STORAGE_KEY) ?? "{}").harness, "codex");
    assert.equal(JSON.parse(storage.get(APP_CONFIG_STORAGE_KEY) ?? "{}").models.normal, "GPT-5.4");
    assert.equal(
      JSON.parse(storage.get(APP_CONFIG_STORAGE_KEY) ?? "{}").reasoningEfforts.normal,
      "medium",
    );
    assert.equal(
      JSON.parse(storage.get(APP_CONFIG_STORAGE_KEY) ?? "{}").sshTunnel.host,
      "server.example",
    );
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  }
});
