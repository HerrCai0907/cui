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

test("TraeX excludes streamed assistant text from execution trace", async () => {
  const events: AiRunEvent[] = [];
  const model = new TraexModel({
    processRunner: (input): AiProcessRun => {
      const rawEvents = [
        { type: "thread.started", thread_id: "traex-test" },
        { type: "text_delta", text: "Done" },
        { type: "event_msg", payload: { type: "agent_message_delta", delta: "." } },
        { type: "event_msg", payload: { type: "agent_message", message: "Done." } },
        { type: "turn.completed" },
      ];
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
  assert.equal(
    result.trace,
    [
      {
        type: "lifecycle",
        name: "thread.started",
        threadId: "traex-test",
        raw: { type: "thread.started", thread_id: "traex-test" },
      },
      { type: "lifecycle", name: "turn.completed", raw: { type: "turn.completed" } },
    ]
      .map((event) => JSON.stringify(event))
      .join("\n"),
  );
  assert.deepEqual(
    events.filter((event) => event.type === "delta"),
    [
      { type: "delta", text: "Done" },
      { type: "delta", text: "." },
      { type: "delta", text: "Done.\n\n" },
    ],
  );
  assert.deepEqual(
    events.filter((event) => event.type === "raw"),
    [
      {
        type: "raw",
        event: {
          type: "lifecycle",
          name: "thread.started",
          threadId: "traex-test",
          raw: { type: "thread.started", thread_id: "traex-test" },
        },
      },
      {
        type: "raw",
        event: { type: "lifecycle", name: "turn.completed", raw: { type: "turn.completed" } },
      },
    ],
  );
});
