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

test("reuses the composer draft between new and existing sessions", async ({ page }) => {
  const session = {
    id: "session-1",
    workspace: currentWorkspace,
    title: "Existing session",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    messages: [
      {
        id: "message-1",
        role: "assistant",
        kind: "response",
        content: "Existing session response",
        createdAt: "2026-08-22T00:00:00.000Z",
      },
    ],
    rounds: [],
  };
  const draft = "Draft prompt that should survive navigation";

  await mockSessions(page, [session]);
  await mockSession(page, session);

  await page.goto("/");
  await page.getByRole("button", { name: "New session", exact: true }).click();
  await page.getByPlaceholder("Start with an initial prompt...").fill(draft);

  await page.getByRole("button", { name: "Existing session" }).click();

  await expect(page.getByRole("heading", { name: "Existing session" })).toBeVisible();
  await expect(page.getByPlaceholder("Continue this session...")).toHaveValue(draft);

  await page.getByRole("button", { name: "New session", exact: true }).click();

  await expect(page.getByRole("heading", { name: "New session" })).toBeVisible();
  await expect(page.getByPlaceholder("Start with an initial prompt...")).toHaveValue(draft);
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

test("shows the active session branch in the right side of the title bar", async ({ page }) => {
  const session = {
    id: "session-branch",
    workspace: currentWorkspace,
    title: "Branch display session",
    summary: "Branch name is shown in the header",
    gitBranch: "feature/session-branch",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    currentRound: 1,
    isRunning: false,
    messages: [
      {
        id: "message-1",
        role: "assistant",
        kind: "response",
        content: "Branch display response",
        createdAt: "2026-08-22T00:00:00.000Z",
      },
    ],
    rounds: [],
  };

  await mockSessions(page, [session]);
  await mockSession(page, session);

  await page.goto("/");

  const title = page.getByRole("heading", { name: "Branch display session" });
  const branch = page.getByLabel("Current branch feature/session-branch");

  await expect(title).toBeVisible();
  await expect(branch).toBeVisible();

  const [titleBox, branchBox] = await Promise.all([title.boundingBox(), branch.boundingBox()]);

  expect(titleBox).not.toBeNull();
  expect(branchBox).not.toBeNull();
  expect(branchBox!.x).toBeGreaterThan(titleBox!.x + titleBox!.width);
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

test("renders assistant markdown bold and italic text", async ({ page }) => {
  const session = {
    id: "session-1",
    workspace: currentWorkspace,
    title: "Inline emphasis session",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    messages: [
      {
        id: "message-1",
        role: "assistant",
        kind: "response",
        content: "Use **bold text** and *italic text*.\n\n```\n**literal** and *literal*\n```",
        createdAt: "2026-08-22T00:00:00.000Z",
      },
    ],
    rounds: [],
  };

  await mockSessions(page, [session]);
  await mockSession(page, session);

  await page.goto("/");

  await expect(page.locator(".message-content strong")).toHaveText("bold text");
  await expect(page.locator(".message-content em")).toHaveText("italic text");
  await expect(page.locator(".message-code-block code")).toHaveText("**literal** and *literal*");
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

test("keeps the current scroll position while pending atomic review refreshes", async ({
  page,
}) => {
  const messages = Array.from({ length: 24 }, (_, index) => ({
    id: `message-${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    kind: "response",
    content: `Message ${index}\n${"Review context line ".repeat(80)}`,
    createdAt: "2026-08-22T00:00:00.000Z",
  }));
  let refreshCount = 0;
  const session = {
    id: "session-pending-review-scroll",
    workspace: currentWorkspace,
    title: "Pending review session",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    currentRound: 1,
    isRunning: false,
    messages,
    rounds: [
      {
        round: 1,
        hasChanges: true,
        createdAt: "2026-08-22T00:00:00.000Z",
      },
    ],
  };

  await mockSessions(page, () => {
    refreshCount += 1;

    return [
      {
        ...session,
        updatedAt: `2026-08-22T00:00:0${refreshCount % 10}.000Z`,
      },
    ];
  });

  await page.goto("/");
  const messageStream = page.locator(".message-stream");

  await expect(page.getByText("Message 23")).toBeVisible();
  await messageStream.evaluate((element) => {
    element.scrollTop = Math.floor(element.scrollHeight / 3);
    element.dispatchEvent(new Event("scroll"));
  });
  const scrollTopBeforeRefresh = await messageStream.evaluate((element) => element.scrollTop);

  await expect
    .poll(() => refreshCount, {
      timeout: 5000,
    })
    .toBeGreaterThan(1);

  const scrollTopAfterRefresh = await messageStream.evaluate((element) => element.scrollTop);
  await expect(scrollTopAfterRefresh).toBe(scrollTopBeforeRefresh);
});

test("renders assistant markdown headings", async ({ page }) => {
  const session = {
    id: "session-1",
    workspace: currentWorkspace,
    title: "Heading rendering session",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    messages: [
      {
        id: "message-1",
        role: "assistant",
        kind: "response",
        content:
          "Intro line\n\n## Review `summary`\nBody text\n\n```md\n# Not a rendered heading\n```",
        createdAt: "2026-08-22T00:00:00.000Z",
      },
    ],
    rounds: [],
  };

  await mockSessions(page, [session]);
  await mockSession(page, session);

  await page.goto("/");

  await expect(page.getByRole("heading", { level: 2, name: "Review summary" })).toBeVisible();
  await expect(page.locator(".message-heading-2 .message-inline-code")).toHaveText("summary");
  await expect(page.locator(".message-code-block code")).toHaveText("# Not a rendered heading");
});
