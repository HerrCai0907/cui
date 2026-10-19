import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DSH_MODELS,
  DshModel,
  runDshProcess,
  type DshProcessRunner,
} from "../../apps/api/src/infrastructure/ai/DshModel.js";
import { GitDiffService } from "../../apps/api/src/infrastructure/diff/GitDiffService.js";
import { AiRunCancelledError, type AiRunEvent } from "../../apps/api/src/types.js";

test("DSH lists the DeepSeek model catalog", async () => {
  const models = await new DshModel().listModels();

  assert.deepEqual(
    models.map((model) => model.name),
    DSH_MODELS.map((model) => model.name),
  );
  assert.deepEqual(models[0]?.supportedReasoningEfforts, ["none", "low", "high", "max"]);
});

test("DSH uses the headless profile and writes model selection through a patch", async () => {
  const events: AiRunEvent[] = [];
  const calls: Array<{ command: string; args: string[]; patch: string }> = [];
  const processRunner: DshProcessRunner = (input) => {
    const patchPath = input.args[input.args.indexOf("--patch") + 1];

    calls.push({
      command: input.command,
      args: input.args,
      patch: readFileSync(patchPath, "utf8"),
    });
    input.onRawEvent({ type: "stdout", text: "dsh: reasoning\n" });

    return {
      cancel: () => undefined,
      promise: Promise.resolve({
        content: "Done.\n",
        rawEventCount: 1,
        beforeSnapshot: { gitCommit: "base", diff: "before" },
        afterSnapshot: { gitCommit: "base", diff: "after" },
      }),
    };
  };
  const model = new DshModel({ binary: "/test/dsh", processRunner });
  const run = model.createSessionStream(
    {
      workspace: "/tmp",
      prompt: "test prompt",
      models: {
        harness: "dsh",
        normal: "deepseek-v4-pro",
        reasoningEfforts: { normal: "none" },
      },
    },
    (event) => events.push(event),
  );
  const result = await run.result;

  assert.equal(calls[0]?.command, "/test/dsh");
  assert.deepEqual(calls[0]?.args.slice(0, 4), [
    "--profile",
    "headless",
    "--patch",
    calls[0]?.args[3],
  ]);
  assert.equal(calls[0]?.args.at(-1), "test prompt");
  assert.match(calls[0]?.patch ?? "", /model: "deepseek-v4-pro"/);
  assert.match(calls[0]?.patch ?? "", /reasoningEffort: "off"/);
  assert.match(result.sessionId, /^dsh-/);
  assert.equal(result.content, "Done.");
  assert.deepEqual(result.gitDiff, {
    baseCommit: "base",
    beforeDiff: "before",
    afterDiff: "after",
  });
  assert.deepEqual(
    events.filter((event) => event.type === "delta"),
    [{ type: "delta", text: "Done." }],
  );
  assert.deepEqual(
    events.filter((event) => event.type === "raw"),
    [
      {
        type: "raw",
        event: {
          type: "stdout",
          text: "dsh: reasoning\n",
          raw: { type: "stdout", text: "dsh: reasoning\n" },
        },
      },
    ],
  );
});

test("DSH continue keeps the CUI session id and starts a fresh headless run", async () => {
  const calls: string[][] = [];
  const model = new DshModel({
    processRunner: (input) => {
      calls.push(input.args);

      return {
        cancel: () => undefined,
        promise: Promise.resolve({
          content: "Continued",
          rawEventCount: 0,
          beforeSnapshot: { gitCommit: "", diff: "" },
          afterSnapshot: { gitCommit: "", diff: "" },
        }),
      };
    },
  });
  const response = await model.continueSession({
    sessionId: "existing-cui-session",
    workspace: "/tmp",
    prompt: "next prompt",
    models: { harness: "dsh" },
  });

  assert.equal(response.sessionId, "existing-cui-session");
  assert.deepEqual(calls[0], ["--profile", "headless", "next prompt"]);
});

test("DSH process reports missing API token diagnostics", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "cui-dsh-process-"));
  const scriptPath = join(cwd, "fake-dsh.cjs");

  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(
    scriptPath,
    'process.stderr.write("llm-deepseek: no API key for provider route \\"deepseek-official\\"; export DEEPSEEK_API_KEY\\n"); process.exit(1);',
  );

  await assert.rejects(
    runDshProcess({
      command: process.execPath,
      binaryConfig: {
        harness: "dsh",
        command: process.execPath,
        displayName: "DSH",
        envVar: "DSH_BIN",
      },
      args: [scriptPath],
      cwd,
      captureDiff: false,
      diffService: new GitDiffService(),
      onRawEvent: () => undefined,
    }).promise,
    /DSH requires a DeepSeek API token.*DEEPSEEK_API_KEY/,
  );
});

test("DSH cancellation rejects pending promises", async () => {
  let rejectRun!: (error: Error) => void;
  let cancelCalls = 0;
  const model = new DshModel({
    processRunner: () => ({
      promise: new Promise((_resolve, reject) => {
        rejectRun = reject;
      }),
      cancel: () => {
        cancelCalls += 1;
        rejectRun(new AiRunCancelledError());
      },
    }),
  });
  const run = model.createSessionStream(
    { workspace: "/tmp", prompt: "test", models: { harness: "dsh" } },
    () => undefined,
  );

  await new Promise((resolve) => setImmediate(resolve));
  run.cancel();

  await assert.rejects(run.result, AiRunCancelledError);
  assert.equal(cancelCalls, 1);
});
