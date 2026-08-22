import { expect, test } from '@playwright/test';

test('loads the new session screen without browser errors', async ({ page }) => {
  const browserErrors: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      browserErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    browserErrors.push(error.message);
  });

  await page.route('**/api/sessions', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ sessions: [] }),
      });
      return;
    }

    await route.fallback();
  });

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'New session' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New session' })).toBeVisible();
  await expect(page.getByLabel('Workspace path')).toHaveValue('/Users/bytedance/cui');
  await expect(page.getByPlaceholder('Start with an initial prompt...')).toBeVisible();
  await expect(page.getByLabel('Send message')).toBeVisible();
  expect(browserErrors).toEqual([]);
});
