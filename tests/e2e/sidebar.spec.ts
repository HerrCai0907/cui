import { expect, test } from "@playwright/test";

import { currentWorkspace, fulfillJson, mockSession, mockSessions } from "./helpers";

test("renders workspace paths as a file tree in the sidebar", async ({ page }) => {
  const firstSession = {
    id: "session-1",
    workspace: currentWorkspace,
    title: "CUI session",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    messages: [],
    rounds: [],
  };
  const secondSession = {
    id: "session-2",
    workspace: "/Users/bytedance/oss/go",
    title: "Go session",
    createdAt: "2026-08-22T00:00:01.000Z",
    updatedAt: "2026-08-22T00:00:01.000Z",
    messages: [],
    rounds: [],
  };

  await mockSessions(page, [firstSession, secondSession]);

  await page.goto("/");
  await page.getByRole("button", { name: "More" }).click();

  const sidebar = page.getByLabel("Workspace sessions");

  await expect(sidebar.getByText("/Users/bytedance", { exact: true })).toBeVisible();
  await expect(sidebar.getByText("cui", { exact: true })).toBeVisible();
  await expect(sidebar.getByText("oss/go", { exact: true })).toBeVisible();
  await expect(sidebar.getByText("Users", { exact: true })).toHaveCount(0);
  await expect(sidebar.getByText("bytedance", { exact: true })).toHaveCount(0);
  await expect(sidebar.getByText("oss", { exact: true })).toHaveCount(0);
  await expect(sidebar.getByText("/Users/bytedance/oss/go", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "/Users/bytedance/oss/go", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "New session in /Users/bytedance/oss/go" }),
  ).toBeVisible();
});

test("keeps the current workspace available when it has no sessions", async ({ page }) => {
  await mockSessions(page, []);

  await page.goto("/");

  const sidebar = page.getByLabel("Workspace sessions");

  await expect(sidebar.getByText("~", { exact: true })).toBeVisible();
  await expect(sidebar.getByLabel("~", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "New session in ~" })).toBeVisible();
});

