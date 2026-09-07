import assert from "node:assert/strict";
import test from "node:test";
import { TraexModel } from "../../apps/api/src/infrastructure/ai/TraexModel.js";
import type { AiProcessRun } from "../../apps/api/src/infrastructure/ai/aiProcess.js";
import type { AiRunEvent } from "../../apps/api/src/types.js";

test("TraeX lists and normalizes its model catalog", async () => {
  const model = new TraexModel({
    modelListRunner: async () => [
      {
        name: " GPT-5.4 ",
        provider: "trae",
        description: "Default coding model",
        context_window: 200000,
      },
      null,
      { name: " " },
    ],
  });
  assert.deepEqual(await model.listModels(), [
    {
      name: "GPT-5.4",
      provider: "trae",
      description: "Default coding model",
      contextWindow: 200000,
    },
  ]);
});

test("TraeX keeps normalized execution trace messages without duplicating response deltas", async () => {
  const events: AiRunEvent[] = [];
  const rawEvents = [
    { type: "thread.started", thread_id: "traex-test" },
    { type: "text_delta", text: "Done" },
    { type: "item.completed", item: { id: "item_0", type: "agent_message", text: "Done." } },
    { type: "turn.completed" },
  ];
  const traceEvents = [
    {
      type: "lifecycle",
      name: "thread.started",
      threadId: "traex-test",
      raw: { type: "thread.started", thread_id: "traex-test" },
    },
    {
      type: "assistant_message",
      text: "Done",
      raw: { type: "text_delta", text: "Done" },
    },
    {
      type: "assistant_message",
      id: "item_0",
      phase: "completed",
      text: "Done.",
      raw: {
        type: "item.completed",
        item: { id: "item_0", type: "agent_message", text: "Done." },
      },
    },
    { type: "lifecycle", name: "turn.completed", raw: { type: "turn.completed" } },
  ];
  const model = new TraexModel({
    processRunner: (input): AiProcessRun => {
      rawEvents.forEach(input.onRawEvent);

      return {
        cancel: () => undefined,
        promise: Promise.resolve({
          content: "Done.",
          rawEvents,
          beforeSnapshot: { gitCommit: "", diff: "" },
          afterSnapshot: { gitCommit: "", diff: "" },
        }),
      };
    },
  });
  const run = model.createSessionStream(
    { workspace: "/tmp", prompt: "test", models: { harness: "traex" } },
    (event) => events.push(event),
  );
  const result = await run.result;

  assert.equal(result.content, "Done.");
  assert.equal(result.trace, traceEvents.map((event) => JSON.stringify(event)).join("\n"));
  assert.deepEqual(
    events.filter((event) => event.type === "delta"),
    [{ type: "delta", text: "Done" }],
  );
  assert.deepEqual(
    events.filter((event) => event.type === "raw"),
    traceEvents.map((event) => ({ type: "raw", event })),
  );
});
