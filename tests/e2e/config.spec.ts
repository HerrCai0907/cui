import { expect, test } from "@playwright/test";
import { mockSessions } from "./helpers";

test("Codex uses its hardcoded model catalog and supported reasoning efforts", async ({ page }) => {
  await mockSessions(page, []);
  await page.route("**/api/v1/health", async (route) => {
    await route.fulfill({
      json: {
        status: "ok",
        service: "@cui/api",
        time: new Date().toISOString(),
      },
    });
  });
  let catalogRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/v1/models") catalogRequests++;
  });
  await page.goto("/config");
  await expect(page.getByRole("status").filter({ hasText: "Server latency" })).toContainText(
    /\d+ ms/,
  );
  await expect(page.getByLabel("AI harness", { exact: true })).toHaveValue("traex");
  await expect.poll(() => catalogRequests).toBeGreaterThan(0);
  await page.getByLabel("AI harness", { exact: true }).selectOption("codex");

  for (const purpose of ["Normal", "Summary", "Atomic Review"]) {
    await expect(page.getByLabel(`${purpose} model`, { exact: true })).toHaveValue("");
  }

  const normalModel = page.getByLabel("Normal model", { exact: true });
  const normalReasoning = page.getByLabel("Normal reasoning effort", { exact: true });

  await expect(normalModel).toContainText("gpt-6-astra");
  await normalModel.selectOption("gpt-6-astra");
  await expect(normalReasoning).toContainText("Ultra");
  await normalReasoning.selectOption("ultra");
  await normalModel.selectOption("gpt-5.5");
  await expect(normalReasoning).not.toContainText("Ultra");
  await expect(normalReasoning).not.toContainText("Max");
  await expect(normalReasoning).toHaveValue("medium");

  const requestsBeforeReload = catalogRequests;
  await page.reload();
  await expect(page.getByLabel("AI harness", { exact: true })).toHaveValue("codex");
  await expect(page.getByLabel("Normal model", { exact: true })).toHaveValue("gpt-5.5");
  await expect(page.getByLabel("Summary model", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Atomic Review model", { exact: true })).toHaveValue("");
  await expect.poll(() => catalogRequests).toBeGreaterThan(requestsBeforeReload);
  await page.getByLabel("AI harness", { exact: true }).selectOption("traex");
  await expect.poll(() => catalogRequests).toBeGreaterThan(requestsBeforeReload);
  await expect(page.getByRole("group", { name: "Model choices" }).locator("select")).toHaveCount(6);
});
