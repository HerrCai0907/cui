import { expect, test } from "@playwright/test";

import { currentWorkspace, mockSessions } from "./helpers";

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test("uses an overlay session drawer on a portrait phone", async ({ page }) => {
  await mockSessions(page, [
    {
      id: "mobile-session",
      workspace: currentWorkspace,
      title: "Mobile session",
      createdAt: "2026-08-22T00:00:00.000Z",
      updatedAt: "2026-08-22T00:00:00.000Z",
      messages: [],
      rounds: [],
    },
  ]);

  await page.goto("/");

  const sidebar = page.getByLabel("Workspace sessions");
  await expect(sidebar).not.toBeInViewport();
  await page.getByRole("button", { name: "Open session menu" }).click();
  await expect(sidebar).toBeInViewport();
  await expect(page.getByRole("button", { name: "Mobile session" })).toBeVisible();

  await page.getByRole("button", { name: "Close session menu" }).click();
  await expect(sidebar).not.toBeInViewport();
});

test("config exposes touch-friendly SSH tunnel settings", async ({ page }) => {
  await mockSessions(page, []);

  await page.goto("/");
  await page.getByRole("button", { name: "Open session menu" }).click();
  await page.getByRole("button", { name: "Config" }).click();

  await expect(page.getByRole("heading", { name: "SSH Tunnel" })).toBeVisible();
  await expect(page.getByText("SSH host", { exact: true })).toBeVisible();
  await expect(page.getByText("Remote host", { exact: true })).toBeVisible();
  await expect(page.getByText("Remote port", { exact: true })).toBeVisible();
  await expect(page.getByText("API Server")).not.toBeVisible();
});

test("keeps long message content inside the phone viewport", async ({ page }) => {
  const longToken = "a".repeat(240);

  await mockSessions(page, [
    {
      id: "long-mobile-message",
      workspace: currentWorkspace,
      title: "A very long session title that must never expand the mobile content column",
      createdAt: "2026-08-22T00:00:00.000Z",
      updatedAt: "2026-08-22T00:00:00.000Z",
      messages: [
        {
          id: "message-1",
          role: "assistant",
          kind: "response",
          content: `Long URL https://example.com/${longToken}\n\n\`\`\`text\n${longToken}\n\`\`\``,
          createdAt: "2026-08-22T00:00:00.000Z",
        },
      ],
      rounds: [],
    },
  ]);

  await page.goto("/");
  await page.getByRole("button", { name: "Open session menu" }).click();
  await page
    .getByRole("button", {
      name: "A very long session title that must never expand the mobile content column",
    })
    .click();
  await expect(page.locator(".message")).toBeVisible();

  const overflow = await page.evaluate(() => ({
    body: document.body.scrollWidth - document.body.clientWidth,
    root: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    message: (() => {
      const element = document.querySelector<HTMLElement>(".message");
      return element ? element.getBoundingClientRect().right - window.innerWidth : 1;
    })(),
    chatArea: (() => {
      const element = document.querySelector<HTMLElement>(".chat-area");
      const messageStream = document.querySelector<HTMLElement>(".message-stream");
      const composer = document.querySelector<HTMLElement>(".composer");

      return {
        areaWidth: element?.getBoundingClientRect().width ?? 0,
        streamWidth: messageStream?.getBoundingClientRect().width ?? 1,
        composerWidth: composer?.getBoundingClientRect().width ?? 1,
      };
    })(),
  }));

  expect(overflow.body).toBeLessThanOrEqual(0);
  expect(overflow.root).toBeLessThanOrEqual(0);
  expect(overflow.message).toBeLessThanOrEqual(0);
  expect(overflow.chatArea.streamWidth).toBe(overflow.chatArea.areaWidth);
  expect(overflow.chatArea.composerWidth).toBe(overflow.chatArea.areaWidth);
  await expect(page.locator(".message-code-block")).toHaveCSS("overflow-x", "auto");
});
