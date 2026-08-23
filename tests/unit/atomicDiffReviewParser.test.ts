import assert from "node:assert/strict";
import test from "node:test";
import { parseAtomicDiffReviewItems } from "../../apps/api/src/infrastructure/ai/atomicDiffReviewParser.js";

test("parseAtomicDiffReviewItems rejects hunk headers without line ranges", () => {
  const response = JSON.stringify({
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

  assert.throws(() => parseAtomicDiffReviewItems(response), /invalid hunk header "@@"/);
});

test("parseAtomicDiffReviewItems accepts standard unified diff hunks", () => {
  const response = JSON.stringify({
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
          "@@ -1,2 +1,2 @@",
          '-const SIDEBAR_STATE_STORAGE_KEY = "cui:session-sidebar-state:v1";',
          '+const SIDEBAR_STATE_STORAGE_KEY = "cui:session-sidebar-state:v2";',
        ].join("\n"),
      },
    ],
  });

  const items = parseAtomicDiffReviewItems(response);

  assert.equal(items.length, 1);
  assert.equal(items[0].id, "atomic-1");
});
