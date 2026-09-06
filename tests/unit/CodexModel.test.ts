import assert from "node:assert/strict";
import test from "node:test";
import { CodexModel } from "../../apps/api/src/infrastructure/ai/CodexModel.js";
import type { AiProcessRun } from "../../apps/api/src/infrastructure/ai/aiProcess.js";
import type { AiRunEvent } from "../../apps/api/src/types.js";

type ProcessCall = {
  command?: string;
  args: string[];
  input: string;
};

test("Codex streams completed messages and recovers final output from JSONL", async () => {
  const events: AiRunEvent[] = [];
  const model = new CodexModel({
    processRunner: (input) => {
      const rawEvents = [
        { type: "thread.started", thread_id: "codex-test" },
        { type: "item.completed", item: { type: "agent_message", text: "Working..." } },
        { type: "item.completed", item: { type: "agent_message", text: "Done." } },
        { type: "turn.completed" },
      ];
      rawEvents.forEach(input.onRawEvent);
      return {
        cancel: () => undefined,
        promise: Promise.resolve({
          content: "",
          rawEvents,
          beforeSnapshot: { gitCommit: "", diff: "" },
          afterSnapshot: { gitCommit: "", diff: "" },
        }),
      };
    },
  });
  const run = model.createSessionStream(
    { workspace: "/tmp", prompt: "test", models: { harness: "codex" } },
    (event) => events.push(event),
  );
  assert.equal(await run.sessionId, "codex-test");
  assert.equal((await run.result).content, "Done.");
  assert.deepEqual(
    events.filter((event) => event.type === "delta"),
    [
      { type: "delta", text: "Working...\n\n" },
      { type: "delta", text: "Done.\n\n" },
    ],
  );
});

test("non-streaming startup failures reject without an unhandled session promise", async () => {
  const model = new CodexModel({
    processRunner: () => ({
      cancel: () => undefined,
      promise: Promise.reject(new Error("Codex failed to start")),
    }),
  });
  await assert.rejects(
    model.createSession({ workspace: "/tmp", prompt: "test", models: { harness: "codex" } }),
    /Codex failed to start/,
  );
  await new Promise((resolve) => setImmediate(resolve));
});

test("Codex uses its own command shape without a harness preference", async () => {
  const calls: ProcessCall[] = [];
  const model = new CodexModel({
    binary: "codex",
    processRunner: (input): AiProcessRun => {
      calls.push({ command: input.command, args: input.args, input: input.input });

      return {
        cancel: () => undefined,
        promise: Promise.resolve({
          content: "Done.",
          beforeSnapshot: { gitCommit: "", diff: "" },
          afterSnapshot: { gitCommit: "", diff: "" },
          rawEvents: [{ type: "session_meta", payload: { id: "codex-session-1" } }],
        }),
      };
    },
  });

  await model.createSession({
    workspace: "/tmp/workspace",
    prompt: "Implement the feature.",
    models: {
      normal: "gpt-5.5",
      reasoningEfforts: {
        normal: "high",
      },
    },
  });
  await model.continueSession({
    sessionId: "codex-session-1",
    workspace: "/tmp/workspace",
    prompt: "Continue.",
    models: {
      normal: "gpt-5.5",
    },
  });

  assert.equal(calls[0].command, "codex");
  assert.deepEqual(calls[0].args, [
    "exec",
    "-C",
    "/tmp/workspace",
    "--dangerously-bypass-approvals-and-sandbox",
    "--skip-git-repo-check",
    "--json",
    "-c",
    'model_reasoning_effort="high"',
    "--model",
    "gpt-5.5",
    "-",
  ]);
  assert.equal(calls[1].command, "codex");
  assert.deepEqual(calls[1].args, [
    "exec",
    "resume",
    "codex-session-1",
    "--dangerously-bypass-approvals-and-sandbox",
    "--skip-git-repo-check",
    "--json",
    "--model",
    "gpt-5.5",
    "-",
  ]);
});
