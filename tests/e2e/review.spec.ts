import { expect, test } from "@playwright/test";

import {
  createSubmittedRunResponse,
  currentWorkspace,
  fulfillJson,
  mockRoundReview,
  mockSession,
  mockSessions,
} from "./helpers";

test("renders atomic review output for a round diff", async ({ page }) => {
  const browserErrors: string[] = [];
  const session = {
    id: "session-1",
    workspace: currentWorkspace,
    title: "Atomic review session",
    summary: "A session with a reviewed diff.",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    messages: [],
    rounds: [
      {
        round: 1,
        hasChanges: true,
        createdAt: "2026-08-22T00:00:00.000Z",
      },
    ],
  };
  const diff = [
    "diff --git a/src/example.ts b/src/example.ts",
    "--- a/src/example.ts",
    "+++ b/src/example.ts",
    "@@ -1,3 +1,4 @@",
    " export function value() {",
    "-  return 1;",
    "+  return 2;",
    " }",
  ].join("\n");
  const testDiff = [
    "diff --git a/tests/example.ts b/tests/example.ts",
    "--- a/tests/example.ts",
    "+++ b/tests/example.ts",
    "@@ -1,3 +1,4 @@",
    ' test("value", () => {',
    "-  expect(value()).toBe(1);",
    "+  expect(value()).toBe(2);",
    " });",
  ].join("\n");

  page.on("console", (message) => {
    if (message.type() === "error") {
      browserErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    browserErrors.push(error.message);
  });

  await mockSessions(page, [session]);
  await mockSession(page, session);
  await mockRoundReview(page, "session-1", 1, {
    round: 1,
    beforeDiff: "",
    afterDiff: diff,
    diff,
    hasChanges: true,
    createdAt: "2026-08-22T00:00:00.000Z",
    atomicReview: {
      status: "ready",
      generatedAt: "2026-08-22T00:00:00.000Z",
      analysisSessionId: "analysis-session-1",
      rawResponse: "",
      items: [
        {
          id: "atomic-1",
          order: 1,
          capabilityType: 3,
          capabilityLabel: "局部修复",
          title: "Adjust return value",
          intent: "Change the local function behavior to return the new value.",
          files: ["src/example.ts"],
          diff,
          outputJson: {
            id: "atomic-1",
            order: 1,
            capability_type: 3,
            capability_label: "局部修复",
            title: "Adjust return value",
            intent: "Change the local function behavior to return the new value.",
            files: ["src/example.ts"],
          },
        },
        {
          id: "atomic-2",
          order: 2,
          capabilityType: 5,
          capabilityLabel: "测试修改",
          title: "Update value assertion",
          intent: "Adjust the test assertion for the updated value() output.",
          files: ["tests/example.ts"],
          diff: testDiff,
          outputJson: {
            id: "atomic-2",
            order: 2,
            capability_type: 5,
            capability_label: "测试修改",
            title: "Update value assertion",
            intent: "Adjust the test assertion for the updated value() output.",
            files: ["tests/example.ts"],
          },
        },
      ],
    },
  });

  await page.goto("/ui/sessions/session-1/rounds/1/atomic_review");

  await expect(page.getByRole("heading", { name: "Round 1" })).toBeVisible();
  await expect(page.getByText("2 atomic changes")).toBeVisible();
  await expect(page.getByText("Round changes")).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "Adjust return value" })).toBeVisible();
  await expect(page.getByText("src/example.ts").first()).toBeVisible();
  const reviewNavigation = page.getByRole("navigation", {
    name: "Atomic review navigation",
  });

  await expect(reviewNavigation.getByText("Atomic Review", { exact: true })).toBeVisible();
  await expect(
    reviewNavigation.getByRole("button", { name: /1\. Adjust return value/ }),
  ).toBeVisible();
  await expect(
    reviewNavigation.getByRole("button", { name: /2\. Update value assertion/ }),
  ).toBeVisible();
  await expect(reviewNavigation.getByRole("button", { name: /src\/example\.ts/ })).toBeVisible();
  await expect(reviewNavigation.getByRole("button", { name: /tests\/example\.ts/ })).toBeVisible();
  await expect(reviewNavigation.getByRole("button", { name: /^example\.ts$/ })).toHaveCount(0);
  const atomicChange = page
    .locator(".atomic-review-item")
    .filter({ hasText: "Adjust return value" });
  const intent = atomicChange.getByText(
    "Change the local function behavior to return the new value.",
    { exact: true },
  );
  const testChange = page
    .locator(".atomic-review-item")
    .filter({ hasText: "Update value assertion" });

  await expect(atomicChange.getByText("+  return 2;")).toBeVisible();
  await expect(
    atomicChange.locator(".review-diff-code-highlight .hljs-keyword").filter({ hasText: "return" }),
  ).toHaveCount(2);
  await expect(
    atomicChange.locator(".review-diff-code-highlight .hljs-number").filter({ hasText: "2" }),
  ).toHaveCount(1);
  await expect(testChange).toHaveClass(/is-capability-test/);
  await expect(testChange.getByText("+  expect(value()).toBe(2);")).toBeVisible();
  await atomicChange.getByRole("button", { name: "Approve all" }).click();
  await expect(reviewNavigation.getByRole("button", { name: /src\/example\.ts/ })).toHaveCount(0);
  await expect(reviewNavigation.getByText("approved")).toHaveCount(0);
  await expect(reviewNavigation.getByText("pending")).toHaveCount(0);
  await expect(atomicChange.getByText("+  return 2;")).not.toBeVisible();
  await atomicChange.getByRole("button", { name: "Unapprove all" }).click();
  await expect(atomicChange.getByText("+  return 2;")).toBeVisible();
  await expect(reviewNavigation.getByRole("button", { name: /src\/example\.ts/ })).toBeVisible();
  await atomicChange.getByLabel("Approve src/example.ts").check();
  await expect(atomicChange.getByText("+  return 2;")).not.toBeVisible();
  await atomicChange.getByLabel("Approve src/example.ts").uncheck();
  await expect(atomicChange.getByText("+  return 2;")).toBeVisible();
  await atomicChange.getByLabel("Collapse atomic change 1").click();
  await expect(page.getByRole("heading", { name: "Adjust return value" })).toBeVisible();
  await expect(intent).toBeVisible();
  await expect(atomicChange.getByText("+  return 2;")).not.toBeVisible();
  await reviewNavigation.getByRole("button", { name: /src\/example\.ts/ }).click();
  await expect(page.getByLabel("Collapse atomic change 1")).toBeVisible();
  await expect(atomicChange.getByText("+  return 2;")).toBeVisible();
  await atomicChange.getByLabel("Collapse atomic change 1").click();
  await page.reload();
  await expect(page.getByLabel("Expand atomic change 1")).toBeVisible();
  await expect(atomicChange.getByText("+  return 2;")).not.toBeVisible();
  await atomicChange.getByLabel("Expand atomic change 1").click();
  await expect(intent).toBeVisible();
  await atomicChange.getByLabel("Approve src/example.ts").check();
  await page.reload();
  await expect(atomicChange.getByText("+  return 2;")).not.toBeVisible();
  await expect(page.getByText("JSON output")).toHaveCount(0);
  await page.getByRole("button", { name: "Full review" }).click();
  await expect(page).toHaveURL(/\/ui\/sessions\/session-1\/rounds\/1\/full_review$/);
  await expect(page.getByText("Round changes")).toBeVisible();
  await expect(page.getByText("2 atomic changes")).not.toBeVisible();
  await expect(page.getByText("+  return 2;").first()).toBeVisible();
  await page.getByLabel("Approve src/example.ts").check();
  await page.reload();
  await expect(page.getByText("+  return 2;").first()).not.toBeVisible();
  expect(
    await page.evaluate(() => {
      const rawState = localStorage.getItem("cui:review-state:v1:session-1:1");

      if (!rawState) {
        return null;
      }

      const state = JSON.parse(rawState) as {
        expiresAt?: number;
        updatedAt?: number;
      };

      return {
        ttlMs: (state.expiresAt ?? 0) - (state.updatedAt ?? 0),
      };
    }),
  ).toEqual({ ttlMs: 7 * 24 * 60 * 60 * 1000 });

  await page.evaluate(() => {
    localStorage.setItem(
      "cui:review-state:v1:session-1:1",
      JSON.stringify({
        version: 1,
        fullApprovedFileIds: ["0:src/example.ts"],
        atomicItems: {
          "atomic-1": {
            collapsed: true,
            approvedFileIds: ["0:src/example.ts"],
          },
        },
        updatedAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
        expiresAt: Date.now() - 1,
      }),
    );
  });
  await page.goto("/ui/sessions/session-1/rounds/1/atomic_review");
  await expect(page.getByLabel("Collapse atomic change 1")).toBeVisible();
  await expect(page.getByText("+  return 2;")).toBeVisible();
  await expect(
    page.evaluate(() => localStorage.getItem("cui:review-state:v1:session-1:1")),
  ).resolves.toBeNull();
  expect(browserErrors).toEqual([]);
});

