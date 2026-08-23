import { expect, test } from "@playwright/test";

import { currentWorkspace, mockSession, mockSessions } from "./helpers";

test("loads the new session screen without browser errors", async ({ page }) => {
  const browserErrors: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      browserErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    browserErrors.push(error.message);
  });

  await mockSessions(page, []);

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "New session" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New session" })).toBeVisible();
  await expect(page.getByLabel("Workspace path")).toHaveValue(currentWorkspace);
  await expect(page.getByPlaceholder("Start with an initial prompt...")).toBeVisible();
  await expect(page.getByLabel("Send message")).toBeVisible();
  expect(browserErrors).toEqual([]);
});

test("starts a new session from any workspace row", async ({ page }) => {
  const currentWorkspaceSession = {
    id: "session-1",
    workspace: currentWorkspace,
    title: "Current workspace session",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    messages: [
      {
        id: "message-1",
        role: "assistant",
        kind: "response",
        content: "Current workspace response",
        createdAt: "2026-08-22T00:00:00.000Z",
      },
    ],
    rounds: [],
  };
  const otherWorkspaceSession = {
    id: "session-2",
    workspace: "/Users/bytedance/other",
    title: "Other workspace session",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:01.000Z",
    messages: [
      {
        id: "message-2",
        role: "assistant",
        kind: "response",
        content: "Other workspace response",
        createdAt: "2026-08-22T00:00:01.000Z",
      },
    ],
    rounds: [],
  };

  await mockSessions(page, [otherWorkspaceSession, currentWorkspaceSession]);
  await mockSession(page, otherWorkspaceSession);

  await page.goto("/");

  await expect(
    page.getByRole("button", { name: "New session in /Users/bytedance/cui" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "New session in /Users/bytedance/other" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "New session in /Users/bytedance/other" }).click();

  await expect(page.getByRole("heading", { name: "New session" })).toBeVisible();
  await expect(page.getByLabel("Workspace path")).toHaveValue("/Users/bytedance/other");
  await expect(page.getByPlaceholder("Start with an initial prompt...")).toBeVisible();
});

test("restores the last opened session after a browser refresh", async ({ page }) => {
  const firstSession = {
    id: "session-1",
    workspace: currentWorkspace,
    title: "First session",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    messages: [
      {
        id: "message-1",
        role: "assistant",
        kind: "response",
        content: "First session response",
        createdAt: "2026-08-22T00:00:00.000Z",
      },
    ],
    rounds: [],
  };
  const lastOpenedSession = {
    id: "session-2",
    workspace: currentWorkspace,
    title: "Last opened session",
    createdAt: "2026-08-22T00:00:01.000Z",
    updatedAt: "2026-08-22T00:00:01.000Z",
    messages: [
      {
        id: "message-2",
        role: "assistant",
        kind: "response",
        content: "Last opened session response",
        createdAt: "2026-08-22T00:00:01.000Z",
      },
    ],
    rounds: [],
  };

  await mockSessions(page, [firstSession, lastOpenedSession]);
  await mockSession(page, lastOpenedSession);

  await page.goto("/");
  await expect(page.getByText("First session response")).toBeVisible();

  await page.getByRole("button", { name: /Last opened session/ }).click();
  await expect(page.getByText("Last opened session response")).toBeVisible();
  await expect(
    page.evaluate(() => localStorage.getItem("cui:last-active-session-id:v1")),
  ).resolves.toBe("session-2");
  await page.reload();

  await expect(page.getByText("Last opened session response")).toBeVisible();
  await expect(page.getByText("First session response")).not.toBeVisible();
  await expect(page.getByRole("button", { name: /Last opened session/ })).toHaveClass(/is-active/);
});

test("renders assistant inline and fenced code blocks", async ({ page }) => {
  const session = {
    id: "session-1",
    workspace: currentWorkspace,
    title: "Code rendering session",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    messages: [
      {
        id: "message-1",
        role: "assistant",
        kind: "response",
        content: "Use `npm test` before merging.\n\n```ts\nconst ok = true;\n```",
        createdAt: "2026-08-22T00:00:00.000Z",
      },
    ],
    rounds: [],
  };

  await mockSessions(page, [session]);
  await mockSession(page, session);

  await page.goto("/");

  await expect(page.locator(".message-inline-code")).toHaveText("npm test");
  await expect(page.locator(".message-code-block code")).toHaveText("const ok = true;");
  await expect(page.locator(".message-code-block code")).toHaveAttribute("data-language", "ts");
});

test("shows full review separately from completed atomic review in assistant messages", async ({
  page,
}) => {
  const session = {
    id: "session-review-buttons",
    workspace: currentWorkspace,
    title: "Review button session",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    messages: [
      {
        id: "message-1",
        role: "assistant",
        kind: "response",
        round: 1,
        content: "First response",
        createdAt: "2026-08-22T00:00:00.000Z",
      },
      {
        id: "message-2",
        role: "assistant",
        kind: "response",
        round: 2,
        content: "Second response",
        createdAt: "2026-08-22T00:00:01.000Z",
      },
    ],
    rounds: [
      {
        round: 1,
        hasChanges: true,
        createdAt: "2026-08-22T00:00:00.000Z",
      },
      {
        round: 2,
        hasChanges: true,
        createdAt: "2026-08-22T00:00:01.000Z",
        atomicReviewStatus: "ready",
      },
    ],
  };

  await mockSessions(page, [session]);
  await mockSession(page, session);

  await page.goto("/");

  const pendingReviewGroup = page.getByLabel("Round 1 reviews");
  const readyReviewGroup = page.getByLabel("Round 2 reviews");

  await expect(pendingReviewGroup.getByRole("button", { name: "Atomic review" })).toHaveCount(0);
  await expect(pendingReviewGroup.getByRole("button", { name: "Full review" })).toBeVisible();
  await expect(readyReviewGroup.getByRole("button", { name: "Atomic review" })).toBeVisible();
  await expect(readyReviewGroup.getByRole("button", { name: "Full review" })).toBeVisible();

  const fullReviewPopupPromise = page.waitForEvent("popup");
  await pendingReviewGroup.getByRole("button", { name: "Full review" }).click();
  const fullReviewPopup = await fullReviewPopupPromise;

  await mockSessions(fullReviewPopup, [session]);
  await mockSession(fullReviewPopup, session);
  await expect(fullReviewPopup).toHaveURL(
    /\/ui\/sessions\/session-review-buttons\/rounds\/1\/full_review$/,
  );
  await fullReviewPopup.close();

  const atomicReviewPopupPromise = page.waitForEvent("popup");
  await readyReviewGroup.getByRole("button", { name: "Atomic review" }).click();
  const atomicReviewPopup = await atomicReviewPopupPromise;

  await mockSessions(atomicReviewPopup, [session]);
  await mockSession(atomicReviewPopup, session);
  await expect(atomicReviewPopup).toHaveURL(
    /\/ui\/sessions\/session-review-buttons\/rounds\/2\/atomic_review$/,
  );
  await atomicReviewPopup.close();
});
