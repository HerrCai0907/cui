import { defineConfig, devices } from '@playwright/test';

const DEFAULT_TEST_WEB_PORT = '5174';
const DEFAULT_TEST_API_PORT = '3001';

const testWebPort = process.env.PLAYWRIGHT_TEST_PORT ?? DEFAULT_TEST_WEB_PORT;
const testApiPort =
  process.env.PLAYWRIGHT_TEST_API_PORT ?? DEFAULT_TEST_API_PORT;
const baseURL =
  process.env.PLAYWRIGHT_TEST_BASE_URL ?? `http://localhost:${testWebPort}`;
const serverPort = new URL(baseURL).port || testWebPort;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: `CUI_API_PORT=${testApiPort} npm run dev -w @cui/web -- --port ${serverPort} --strictPort`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
