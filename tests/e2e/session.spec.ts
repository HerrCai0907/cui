import { expect, test } from "@playwright/test";

import {
  createSubmittedRunResponse,
  currentWorkspace,
  fulfillJson,
  mockSession,
  mockSessions,
} from "./helpers";

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
  await expect(page.getByRole("button", { name: "New session", exact: true })).toBeVisible();
  await expect(page.getByLabel("Workspace path")).toHaveValue("~");
  await expect(page.getByPlaceholder("Start with an initial prompt...")).toBeVisible();
  await expect(page.getByLabel("Send message")).toBeVisible();
  expect(browserErrors).toEqual([]);
});

test("sends configured models when starting a chat session", async ({ page }) => {
  const startedSession = {
    id: "session-models",
    workspace: currentWorkspace,
    title: "Model configured session",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    messages: [
      {
        id: "message-1",
        role: "user",
        content: "Use the selected models.",
        createdAt: "2026-08-22T00:00:00.000Z",
      },
    ],
    rounds: [],
    currentRound: 0,
    isRunning: true,
    runningRunId: "run-models",
  };
  let createSessionBody: unknown;
  let createRunBody: unknown;

  await mockSessions(page, []);
  await page.route("**/api/v1/sessions", async (route) => {
    if (route.request().method() === "POST") {
      createSessionBody = route.request().postDataJSON();
      await fulfillJson(route, {
        session: {
          ...startedSession,
          messages: [],
          isRunning: false,
          runningRunId: undefined,
        },
      });
      return;
    }

    await fulfillJson(route, {
      sessions: [],
      pagination: {
        page: 1,
        pageSize: 30,
        total: 0,
        totalPages: 1,
        hasPreviousPage: false,
        hasNextPage: false,
      },
    });
  });
  await page.route("**/api/v1/sessions/session-models/runs", async (route) => {
    createRunBody = route.request().postDataJSON();
    await fulfillJson(route, createSubmittedRunResponse(startedSession, "run-models"));
  });
  await page.route("**/api/v1/runs/run-models/events", async () => {
    // Keep the stream open so the submitted session remains visible.
  });

  await page.goto("/config");

  const modelChoices = page.getByRole("group", { name: "Model choices" });

  await modelChoices.locator("select").nth(0).selectOption("GPT-5.4");
  await modelChoices.getByLabel("Normal reasoning effort").selectOption("medium");
  await modelChoices.locator("select").nth(2).selectOption("Seed-2.1-Turbo");
  await modelChoices.getByLabel("Summary reasoning effort").selectOption("low");
  await modelChoices.locator("select").nth(4).selectOption("DeepSeek-V4-Pro");
  await modelChoices.getByLabel("Atomic Review reasoning effort").selectOption("xhigh");
  await page.getByRole("button", { name: "New session", exact: true }).click();
  await page.getByPlaceholder("Start with an initial prompt...").fill("Use the selected models.");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect
    .poll(() => createSessionBody)
    .toEqual({
      workspace: "~",
      origin: "chat",
      title: "Use the selected models.",
    });
  await expect
    .poll(() => createRunBody)
    .toEqual({
      type: "assistant_response",
      input: {
        prompt: "Use the selected models.",
      },
      models: {
        normal: "GPT-5.4",
        summary: "Seed-2.1-Turbo",
        atomicReview: "DeepSeek-V4-Pro",
        reasoningEfforts: {
          normal: "medium",
          summary: "low",
          atomicReview: "xhigh",
        },
      },
    });
});

test("sends a shell command on a single Enter key press", async ({ page }) => {
  const startedSession = {
    id: "shell-session-enter",
    origin: "shell",
    workspace: currentWorkspace,
    title: "Shell session",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    messages: [
      {
        id: "message-1",
        role: "user",
        content: "pwd",
        createdAt: "2026-08-22T00:00:00.000Z",
      },
    ],
    rounds: [],
    currentRound: 0,
    isRunning: true,
    runningRunId: "run-shell-enter",
  };
  let createSessionBody: unknown;
  let createRunBody: unknown;

  await mockSessions(page, []);
  await page.route("**/api/v1/sessions", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }

    createSessionBody = route.request().postDataJSON();
    await fulfillJson(route, {
      session: {
        ...startedSession,
        messages: [],
        isRunning: false,
        runningRunId: undefined,
      },
    });
  });
  await page.route("**/api/v1/sessions/shell-session-enter/runs", async (route) => {
    createRunBody = route.request().postDataJSON();
    await fulfillJson(
      route,
      createSubmittedRunResponse(startedSession, "run-shell-enter", { type: "shell_command" }),
    );
  });
  await page.route("**/api/v1/runs/run-shell-enter/events", async () => {
    // Keep the stream open so the submitted session remains visible.
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Enable shell mode" }).click();

  const composer = page.getByPlaceholder("Run a shell command...");

  await composer.fill("pwd");
  await composer.press("Enter");

  await expect
    .poll(() => createSessionBody)
    .toEqual({
      workspace: "~",
      origin: "shell",
      title: "$ pwd",
    });
  await expect
    .poll(() => createRunBody)
    .toEqual({
      type: "shell_command",
      input: {
        command: "pwd",
      },
    });
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
  await page.getByRole("button", { name: "More" }).click();

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

  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: currentWorkspace, exact: true }).click();
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
    updatedAt: "2026-08-22T00:00:02.000Z",
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