test("shows a focused Active list and keeps all sessions in More", async ({ page }) => {
  const sessions = Array.from({ length: 4 }, (_, index) => ({
    id: `session-${index}`,
    workspace: index < 3 ? currentWorkspace : "/Users/bytedance/other",
    title: `Session ${index}`,
    createdAt: new Date(Date.UTC(2026, 7, 22, 0, 0, index)).toISOString(),
    updatedAt: new Date(Date.UTC(2026, 7, 22, 0, 0, index)).toISOString(),
    messages: [
      {
        id: `message-${index}`,
        role: "assistant",
        kind: "response",
        content: `Session ${index} response`,
        createdAt: new Date(Date.UTC(2026, 7, 22, 0, 0, index)).toISOString(),
      },
    ],
    rounds: [],
    currentRound: 1,
    isRunning: false,
  }));

  await mockSessions(page, sessions);
  await mockSession(page, sessions[1]);

  await page.goto("/");

  await expect(page.getByRole("button", { name: "Active" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("button", { name: "Session 3" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Session 2" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Session 0" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Session 1" })).toHaveCount(0);

  await page.getByRole("button", { name: "More" }).click();

  await page.getByRole("button", { name: currentWorkspace, exact: true }).click();
  await expect(page.getByRole("button", { name: "Session 0" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Session 1" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Session 2" })).toBeVisible();
  await page.getByRole("button", { name: "Session 1" }).click();
  await expect(page.getByRole("heading", { name: "Session 1" })).toBeVisible();
});

test("pages through sessions in More", async ({ page }) => {
  const sessions = Array.from({ length: 34 }, (_, index) => ({
    id: `session-${index}`,
    workspace: currentWorkspace,
    title: `Session ${index}`,
    createdAt: new Date(Date.UTC(2026, 7, 22, 0, 0, index)).toISOString(),
    updatedAt: new Date(Date.UTC(2026, 7, 22, 0, 0, 33 - index)).toISOString(),
    messages: [],
    rounds: [],
    currentRound: 0,
    isRunning: false,
  }));
  const requestedSessionPages: number[] = [];

  await mockSessions(page, sessions);
  await page.route("**/api/sessions**", async (route) => {
    const url = new URL(route.request().url());

    if (route.request().method() === "GET" && url.pathname === "/api/sessions") {
      requestedSessionPages.push(Number(url.searchParams.get("page")) || 1);
    }

    await route.fallback();
  });

  await page.goto("/");
  await expect(page.getByRole("button", { name: "More" })).toBeVisible();
  expect(requestedSessionPages[0]).toBe(1);

  await page.getByRole("button", { name: "More" }).click();
  await expect(page.getByText("1 / 2")).toBeVisible();
  await page.getByRole("button", { name: currentWorkspace, exact: true }).click();
  await expect(page.getByRole("button", { name: "Session 0" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Session 30" })).toHaveCount(0);

  await page.getByRole("button", { name: "Next session page" }).click();
  await expect(page.getByText("2 / 2")).toBeVisible();
  await expect(page.getByRole("button", { name: "Session 30" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Session 0" })).toHaveCount(0);

  await page.getByRole("button", { name: "Previous session page" }).click();
  await expect(page.getByText("1 / 2")).toBeVisible();
  await expect(page.getByRole("button", { name: "Session 0" })).toBeVisible();
});

test("marks a session done and removes it from Active after feedback", async ({ page }) => {
  const sessions = [
    {
      id: "session-1",
      workspace: currentWorkspace,
      title: "Finishable session",
      createdAt: "2026-08-22T00:00:00.000Z",
      updatedAt: "2026-08-22T00:00:00.000Z",
      messages: [],
      rounds: [],
      currentRound: 1,
      isRunning: false,
    },
  ];
  let doneAt: string | undefined;

  await mockSessions(page, () => sessions.map((session) => ({ ...session, doneAt })));
  await page.route("**/api/sessions/session-1", async (route) => {
    if (route.request().method() === "PATCH") {
      expect(route.request().postDataJSON()).toEqual({ done: true });
      doneAt = "2026-08-22T00:00:10.000Z";
      await fulfillJson(route, {
        session: {
          ...sessions[0],
          doneAt,
        },
      });
      return;
    }

    await fulfillJson(route, {
      session: {
        ...sessions[0],
        doneAt,
      },
    });
  });

  await page.goto("/");

  await expect(page.getByRole("button", { name: "Finishable session" })).toBeVisible();

  const doneButton = page.getByRole("button", { name: "Mark session done" });

  await doneButton.click();
  await expect(doneButton).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Finishable session" })).toHaveCount(0, {
    timeout: 2000,
  });
  await expect(
    page.getByRole("button", { name: `New session in ${currentWorkspace}` }),
  ).toBeVisible();

  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: currentWorkspace, exact: true }).click();
  await expect(page.getByRole("button", { name: "Finishable session" })).toBeVisible();
});

test("uses a separate workspace toggle in Active mode only", async ({ page }) => {
  const sessions = [
    {
      id: "session-1",
      workspace: currentWorkspace,
      title: "Active session",
      createdAt: "2026-08-22T00:00:00.000Z",
      updatedAt: "2026-08-22T00:00:00.000Z",
      messages: [],
      rounds: [],
      isRunning: true,
    },
  ];

  await mockSessions(page, sessions);
  await page.goto("/");

  const sidebar = page.getByLabel("Workspace sessions");
  const workspaceToggle = page.getByRole("button", {
    name: `Collapse ${currentWorkspace}`,
    exact: true,
  });

  await expect(workspaceToggle).toBeVisible();
  await expect(sidebar.getByLabel(currentWorkspace, { exact: true })).toBeVisible();
  await expect(sidebar.getByText(currentWorkspace, { exact: true })).toBeVisible();
  await sidebar.getByText(currentWorkspace, { exact: true }).click();
  await expect(page.getByRole("button", { name: "Active session" })).toBeVisible();

  await workspaceToggle.click();
  await expect(page.getByRole("button", { name: "Active session" })).toHaveCount(0);

  await page.getByRole("button", { name: "More" }).click();
  await expect(
    page.getByRole("button", { name: `Expand ${currentWorkspace}`, exact: true }),
  ).toHaveCount(0);
  await sidebar.getByLabel(currentWorkspace, { exact: true }).click();
  await expect(page.getByRole("button", { name: "Active session" })).toBeVisible();

  await sidebar.getByLabel(currentWorkspace, { exact: true }).click();
  await expect(page.getByRole("button", { name: "Active session" })).toHaveCount(0);

  await page.getByRole("button", { name: "Active" }).click();
  await expect(page.getByRole("button", { name: "Active session" })).toHaveCount(0);
  await page.getByRole("button", { name: `Expand ${currentWorkspace}`, exact: true }).click();
  await expect(page.getByRole("button", { name: "Active session" })).toBeVisible();
});

test("resizes and restores the session sidebar width", async ({ page }) => {
  const session = {
    id: "session-1",
    workspace: currentWorkspace,
    title: "Resizable session",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    messages: [],
    rounds: [],
  };

  await mockSessions(page, [session]);

  await page.goto("/");

  const sidebar = page.getByLabel("Workspace sessions");
  const resizeHandle = page.getByLabel("Resize sidebar");
  const initialBox = await sidebar.boundingBox();
  const handleBox = await resizeHandle.boundingBox();

  expect(initialBox).not.toBeNull();
  expect(handleBox).not.toBeNull();

  await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + 40);
  await page.mouse.down();
  await page.mouse.move(handleBox!.x + handleBox!.width / 2 + 96, handleBox!.y + 40);
  await page.mouse.up();

  await expect
    .poll(async () => (await sidebar.boundingBox())?.width)
    .toBeGreaterThan(initialBox!.width + 80);
  await expect(
    page.evaluate(() => JSON.parse(localStorage.getItem("cui:session-sidebar-state:v2") ?? "null")),
  ).resolves.toMatchObject({
    version: 2,
    sidebarWidth: expect.any(Number),
  });

  const resizedWidth = (await sidebar.boundingBox())!.width;

  await page.reload();
  await expect.poll(async () => (await sidebar.boundingBox())?.width).toBeCloseTo(resizedWidth, 0);
});

test("restores session sidebar expansion state after a browser refresh", async ({ page }) => {
  const sessions = Array.from({ length: 18 }, (_, index) => {
    const workspace =
      index === 0
        ? currentWorkspace
        : index === 1
          ? "/Users/bytedance/other"
          : index === 16
            ? "/Users/bytedance/archive"
            : `/Users/bytedance/project-${index}`;

    return {
      id: `session-${index}`,
      workspace,
      title: `Session ${index}`,
      createdAt: new Date(Date.UTC(2026, 7, 22, 0, 0, index)).toISOString(),
      updatedAt: new Date(Date.UTC(2026, 7, 22, 0, 0, 17 - index)).toISOString(),
      messages: [],
      rounds: [],
    };
  });

  await mockSessions(page, sessions);

  await page.goto("/");
  await expect(
    page.getByRole("button", { name: `New session in ${currentWorkspace}` }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "New session in /Users/bytedance/other" }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: "/Users/bytedance/other", exact: true }).click();
  await page.getByRole("button", { name: currentWorkspace, exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "/Users/bytedance/archive",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.evaluate(() => JSON.parse(localStorage.getItem("cui:session-sidebar-state:v2") ?? "null")),
  ).resolves.toEqual(
    expect.objectContaining({
      version: 2,
      sidebarOpen: true,
      sessionListMode: "more",
      activeExpandedWorkspaces: expect.arrayContaining([currentWorkspace]),
      moreExpandedWorkspaces: expect.arrayContaining(["/Users/bytedance/other"]),
    }),
  );

  await page.reload();
  await expect(
    page.getByRole("button", { name: `New session in ${currentWorkspace}` }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "New session in /Users/bytedance/other" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "/Users/bytedance/archive",
      exact: true,
    }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await page.reload();

  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New session", exact: true })).toHaveCount(0);
});
