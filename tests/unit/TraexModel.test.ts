import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { TraexModel } from "../../apps/api/src/infrastructure/ai/TraexModel.js";
import type { TraexProcessRun } from "../../apps/api/src/infrastructure/ai/traexProcess.js";

type ProcessCall = {
  command?: string;
  args: string[];
  input: string;
};

test("createAtomicDiffReview retries with validation feedback when item diff format is invalid", async () => {
  const calls: ProcessCall[] = [];
  let diffFilePath = "";
  let diffFileContent = "";
  const model = new TraexModel({
    binary: "traex",
    processRunner: (input): TraexProcessRun => {
      calls.push({ command: input.command, args: input.args, input: input.input });
      diffFilePath ||= extractDiffFilePath(input.input);

      return {
        cancel: () => undefined,
        promise: (async () => {
          diffFileContent ||= await readFile(diffFilePath, "utf8");

          return {
            content: calls.length === 1 ? invalidAtomicReviewResponse : validAtomicReviewResponse,
            beforeSnapshot: { gitCommit: "", diff: "" },
            afterSnapshot: { gitCommit: "", diff: "" },
            rawEvents: [{ type: "thread.started", thread_id: "analysis-session-1" }],
          };
        })(),
      };
    },
  });

  const review = await model.createAtomicDiffReview({
    workspace: "/tmp/workspace",
    originalSessionId: "session-1",
    round: 1,
    sessionInput: "Update sidebar state.",
    executionTrace: "",
    assistantOutput: "Done.",
    diff: validDiff,
  });

  assert.equal(review.status, "ready");
  assert.equal(calls.length, 2);
  assert.equal(diffFileContent, validDiff);
  assert.doesNotMatch(calls[0].input, /SIDEBAR_STATE_STORAGE_KEY/);
  assert.match(calls[0].input, new RegExp(escapeRegExp(diffFilePath)));
  assert.deepEqual(calls[1].args.slice(0, 3), ["exec", "resume", "analysis-session-1"]);
  assert.match(calls[1].input, new RegExp(escapeRegExp(diffFilePath)));
  assert.match(calls[1].input, /invalid hunk header \"@@\"/);
  assert.match(calls[1].input, /不要输出 Markdown/);
  await assert.rejects(() => readFile(diffFilePath, "utf8"));
});

test("uses separate configured models for normal, summary, and atomic review runs", async () => {
  const calls: ProcessCall[] = [];
  const model = new TraexModel({
    binary: "traex",
    modelListRunner: () =>
      Promise.resolve([
        {
          name: "GPT-5.4",
          provider: "trae",
          description: "Default coding model",
          context_window: 200000,
        },
      ]),
    processRunner: (input): TraexProcessRun => {
      calls.push({ command: input.command, args: input.args, input: input.input });

      return {
        cancel: () => undefined,
        promise: Promise.resolve({
          content: contentForCall(calls.length),
          beforeSnapshot: { gitCommit: "", diff: "" },
          afterSnapshot: { gitCommit: "", diff: "" },
          rawEvents: [{ type: "thread.started", thread_id: `session-${calls.length}` }],
        }),
      };
    },
  });
  const models = {
    normal: "GPT-5.4",
    summary: "Seed-2.1-Turbo",
    atomicReview: "DeepSeek-V4-Pro",
    reasoningEfforts: {
      normal: "high",
      summary: "low",
      atomicReview: "xhigh",
    },
  };

  await model.createSession({
    workspace: "/tmp/workspace",
    prompt: "Implement the feature.",
    models,
  });
  await model.summarizeConversation({
    workspace: "/tmp/workspace",
    prompt: "Summarize the session.",
    models,
  });
  await model.createAtomicDiffReview({
    workspace: "/tmp/workspace",
    originalSessionId: "session-1",
    round: 1,
    sessionInput: "Update sidebar state.",
    executionTrace: "",
    assistantOutput: "Done.",
    diff: validDiff,
    models,
  });

  assert.deepEqual(findModelArgs(calls[0].args), ["--model", "GPT-5.4"]);
  assert.deepEqual(findReasoningEffortArgs(calls[0].args), ["-c", 'model_reasoning_effort="high"']);
  assert.deepEqual(findModelArgs(calls[1].args), ["--model", "Seed-2.1-Turbo"]);
  assert.deepEqual(findReasoningEffortArgs(calls[1].args), ["-c", 'model_reasoning_effort="low"']);
  assert.deepEqual(findModelArgs(calls[2].args), ["--model", "DeepSeek-V4-Pro"]);
  assert.deepEqual(findReasoningEffortArgs(calls[2].args), [
    "-c",
    'model_reasoning_effort="xhigh"',
  ]);
  assert.deepEqual(await model.listModels(), [
    {
      name: "GPT-5.4",
      provider: "trae",
      description: "Default coding model",
      contextWindow: 200000,
    },
  ]);
});

test("uses Codex command shape when configured as the AI harness", async () => {
  const calls: ProcessCall[] = [];
  const model = new TraexModel({
    binary: "traex",
    binaryResolver: (harness) =>
      harness === "codex"
        ? {
            harness,
            command: "codex",
            displayName: "Codex",
            envVar: "CODEX_BIN",
          }
        : {
            harness,
            command: "traex",
            displayName: "TraeX",
            envVar: "TRAEX_BIN",
          },
    processRunner: (input): TraexProcessRun => {
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
      harness: "codex",
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
      harness: "codex",
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

const invalidAtomicReviewResponse = JSON.stringify({
  items: [
    {
      id: "atomic-1",
      order: 1,
      capabilityType: 1,
      title: "Update sidebar state",
      intent: "Migrate sidebar browser state to a list mode.",
      files: ["apps/web/src/features/sessions/model/sessionBrowserState.ts"],
      diff: [
        "diff --git a/apps/web/src/features/sessions/model/sessionBrowserState.ts b/apps/web/src/features/sessions/model/sessionBrowserState.ts",
        "--- a/apps/web/src/features/sessions/model/sessionBrowserState.ts",
        "+++ b/apps/web/src/features/sessions/model/sessionBrowserState.ts",
        "@@",
        '-const SIDEBAR_STATE_STORAGE_KEY = "cui:session-sidebar-state:v1";',
        '+const SIDEBAR_STATE_STORAGE_KEY = "cui:session-sidebar-state:v2";',
      ].join("\n"),
    },
  ],
});

function contentForCall(callCount: number): string {
  if (callCount === 2) {
    return JSON.stringify({
      title: "Session title",
      progress: "Session summary",
    });
  }

  if (callCount === 3) {
    return validAtomicReviewResponse;
  }

  return "Done.";
}

function findModelArgs(args: string[]): string[] {
  const index = args.indexOf("--model");

  return index === -1 ? [] : args.slice(index, index + 2);
}

function findReasoningEffortArgs(args: string[]): string[] {
  const index = args.findIndex((arg) => arg.startsWith("model_reasoning_effort="));

  return index <= 0 ? [] : args.slice(index - 1, index + 1);
}

function extractDiffFilePath(input: string): string {
  const match = /<DIFF_FILE>\n(.+)\n<\/DIFF_FILE>/.exec(input);

  assert.ok(match, "expected atomic review prompt to include a diff file path");

  return match[1];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const validDiff = [
  "diff --git a/apps/web/src/features/sessions/model/sessionBrowserState.ts b/apps/web/src/features/sessions/model/sessionBrowserState.ts",
  "--- a/apps/web/src/features/sessions/model/sessionBrowserState.ts",
  "+++ b/apps/web/src/features/sessions/model/sessionBrowserState.ts",
  "@@ -1,2 +1,2 @@",
  '-const SIDEBAR_STATE_STORAGE_KEY = "cui:session-sidebar-state:v1";',
  '+const SIDEBAR_STATE_STORAGE_KEY = "cui:session-sidebar-state:v2";',
].join("\n");

const validAtomicReviewResponse = JSON.stringify({
  items: [
    {
      id: "atomic-1",
      order: 1,
      capabilityType: 1,
      title: "Update sidebar state",
      intent: "Migrate sidebar browser state to a list mode.",
      files: ["apps/web/src/features/sessions/model/sessionBrowserState.ts"],
      diff: validDiff,
    },
  ],
});
