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

test("hides SSH tunnel config in a regular browser", async ({ page }) => {
  await mockSessions(page, []);

  await page.goto("/config");

  await expect(page.getByRole("heading", { name: "VSCode" })).toBeVisible();
  await expect(page.getByText("Open workspaces over Remote SSH")).toBeVisible();
  await expect(page.getByRole("heading", { name: "SSH Tunnel" })).toHaveCount(0);
  await expect(page.getByText("SSH host", { exact: true })).toHaveCount(0);
});

test("shows SSH tunnel config when the Android bridge is available", async ({ page }) => {
  await mockSessions(page, []);
  await page.addInitScript(() => {
    (
      window as Window & {
        CuiAndroid?: {
          loadSshTunnelConfig: () => string;
          saveSshTunnelConfig: (configJson: string) => string;
          getSshTunnelStatus: () => string;
        };
      }
    ).CuiAndroid = {
      loadSshTunnelConfig: () =>
        JSON.stringify({
          enabled: true,
          host: "ssh.example.com",
          port: 22,
          username: "developer",
          password: "",
          localPort: 5173,
          remoteHost: "127.0.0.1",
          remotePort: 5173,
        }),
      saveSshTunnelConfig: () =>
        JSON.stringify({
          connected: true,
          message: "SSH tunnel and API health check passed.",
        }),
      getSshTunnelStatus: () =>
        JSON.stringify({
          connected: false,
          message: "SSH tunnel is disconnected.",
        }),
    };
  });

  await page.goto("/config");

  await expect(page.getByRole("heading", { name: "SSH Tunnel" })).toBeVisible();
  await expect(page.getByText("SSH host", { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder("SSH server host")).toHaveValue("ssh.example.com");
});