test("supports expandable assistant code previews", async ({ page }) => {
  const filePath = `${currentWorkspace}/apps/web/src/app/App.tsx`;
  const session = {
    id: "session-code-preview",
    workspace: currentWorkspace,
    title: "Code preview session",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    messages: [
      {
        id: "message-1",
        role: "assistant",
        kind: "response",
        content: `See [App.tsx](${filePath}:20).`,
        createdAt: "2026-08-22T00:00:00.000Z",
      },
    ],
    rounds: [],
  };
  const requests: string[] = [];

  await mockSessions(page, [session]);
  await mockSession(page, session);
  await page.route("**/api/v1/source-files/content?**", async (route) => {
    const url = new URL(route.request().url());
    const startLine = Number(url.searchParams.get("startLine"));
    const endLine = Number(url.searchParams.get("endLine"));
    requests.push(`${startLine}-${endLine}`);

    await fulfillJson(route, {
      filePath,
      startLine,
      endLine,
      code: `line ${startLine}\nline ${endLine}`,
      lines: [
        { lineNumber: startLine, content: `line ${startLine}` },
        { lineNumber: endLine, content: `line ${endLine}` },
      ],
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "apps/web/src/app/App.tsx:20" }).click();

  const preview = page.getByRole("dialog", { name: "Code preview" });
  await expect(preview).toBeVisible();
  await expect(preview).toContainText("Lines 20-30");
  expect(requests).toEqual(["20-30"]);

  await page.getByRole("button", { name: "Show 10 previous lines" }).click();
  await expect(preview).toContainText("Lines 10-30");
  expect(requests).toEqual(["20-30", "10-30"]);

  await page.getByRole("button", { name: "Show 10 next lines" }).click();
  await expect(preview).toContainText("Lines 10-40");
  expect(requests).toEqual(["20-30", "10-30", "10-40"]);

  const initialBox = await preview.boundingBox();
  const header = preview.locator(".message-code-card-header");
  const headerBox = await header.boundingBox();
  expect(initialBox).not.toBeNull();
  expect(headerBox).not.toBeNull();

  await page.mouse.move(headerBox!.x + 20, headerBox!.y + 15);
  await page.mouse.down();
  await page.mouse.move(headerBox!.x + 90, headerBox!.y + 55);
  await page.mouse.up();

  const draggedBox = await preview.boundingBox();
  expect(draggedBox).not.toBeNull();
  expect(draggedBox!.x).toBeGreaterThan(initialBox!.x + 40);
  expect(draggedBox!.y).toBeGreaterThan(initialBox!.y + 20);

  await page.getByRole("heading", { name: "Code preview session" }).click();
  await expect(preview).toBeHidden();
});

test("supports assistant code previews for local markdown links outside the workspace", async ({
  page,
}) => {
  const filePath = "/tmp/rog-stack-growth-gc-repro-finalizer.md";
  const session = {
    id: "session-external-code-preview",
    workspace: currentWorkspace,
    title: "External code preview session",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    messages: [
      {
        id: "message-1",
        role: "assistant",
        kind: "response",
        content: `See [finalizer repro](${filePath}:2).`,
        createdAt: "2026-08-22T00:00:00.000Z",
      },
    ],
    rounds: [],
  };

  await mockSessions(page, [session]);
  await mockSession(page, session);
  await page.route("**/api/v1/source-files/content?**", async (route) => {
    const url = new URL(route.request().url());

    expect(url.searchParams.get("filePath")).toBe(filePath);
    expect(url.searchParams.get("startLine")).toBe("2");
    expect(url.searchParams.get("endLine")).toBe("12");

    await fulfillJson(route, {
      filePath,
      startLine: 2,
      endLine: 12,
      code: "finalizer repro",
      lines: [{ lineNumber: 2, content: "finalizer repro" }],
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: `${filePath}:2` }).click();

  const preview = page.getByRole("dialog", { name: "Code preview" });
  await expect(preview).toBeVisible();
  await expect(preview).toContainText(filePath);
  await expect(preview).toContainText("finalizer repro");
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
