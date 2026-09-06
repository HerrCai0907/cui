import { expect, test } from "@playwright/test";
import { mockSessions } from "./helpers";

test("Codex uses harness defaults and persists custom model IDs without a TraeX catalog", async ({
  page,
}) => {
  await mockSessions(page, []);
  let catalogRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/v1/models") catalogRequests++;
  });
  await page.goto("/config");
  await expect(page.getByLabel("AI harness", { exact: true })).toHaveValue("traex");
  await expect.poll(() => catalogRequests).toBeGreaterThan(0);
  await page.getByLabel("AI harness", { exact: true }).selectOption("codex");
  for (const purpose of ["Normal", "Summary", "Atomic Review"]) {
    await expect(page.getByRole("textbox", { name: `${purpose} model`, exact: true })).toHaveValue(
      "",
    );
  }
  await page.getByRole("textbox", { name: "Normal model", exact: true }).fill("gpt-5.5");
  const requestsBeforeReload = catalogRequests;
  await page.reload();
  await expect(page.getByLabel("AI harness", { exact: true })).toHaveValue("codex");
  await expect(page.getByRole("textbox", { name: "Normal model", exact: true })).toHaveValue(
    "gpt-5.5",
  );
  await expect(page.getByRole("textbox", { name: "Summary model", exact: true })).toHaveValue("");
  await expect(page.getByRole("textbox", { name: "Atomic Review model", exact: true })).toHaveValue(
    "",
  );
  expect(catalogRequests).toBe(requestsBeforeReload);
  await page.getByLabel("AI harness", { exact: true }).selectOption("traex");
  await expect.poll(() => catalogRequests).toBeGreaterThan(requestsBeforeReload);
  await expect(page.getByRole("group", { name: "Model choices" }).locator("select")).toHaveCount(6);
});
