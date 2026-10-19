import { expect, test } from "@playwright/test";
import { mockRpcMethod, mockSessions, mockWorkspaceGitInfo } from "./helpers";

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
  await mockRpcMethod(page, "code.workspacePathSuggestions", (params) => {
    const path = (params as { path?: string }).path ?? "";

    return { suggestions: suggestions[path] ?? [] };
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
  await mockRpcMethod(page, "code.workspacePathSuggestions", (params) => {
    const path = (params as { path?: string }).path;

    if (path === "/unavailable") {
      throw new Error("unavailable");
    }

    return { suggestions: ["~/project/"] };
  });
  await page.goto("/");
  const input = page.getByLabel("Workspace path");
  await input.fill("~/pro");
  await expect(page.getByRole("listbox")).toBeVisible();
  await input.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await input.press("Tab");
  await expect(input).not.toBeFocused();
  await input.fill("/unavailable");
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
  let oldRequestSeen!: () => void;
  const oldRequest = new Promise<void>((resolve) => {
    oldRequestSeen = resolve;
  });
  await mockRpcMethod(page, "code.workspacePathSuggestions", async (params) => {
    const path = (params as { path?: string }).path;

    if (path === "/old") {
      oldRequestSeen();
      await oldResponseReady;
    }

    return { suggestions: [`${path}-directory/`] };
  });
  await page.goto("/");
  const input = page.getByLabel("Workspace path");
  await input.fill("/old");
  await oldRequest;
  await input.fill("/new");
  await expect(page.getByRole("option", { name: "/new-directory/" })).toBeVisible();
  releaseOldResponse();
  await expect(page.getByRole("option")).toHaveText(["/new-directory/"]);
});
