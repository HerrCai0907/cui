import { expect, test } from "@playwright/test";

import {
  createSubmittedRunResponse,
  currentWorkspace,
  emitRunEvent,
  mockSession,
  mockSessionById,
  mockRpcMethod,
  mockSessions,
  mockWorkspaceGitInfo,
  storeAppConfig,
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

test("shows the selected workspace branch and commit on the new session screen", async ({
  page,
}) => {
  await mockSessions(page, []);
  await mockWorkspaceGitInfo(page, {
    gitBranch: "feature/session-metadata",
    gitCommitSha: "1234567890abcdef1234567890abcdef12345678",
  });

  await page.goto("/");

  const gitInfo = page.getByLabel(
    "Current branch feature/session-metadata, current commit 1234567890ab",
  );

  await expect(page.getByRole("heading", { name: "New session" })).toBeVisible();
  await expect(gitInfo).toBeVisible();
  await expect(gitInfo).toContainText("feature/session-metadata");
  await expect(gitInfo).toContainText("1234567890ab");
});

test("scrolls the latest assistant reply to the top of the message stream", async ({ page }) => {
  const longSession = {
    id: "session-scroll-latest-reply",
    workspace: currentWorkspace,
    title: "Long conversation",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    messages: [
      ...Array.from({ length: 8 }, (_, index) => [
        {
          id: `user-${index + 1}`,
          role: "user",
          content: `User message ${index + 1}\\n${"filler\\n".repeat(12)}`,
          createdAt: "2026-08-22T00:00:00.000Z",
        },
        {
          id: `assistant-${index + 1}`,
          role: "assistant",
          kind: "response",
          content: `Assistant reply ${index + 1}\\n${"filler\\n".repeat(12)}`,
          createdAt: "2026-08-22T00:00:00.000Z",
        },
      ]).flat(),
    ],
    rounds: [],
  };

  await mockSessions(page, [longSession]);
  await mockSession(page, longSession);

  await page.goto("/");

  const messageStream = page.locator(".message-stream");
  const latestReply = page.locator('[data-last-assistant-response="true"]');

  await expect(
    page.getByRole("button", { name: "Scroll to latest assistant reply" }),
  ).toBeVisible();
  await messageStream.evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.getByRole("button", { name: "Scroll to latest assistant reply" }).click();

  await expect
    .poll(async () => {
      return await latestReply.evaluate((target) => {
        const stream = target.closest(".message-stream");

        if (!stream) {
          return Number.NaN;
        }

        return Math.abs(target.getBoundingClientRect().top - stream.getBoundingClientRect().top);
      });
    })
    .toBeLessThan(2);
});

test("loads twice the current message count when requesting earlier messages", async ({ page }) => {
  const session = {
    id: "session-load-earlier-window",
    workspace: currentWorkspace,
    title: "Paginated conversation",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    messages: [
      {
        id: "message-5",
        role: "user",
        content: "Visible user message",
        createdAt: "2026-08-22T00:05:00.000Z",
      },
      {
        id: "message-6",
        role: "assistant",
        kind: "response",
        content: "Visible assistant message",
        createdAt: "2026-08-22T00:06:00.000Z",
      },
    ],
    messagePageInfo: {
      total: 6,
      returned: 2,
      hasMoreBefore: true,
      hasMoreAfter: false,
      oldestMessageId: "message-5",
      newestMessageId: "message-6",
    },
    rounds: [],
  };
  let requestedLimit: string | null = null;

  await mockSessions(page, [session]);
  await mockSession(page, session);
  await mockRpcMethod(page, "sessions.messages", (params) => {
    requestedLimit = String((params as { limit?: number }).limit ?? "");

    return {
      messages: [
        {
          id: "message-1",
          role: "user",
          content: "Earlier user message",
          createdAt: "2026-08-22T00:01:00.000Z",
        },
      ],
      pageInfo: {
        total: 6,
        returned: 1,
        hasMoreBefore: false,
        hasMoreAfter: true,
        oldestMessageId: "message-1",
        newestMessageId: "message-1",
      },
    };
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Load earlier messages" }).click();

  await expect.poll(() => requestedLimit).toBe("4");
});

test("shows model names on assistant message titles", async ({ page }) => {
  const session = {
    id: "session-message-model-title",
    workspace: currentWorkspace,
    title: "Model title conversation",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    messages: [
      {
        id: "message-trace",
        role: "assistant",
        kind: "trace",
        model: "GPT-5.4 / High",
        content: "TRAEX run completed.",
        createdAt: "2026-08-22T00:01:00.000Z",
      },
      {
        id: "message-response",
        role: "assistant",
        kind: "response",
        model: "GPT-5.4 / High",
        content: "Done.",
        createdAt: "2026-08-22T00:02:00.000Z",
      },
    ],
    rounds: [],
  };

  await mockSessions(page, [session]);
  await mockSession(page, session);

  await page.goto("/");

  await expect(page.getByText("Execution Trace (GPT-5.4 / High)")).toBeVisible();
  await expect(page.getByText("Assistant (GPT-5.4 / High)")).toBeVisible();
});

test("sends composer-selected model preferences when starting a chat session", async ({ page }) => {
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
  await mockRpcMethod(page, "sessions.create", (params) => {
    createSessionBody = params;

    return {
      session: {
        ...startedSession,
        messages: [],
        isRunning: false,
        runningRunId: undefined,
      },
    };
  });
  await mockRpcMethod(page, "sessions.createRun", (params) => {
    createRunBody = (params as { request?: unknown }).request;

    return createSubmittedRunResponse(startedSession, "run-models");
  });
  await storeAppConfig(page, {
    harness: "traex",
    models: {
      summary: "GPT-5.4",
      atomicReview: "GPT-5.5",
    },
    reasoningEfforts: {
      summary: "low",
      atomicReview: "medium",
    },
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Select harness, model, and reasoning effort" }).click();
  await page.getByRole("menuitem", { name: "Seed-2.1-Turbo" }).click();
  await page.getByRole("menuitem", { name: "High", exact: true }).click();
  await page.getByPlaceholder("Start with an initial prompt...").fill("Use the selected models.");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect
    .poll(() => createSessionBody)
    .toEqual({
      workspace: "~",
      origin: "chat",
      title: "Use the selected models.",
      models: {
        harness: "traex",
        normal: "Seed-2.1-Turbo",
        summary: "GPT-5.4",
        atomicReview: "GPT-5.5",
        reasoningEfforts: {
          normal: "high",
          summary: "low",
          atomicReview: "medium",
        },
      },
    });
  await expect
    .poll(() => createRunBody)
    .toEqual({
      type: "assistant_response",
      input: {
        prompt: "Use the selected models.",
      },
      models: {
        harness: "traex",
        normal: "Seed-2.1-Turbo",
        summary: "GPT-5.4",
        atomicReview: "GPT-5.5",
        reasoningEfforts: {
          normal: "high",
          summary: "low",
          atomicReview: "medium",
        },
      },
    });
});

test("keeps the composer model popover anchored while previewing harnesses", async ({ page }) => {
  await mockSessions(page, []);

  await page.goto("/");
  await page.getByRole("button", { name: "Select harness, model, and reasoning effort" }).click();

  const popover = page.getByRole("menu", { name: "Harness, model, and reasoning" });
  const topBefore = await popover.evaluate((element) => element.getBoundingClientRect().top);

  await page.getByRole("menuitem", { name: "Codex" }).hover();

  await expect(page.getByRole("menuitem", { name: "gpt-6-astra" })).toBeVisible();
  await expect
    .poll(async () => popover.evaluate((element) => element.getBoundingClientRect().top))
    .toBe(topBefore);
});

test("keeps a newly created session visible when starting its run fails", async ({ page }) => {
  const createdSession = {
    id: "session-created-run-failed",
    workspace: currentWorkspace,
    title: "Prompt that creates a session",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    messages: [],
    rounds: [],
  };
  const sessions: (typeof createdSession)[] = [];

  await mockSessions(page, () => sessions);
  await mockRpcMethod(page, "sessions.create", () => {
    sessions.push(createdSession);

    return { session: createdSession };
  });
  await mockRpcMethod(page, "sessions.createRun", () => {
    throw new Error("run failed after session creation");
  });

  await page.goto("/");
  await page.getByLabel("Workspace path").fill(currentWorkspace);
  await page
    .getByPlaceholder("Start with an initial prompt...")
    .fill("Prompt that creates a session");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect(page.getByRole("heading", { name: "Prompt that creates a session" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Prompt that creates a session" })).toBeVisible();
  await expect(page.getByPlaceholder("Continue this session...")).toHaveValue(
    "Prompt that creates a session",
  );
  await expect(page.getByText("run failed after session creation")).toBeVisible();
});

test("switches the composer model selector with the active session", async ({ page }) => {
  const firstSession = {
    id: "session-model-one",
    workspace: currentWorkspace,
    title: "First model session",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:01.000Z",
    messages: [],
    rounds: [],
    currentRound: 0,
    isRunning: false,
    models: {
      harness: "traex",
      normal: "GPT-5.4",
      reasoningEfforts: {
        normal: "low",
      },
    },
  };
  const secondSession = {
    id: "session-model-two",
    workspace: currentWorkspace,
    title: "Second model session",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    messages: [],
    rounds: [],
    currentRound: 0,
    isRunning: false,
    models: {
      harness: "traex",
      normal: "Seed-2.1-Turbo",
      reasoningEfforts: {
        normal: "high",
      },
    },
  };

  await mockSessions(page, [firstSession, secondSession]);

  await page.goto("/");

  const modelButton = page.getByRole("button", {
    name: "Select harness, model, and reasoning effort",
  });

  await expect(modelButton).toHaveAttribute("title", "TraeX - GPT-5.4 - Low");
  await page.getByRole("button", { name: "Second model session" }).click();
  await expect(modelButton).toHaveAttribute("title", "TraeX - Seed-2.1-Turbo - High");
  await page.getByRole("button", { name: "New session", exact: true }).click();
  await expect(modelButton).toHaveAttribute("title", "TraeX - GPT-5.5 - High");
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
  await mockRpcMethod(page, "sessions.create", (params) => {
    createSessionBody = params;

    return {
      session: {
        ...startedSession,
        messages: [],
        isRunning: false,
        runningRunId: undefined,
      },
    };
  });
  await mockRpcMethod(page, "sessions.createRun", (params) => {
    createRunBody = (params as { request?: unknown }).request;

    return createSubmittedRunResponse(startedSession, "run-shell-enter", {
      type: "shell_command",
    });
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
      models: {
        harness: "traex",
        normal: "GPT-5.5",
        summary: "GPT-5.4",
        atomicReview: "GPT-5.5",
        reasoningEfforts: {
          normal: "high",
          summary: "low",
          atomicReview: "medium",
        },
      },
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
    gitCommitSha: "abcdef1234567890abcdef1234567890abcdef12",
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
  const branch = page.getByLabel(
    "Current branch feature/session-branch, current commit abcdef123456",
  );

  await expect(title).toBeVisible();
  await expect(branch).toBeVisible();
  await expect(branch).toContainText("abcdef123456");

  const [titleBox, branchBox] = await Promise.all([title.boundingBox(), branch.boundingBox()]);

  expect(titleBox).not.toBeNull();
  expect(branchBox).not.toBeNull();
  expect(branchBox!.x).toBeGreaterThan(titleBox!.x + titleBox!.width);
});

test("renders assistant inline and fenced code blocks", async ({ page }) => {
  const code = "const ok = true;";
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
        content: `Use \`npm test\` before merging.\n\n   \`\`\`ts\n   ${code}\n   \`\`\``,
        createdAt: "2026-08-22T00:00:00.000Z",
      },
    ],
    rounds: [],
  };

  await page.addInitScript(() => {
    let clipboardText = "";

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: async () => clipboardText,
        writeText: async (value: string) => {
          clipboardText = value;
        },
      },
    });
  });
  await mockSessions(page, [session]);
  await mockSession(page, session);

  await page.goto("/");

  await expect(page.locator(".message-inline-code")).toHaveText("npm test");
  await expect(page.locator(".message-code-block code")).toHaveText(code);
  await expect(page.locator(".message-code-block code")).toHaveAttribute("data-language", "ts");

  await page.getByRole("button", { name: "Copy code block" }).click();
  await expect
    .poll(async () => {
      return await page.evaluate(() => navigator.clipboard.readText());
    })
    .toBe(code);
});

test("renders assistant markdown tables with a raw markdown copy action", async ({ page }) => {
  const tableMarkdown = [
    "| case | binary/config | ns/op | vs baseline | vs currentoff | NumGC | peak RSS |",
    "|---|---:|---:|---:|---:|---:|---:|",
    "| baseline | ~/ROG + auto off | 3,132,694 | baseline | -0.47% | 474 | 2,205,065,216 |",
    "| currentoff | current + auto off | 3,147,455 | +0.47% | baseline | 446 | 2,597,347,328 |",
    "| currentauto | current + auto on | 3,179,743 | +1.50% | +1.03% | 350 | 2,910,654,464 |",
  ].join("\n");
  const session = {
    id: "session-table-rendering",
    workspace: currentWorkspace,
    title: "Table rendering session",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    messages: [
      {
        id: "message-1",
        role: "assistant",
        kind: "response",
        content: `Benchmark result:\n\n${tableMarkdown}\n`,
        createdAt: "2026-08-22T00:00:00.000Z",
      },
    ],
    rounds: [],
  };

  await page.addInitScript(() => {
    let clipboardText = "";

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: async () => clipboardText,
        writeText: async (value: string) => {
          clipboardText = value;
        },
      },
    });
  });
  await mockSessions(page, [session]);
  await mockSession(page, session);

  await page.goto("/");

  const table = page.locator(".message-table");
  await expect(table).toBeVisible();
  await expect(table.locator("thead th")).toHaveText([
    "case",
    "binary/config",
    "ns/op",
    "vs baseline",
    "vs currentoff",
    "NumGC",
    "peak RSS",
  ]);
  await expect(table.locator("tbody tr")).toHaveCount(3);
  await expect(table.locator("tbody tr").nth(2).locator("td").nth(4)).toHaveText("+1.03%");
  await expect(table.locator("thead th").nth(1)).toHaveClass(/is-right-aligned/);

  await page.getByRole("button", { name: "Copy markdown table" }).click();
  await expect
    .poll(async () => {
      return await page.evaluate(() => navigator.clipboard.readText());
    })
    .toBe(tableMarkdown);
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

  await page.addInitScript(() => {
    let clipboardText = "";

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: async () => clipboardText,
        writeText: async (value: string) => {
          clipboardText = value;
        },
      },
    });
  });
  await mockSessions(page, [session]);
  await mockSession(page, session);
  await mockRpcMethod(page, "code.getRange", (params) => {
    const record = params as { startLine?: number; endLine?: number };
    const startLine = Number(record.startLine);
    const endLine = Number(record.endLine);

    requests.push(`${startLine}-${endLine}`);

    return {
      filePath,
      startLine,
      endLine,
      code: `line ${startLine}\nline ${endLine}`,
      lines: [
        { lineNumber: startLine, content: `line ${startLine}` },
        { lineNumber: endLine, content: `line ${endLine}` },
      ],
    };
  });

  await page.goto("/");
  await page.getByRole("button", { name: "apps/web/src/app/App.tsx:20" }).click();

  const preview = page.getByRole("dialog", { name: "Code preview" });
  await expect(preview).toBeVisible();
  await expect(preview).toContainText("Lines 20-30");
  expect(requests).toEqual(["20-30"]);

  await preview.locator(".message-code-card-header").dblclick();
  await expect(preview.locator(".message-code-card-copy-status")).toHaveText("Copied");
  await expect
    .poll(async () => {
      return await page.evaluate(() => navigator.clipboard.readText());
    })
    .toBe(`${filePath}:20`);

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

  async function dragPreviewHeaderTo(targetX: number, targetY: number) {
    const currentHeaderBox = await header.boundingBox();
    expect(currentHeaderBox).not.toBeNull();

    await page.mouse.move(currentHeaderBox!.x + 20, currentHeaderBox!.y + 15);
    await page.mouse.down();
    await page.mouse.move(targetX, targetY, { steps: 8 });
    await page.mouse.up();
  }

  async function expectPreviewAtPoint(targetX: number, targetY: number) {
    await expect
      .poll(async () =>
        page.evaluate(
          ({ x, y }) =>
            Boolean(
              document
                .elementFromPoint(x, y)
                ?.closest('.message-code-card[role="dialog"][aria-label="Code preview"]'),
            ),
          { x: targetX, y: targetY },
        ),
      )
      .toBe(true);
  }

  const chatHeaderBox = await page.locator(".chat-header").boundingBox();
  expect(chatHeaderBox).not.toBeNull();
  const titleBarTarget = {
    x: chatHeaderBox!.x + 96,
    y: chatHeaderBox!.y + Math.min(32, chatHeaderBox!.height / 2),
  };

  await dragPreviewHeaderTo(titleBarTarget.x, titleBarTarget.y);
  await expectPreviewAtPoint(titleBarTarget.x, titleBarTarget.y);

  const sidebarBox = await page.getByLabel("Workspace sessions").boundingBox();
  expect(sidebarBox).not.toBeNull();
  const sidebarTarget = {
    x: sidebarBox!.x + Math.min(96, sidebarBox!.width / 2),
    y: sidebarBox!.y + 96,
  };

  await dragPreviewHeaderTo(sidebarTarget.x, sidebarTarget.y);
  await expectPreviewAtPoint(sidebarTarget.x, sidebarTarget.y);

  await page.getByRole("heading", { name: "Code preview session" }).click();
  await expect(preview).toBeHidden();
});

