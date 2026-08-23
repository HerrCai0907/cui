import assert from "node:assert/strict";
import test from "node:test";
import { TraexModel } from "../../apps/api/src/infrastructure/ai/TraexModel.js";
import type { TraexProcessRun } from "../../apps/api/src/infrastructure/ai/traexProcess.js";

type ProcessCall = {
  args: string[];
  input: string;
};

test("createAtomicDiffReview retries with validation feedback when item diff format is invalid", async () => {
  const calls: ProcessCall[] = [];
  const model = new TraexModel({
    binary: "traecli",
    processRunner: (input): TraexProcessRun => {
      calls.push({ args: input.args, input: input.input });

      return {
        cancel: () => undefined,
        promise: Promise.resolve({
          content: calls.length === 1 ? invalidAtomicReviewResponse : validAtomicReviewResponse,
          beforeSnapshot: { gitCommit: "", diff: "" },
          afterSnapshot: { gitCommit: "", diff: "" },
          rawEvents: [{ type: "thread.started", thread_id: "analysis-session-1" }],
        }),
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
  assert.deepEqual(calls[1].args.slice(0, 3), ["exec", "resume", "analysis-session-1"]);
  assert.match(calls[1].input, /invalid hunk header \"@@\"/);
  assert.match(calls[1].input, /不要输出 Markdown/);
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