test("expands review diff context by 10 lines in each direction", async ({ page }) => {
  const session = {
    id: "session-context",
    workspace: currentWorkspace,
    title: "Context expansion session",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    messages: [],
    rounds: [
      {
        round: 1,
        hasChanges: true,
        createdAt: "2026-08-22T00:00:00.000Z",
      },
    ],
  };
  const contextLines = Array.from(
    { length: 40 },
    (_, index) => ` const value${index + 1} = ${index + 1};`,
  );
  const diff = [
    "diff --git a/src/context.ts b/src/context.ts",
    "--- a/src/context.ts",
    "+++ b/src/context.ts",
    "@@ -1,40 +1,40 @@",
    ...contextLines.slice(0, 19),
    "-const value20 = 20;",
    "+const value20 = 200;",
    ...contextLines.slice(20),
  ].join("\n");

  await mockSessions(page, [session]);
  await mockSession(page, session);
  await mockRoundReview(page, "session-context", 1, {
    round: 1,
    beforeDiff: "",
    afterDiff: diff,
    diff,
    hasChanges: true,
    createdAt: "2026-08-22T00:00:00.000Z",
  });

  await page.goto("/ui/sessions/session-context/rounds/1/full_review");

  await expect(page.getByText(" const value17 = 17;")).toBeVisible();
  await expect(page.getByText(" const value16 = 16;")).not.toBeVisible();
  await expect(page.getByText(" const value23 = 23;")).toBeVisible();
  await expect(page.getByText(" const value24 = 24;")).not.toBeVisible();

  await page.getByLabel("Expand 10 lines up").click();
  await expect(page.getByText(" const value7 = 7;")).toBeVisible();
  await expect(page.getByText(" const value6 = 6;")).not.toBeVisible();

  await page.getByLabel("Expand 10 lines down").click();
  await expect(page.getByText(" const value33 = 33;")).toBeVisible();
  await expect(page.getByText(" const value34 = 34;")).not.toBeVisible();
});