test("keeps the source definition jump menu briefly after hover leaves", async ({ page }) => {
  const filePath = `${currentWorkspace}/apps/web/src/app/App.tsx`;
  const session = {
    id: "session-code-preview-definition-hover",
    workspace: currentWorkspace,
    title: "Definition hover session",
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

  await mockSessions(page, [session]);
  await mockSession(page, session);
  await mockRpcMethod(page, "code.getRange", () => {
    return {
      filePath,
      startLine: 20,
      endLine: 30,
      code: "export function hoverTarget() {\n  return 1;\n}",
      lines: [
        { lineNumber: 20, content: "export function hoverTarget() {" },
        { lineNumber: 21, content: "  return 1;" },
        { lineNumber: 22, content: "}" },
      ],
    };
  });

  await page.goto("/");
  await page.getByRole("button", { name: "apps/web/src/app/App.tsx:20" }).click();

  const preview = page.getByRole("dialog", { name: "Code preview" });
  const sourceTarget = preview.locator(".source-definition-target");
  await expect(sourceTarget).not.toHaveAttribute("title", /.+/);

  const targetBox = await sourceTarget.boundingBox();
  expect(targetBox).not.toBeNull();

  await page.mouse.move(targetBox!.x + 32, targetBox!.y + 10);

  const jumpButton = page.getByRole("menuitem", { name: "Jump to definition" });
  await expect(jumpButton).toBeVisible({ timeout: 2000 });

  await page.mouse.move(5, 5);
  await page.waitForTimeout(500);
  await expect(jumpButton).toBeVisible();
  await expect(jumpButton).toBeHidden({ timeout: 800 });
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
  await mockRpcMethod(page, "code.getRange", (params) => {
    const record = params as { filePath?: string; startLine?: number; endLine?: number };

    expect(record.filePath).toBe(filePath);
    expect(record.startLine).toBe(2);
    expect(record.endLine).toBe(12);

    return {
      filePath,
      startLine: 2,
      endLine: 12,
      code: "finalizer repro",
      lines: [{ lineNumber: 2, content: "finalizer repro" }],
    };
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

test("shows pending atomic review status and notifies when it completes", async ({ page }) => {
  let reviewReady = false;
  const session = {
    id: "session-atomic-review-notification",
    workspace: currentWorkspace,
    title: "Atomic review notification session",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    currentRound: 1,
    isRunning: false,
    messages: [
      {
        id: "message-1",
        role: "assistant",
        kind: "response",
        round: 1,
        content: "Changed the files.",
        createdAt: "2026-08-22T00:00:00.000Z",
      },
    ],
    rounds: [
      {
        round: 1,
        hasChanges: true,
        createdAt: "2026-08-22T00:00:00.000Z",
      },
    ],
  };
  const getSessionState = () => ({
    ...session,
    updatedAt: reviewReady ? "2026-08-22T00:00:03.000Z" : session.updatedAt,
    rounds: [
      {
        ...session.rounds[0],
        ...(reviewReady ? { atomicReviewStatus: "ready" } : {}),
      },
    ],
  });

  await mockSessions(page, () => [getSessionState()]);
  await mockSessionById(page, session.id, getSessionState);

  await page.goto("/");

  const reviewGroup = page.getByLabel("Round 1 reviews");
  await expect(
    reviewGroup.getByRole("status", { name: "Round 1 atomic review is running" }),
  ).toBeVisible();
  await expect(reviewGroup.getByRole("button", { name: "Atomic review" })).toHaveCount(0);

  reviewReady = true;

  await expect(page.getByRole("status", { name: "Round 1 atomic review is ready." })).toBeVisible({
    timeout: 5000,
  });
  await expect(reviewGroup.getByRole("button", { name: "Atomic review" })).toBeVisible();
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
