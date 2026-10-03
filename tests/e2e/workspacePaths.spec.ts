import { expect, test } from "@playwright/test";
import { fulfillJson, mockSessions, mockWorkspaceGitInfo } from "./helpers";

test.beforeEach(async ({ page }) => {
  await mockSessions(page, []);
  await mockWorkspaceGitInfo(page, {});
});

test("completes workspace paths with keyboard and mouse, including nested directories", async ({
  page,
}) => {
  const suggestions: Record<string, string[]> = {
    "~/pro": ["~/project/", "~/project-two/"],
    "~/project/": ["~/project/src/"],
  };
  await page.route("**/api/v1/workspaces/path-suggestions?**", async (route) => {
    const path = new URL(route.request().url()).searchParams.get("path")!;
    await fulfillJson(route, { suggestions: suggestions[path] ?? [] });
  });
  await page.goto("/");
  const input = page.getByRole("combobox", { name: "Workspace path" });
  await input.fill("~/pro");
  await expect(page.getByRole("option")).toHaveCount(2);
  await input.press("ArrowDown");
  await input.press("ArrowDown");
  await expect(page.getByRole("option", { name: "~/project-two/", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await input.press("ArrowUp");
  await input.press("Tab");
  await expect(input).toHaveValue("~/project/");
  await expect(input).toBeFocused();
  await expect(page.getByRole("option", { name: "~/project/src/", exact: true })).toBeVisible();
  await input.press("Enter");
  await expect(input).toHaveValue("~/project/src/");

  await input.fill("~/pro");
  await page.getByRole("option", { name: "~/project-two/", exact: true }).click();
  await expect(input).toHaveValue("~/project-two/");
  await expect(input).toBeFocused();
});

test("dismisses suggestions and keeps manual entry usable when lookup fails", async ({ page }) => {
  await page.route("**/api/v1/workspaces/path-suggestions?**", async (route) => {
    const path = new URL(route.request().url()).searchParams.get("path");
    if (path === "/unavailable") {
      await route.fulfill({ status: 500, body: "unavailable" });
    } else {
      await fulfillJson(route, { suggestions: ["~/project/"] });
    }
  });
  await page.goto("/");
  const input = page.getByLabel("Workspace path");
  await input.fill("~/pro");
  await expect(page.getByRole("listbox")).toBeVisible();
  await input.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await input.press("Tab");
  await expect(input).not.toBeFocused();
  const failedResponse = page.waitForResponse((response) =>
    response.url().includes("path-suggestions?path=%2Funavailable"),
  );
  await input.fill("/unavailable");
  await failedResponse;
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await input.press("Tab");
  await expect(input).not.toBeFocused();
  await expect(input).toHaveValue("/unavailable");
});

test("does not show stale suggestions after the path changes", async ({ page }) => {
  let releaseOldResponse!: () => void;
  const oldResponseReady = new Promise<void>((resolve) => {
    releaseOldResponse = resolve;
  });
  await page.route("**/api/v1/workspaces/path-suggestions?**", async (route) => {
    const path = new URL(route.request().url()).searchParams.get("path");
    if (path === "/old") {
      await oldResponseReady;
    }
    await fulfillJson(route, { suggestions: [`${path}-directory/`] });
  });
  await page.goto("/");
  const input = page.getByLabel("Workspace path");
  const oldRequest = page.waitForRequest("**/path-suggestions?path=%2Fold");
  await input.fill("/old");
  await oldRequest;
  await input.fill("/new");
  await expect(page.getByRole("option", { name: "/new-directory/" })).toBeVisible();
  releaseOldResponse();
  await expect(page.getByRole("option")).toHaveText(["/new-directory/"]);
});