test("sends all atomic review comments together", async ({ page }) => {
  const session = {
    id: "session-comment",
    workspace: currentWorkspace,
    title: "Atomic comment session",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    messages: [],
    rounds: [
      {
        round: 1,
        hasChanges: true,
        createdAt: "2026-08-22T00:00:00.000Z",
      },
    ],
    currentRound: 1,
    isRunning: false,
  };
  const startedSession = {
    ...session,
    messages: [
      {
        id: "message-1",
        role: "user",
        content: "Please simplify this function.",
        createdAt: "2026-08-22T00:01:00.000Z",
      },
    ],
    isRunning: true,
    runningRunId: "run-comment",
  };
  const diff = [
    "diff --git a/src/example.ts b/src/example.ts",
    "--- a/src/example.ts",
    "+++ b/src/example.ts",
    "@@ -1,3 +1,4 @@",
    " export function value() {",
    "-  return 1;",
    "+  return 2;",
    " }",
  ].join("\n");
  const testDiff = [
    "diff --git a/tests/example.ts b/tests/example.ts",
    "--- a/tests/example.ts",
    "+++ b/tests/example.ts",
    "@@ -1,3 +1,4 @@",
    ' test("value", () => {',
    "-  expect(value()).toBe(1);",
    "+  expect(value()).toBe(2);",
    " });",
  ].join("\n");
  let submittedPrompt = "";

  await mockSessions(page, [session]);
  await mockSession(page, session);
  await mockRoundReview(page, "session-comment", 1, {
    round: 1,
    beforeDiff: "",
    afterDiff: diff,
    diff,
    hasChanges: true,
    createdAt: "2026-08-22T00:00:00.000Z",
    atomicReview: {
      status: "ready",
      generatedAt: "2026-08-22T00:00:00.000Z",
      analysisSessionId: "analysis-session-comment",
      rawResponse: "",
      items: [
        {
          id: "atomic-1",
          order: 1,
          capabilityType: 3,
          capabilityLabel: "局部修复",
          title: "Adjust return value",
          intent: "Change the local function behavior to return the new value.",
          files: ["src/example.ts"],
          diff,
          outputJson: {},
        },
        {
          id: "atomic-2",
          order: 2,
          capabilityType: 5,
          capabilityLabel: "测试修改",
          title: "Update value assertion",
          intent: "Adjust the test assertion for the updated value() output.",
          files: ["tests/example.ts"],
          diff: testDiff,
          outputJson: {},
        },
      ],
    },
  });
  await page.route("**/api/v1/sessions/session-comment/runs", async (route) => {
    const body = route.request().postDataJSON() as { input: { prompt: string } };

    submittedPrompt = body.input.prompt;
    await fulfillJson(route, createSubmittedRunResponse(startedSession, "run-comment"));
  });
  await page.route("**/api/v1/runs/run-comment/events", async () => {
    // Keep the stream open so the review send flow can switch back to the session view.
  });

  await page.goto("/ui/sessions/session-comment/rounds/1/atomic_review");

  const firstChange = page
    .locator(".atomic-review-item")
    .filter({ hasText: "Adjust return value" });
  const secondChange = page
    .locator(".atomic-review-item")
    .filter({ hasText: "Update value assertion" });
  const sendCommentsButton = page.getByRole("button", {
    name: "Send 0 atomic review comments",
  });

  await expect(sendCommentsButton).toBeDisabled();
  await firstChange.getByRole("button", { name: "Comment on added diff line 2" }).click();
  await expect(firstChange.getByPlaceholder("Comment on this diff line...")).toBeVisible();
  await expect(
    firstChange
      .locator(".review-diff-row-add", { hasText: "return 2;" })
      .locator("+ .review-diff-inline-comment"),
  ).toBeVisible();
  await firstChange
    .getByPlaceholder("Comment on this diff line...")
    .fill("Please simplify this function.");
  await page.reload();
  await expect(firstChange.getByPlaceholder("Comment on this diff line...")).toHaveValue(
    "Please simplify this function.",
  );
  await expect(page.getByRole("button", { name: "Send 1 atomic review comment" })).toBeEnabled();

  await secondChange.getByRole("button", { name: "Comment on added diff line 2" }).click();
  await secondChange
    .getByPlaceholder("Comment on this diff line...")
    .fill("Please align the test name too.");
  await page.getByRole("button", { name: "Send 2 atomic review comments" }).click();

  await expect(page).toHaveURL("/");
  expect(submittedPrompt).toContain("Please simplify this function.");
  expect(submittedPrompt).toContain("Please align the test name too.");
  expect(submittedPrompt).toContain("Atomic review 1. Adjust return value");
  expect(submittedPrompt).toContain("Atomic review 2. Update value assertion");
  expect(submittedPrompt).toContain("+  return 2;");
  expect(submittedPrompt).toContain("+  expect(value()).toBe(2);");
});
