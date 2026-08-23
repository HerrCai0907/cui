import { expect, test } from "@playwright/test";

import { currentWorkspace, mockSession, mockSessions } from "./helpers";

test("merges shared workspace path prefixes in the sidebar", async ({ page }) => {
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
  await expect(sidebar.getByText("/Users/bytedance/oss/go", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "/Users/bytedance/oss/go" }).click();
  await expect(
    page.getByRole("button", { name: "New session in /Users/bytedance/oss/go" }),
  ).toBeVisible();
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
  await expect(page.getByRole("button", { name: "Session 2" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Session 0" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Session 1" })).toHaveCount(0);

  await page.getByRole("button", { name: "More" }).click();

  await expect(page.getByRole("button", { name: "Session 0" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Session 1" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Session 2" })).toBeVisible();
  await page.getByRole("button", { name: "Session 1" }).click();
  await expect(page.getByRole("heading", { name: "Session 1" })).toBeVisible();
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
  ).resolves.toMatchObject({
    version: 2,
    sidebarOpen: true,
    sessionListMode: "more",
    expandedWorkspaces: ["/Users/bytedance/other"],
  });

  await page.reload();
  await expect(
    page.getByRole("button", { name: `New session in ${currentWorkspace}` }),
  ).toHaveCount(0);
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
