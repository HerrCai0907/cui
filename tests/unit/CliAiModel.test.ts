import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CodexModel } from "../../apps/api/src/infrastructure/ai/CodexModel.js";
import { TraexModel } from "../../apps/api/src/infrastructure/ai/TraexModel.js";
import type { AiProcessRun } from "../../apps/api/src/infrastructure/ai/aiProcess.js";
import type { AiModelPreferences } from "../../apps/api/src/types.js";

type ProcessCall = {
  command?: string;
  args: string[];
  input: string;
};

for (const Model of [TraexModel, CodexModel]) {
  test(`${Model.name} retries atomic review with validation feedback when item diff format is invalid`, async () => {
    const calls: ProcessCall[] = [];
    let diffFilePath = "";
    let executionTraceFilePath = "";
    let diffFileContent = "";
    let executionTraceFileContent = "";
    const model = new Model({
      binary: "/test/ai-cli",
      processRunner: (input): AiProcessRun => {
        calls.push({ command: input.command, args: input.args, input: input.input });
        diffFilePath ||= extractDiffFilePath(input.input);
        executionTraceFilePath ||= extractExecutionTraceFilePath(input.input);

        return {
          cancel: () => undefined,
          promise: (async () => {
            diffFileContent ||= await readFile(diffFilePath, "utf8");
            executionTraceFileContent ||= await readFile(executionTraceFilePath, "utf8");

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
      executionTrace: "large trace payload with TOOL_OUTPUT_123",
      assistantOutput: "Done.",
      diff: validDiff,
    });

    assert.equal(review.status, "ready");
    assert.equal(calls.length, 2);
    assert.equal(calls[1].command, calls[0].command);
    assert.ok(
      calls[1].args.includes(
        Model === CodexModel ? "--dangerously-bypass-approvals-and-sandbox" : "--permission-mode",
      ),
    );
    assert.equal(diffFileContent, validDiff);
    assert.equal(executionTraceFileContent, "large trace payload with TOOL_OUTPUT_123");
    assert.doesNotMatch(calls[0].input, /SIDEBAR_STATE_STORAGE_KEY/);
    assert.doesNotMatch(calls[0].input, /TOOL_OUTPUT_123/);
    assert.match(calls[0].input, new RegExp(escapeRegExp(diffFilePath)));
    assert.match(calls[0].input, new RegExp(escapeRegExp(executionTraceFilePath)));
    assert.deepEqual(calls[1].args.slice(0, 3), ["exec", "resume", "analysis-session-1"]);
    assert.match(calls[1].input, new RegExp(escapeRegExp(diffFilePath)));
    assert.match(calls[1].input, /invalid hunk header \"@@\"/);
    assert.match(calls[1].input, /不要输出 Markdown/);
    await assert.rejects(() => readFile(diffFilePath, "utf8"));
    await assert.rejects(() => readFile(executionTraceFilePath, "utf8"));
  });

  test(`${Model.name} uses separate configured models for normal, summary, and atomic review runs`, async () => {
    const calls: ProcessCall[] = [];
    const model = new Model({
      binary: "/test/ai-cli",
      processRunner: (input): AiProcessRun => {
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
    const models: AiModelPreferences = {
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
    assert.deepEqual(findReasoningEffortArgs(calls[0].args), [
      "-c",
      'model_reasoning_effort="high"',
    ]);
    assert.deepEqual(findModelArgs(calls[1].args), ["--model", "Seed-2.1-Turbo"]);
    assert.deepEqual(findReasoningEffortArgs(calls[1].args), [
      "-c",
      'model_reasoning_effort="low"',
    ]);
    assert.deepEqual(findModelArgs(calls[2].args), ["--model", "DeepSeek-V4-Pro"]);
    assert.deepEqual(findReasoningEffortArgs(calls[2].args), [
      "-c",
      'model_reasoning_effort="xhigh"',
    ]);
  });
}

test("backend-specific final response handling preserves TraeX empty output and Codex validation", async () => {
  const options = {
    processRunner: (): AiProcessRun => ({
      cancel: () => undefined,
      promise: Promise.resolve({
        content: "  ",
        rawEvents: [{ type: "thread.started", thread_id: "session-1" }],
        beforeSnapshot: { gitCommit: "", diff: "" },
        afterSnapshot: { gitCommit: "", diff: "" },
      }),
    }),
  };
  const input = { workspace: "/tmp", prompt: "test" };
  assert.equal((await new TraexModel(options).createSession(input)).content, "");
  await assert.rejects(
    new CodexModel(options).createSession(input),
    /Codex did not return an assistant message/,
  );
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

function extractExecutionTraceFilePath(input: string): string {
  const match = /<EXECUTION_TRACE_FILE>\n(.+)\n<\/EXECUTION_TRACE_FILE>/.exec(input);

  assert.ok(match, "expected atomic review prompt to include an execution trace file path");

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
