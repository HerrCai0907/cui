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

test('renders atomic review output for a round diff', async ({ page }) => {
  const browserErrors: string[] = [];
  const session = {
    id: 'session-1',
    workspace: '/Users/bytedance/cui',
    title: 'Atomic review session',
    summary: 'A session with a reviewed diff.',
    createdAt: '2026-08-22T00:00:00.000Z',
    updatedAt: '2026-08-22T00:00:00.000Z',
    messages: [],
    rounds: [
      {
        round: 1,
        hasChanges: true,
        createdAt: '2026-08-22T00:00:00.000Z',
      },
    ],
  };
  const diff = [
    'diff --git a/src/example.ts b/src/example.ts',
    '--- a/src/example.ts',
    '+++ b/src/example.ts',
    '@@ -1,3 +1,4 @@',
    ' export function value() {',
    '-  return 1;',
    '+  return 2;',
    ' }',
  ].join('\n');

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
        body: JSON.stringify({ sessions: [session] }),
      });
      return;
    }

    await route.fallback();
  });
  await page.route('**/api/sessions/session-1', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ session }),
    });
  });
  await page.route('**/api/sessions/session-1/rounds/1/review', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        review: {
          round: 1,
          beforeDiff: '',
          afterDiff: diff,
          diff,
          hasChanges: true,
          createdAt: '2026-08-22T00:00:00.000Z',
          atomicReview: {
            status: 'ready',
            generatedAt: '2026-08-22T00:00:00.000Z',
            analysisSessionId: 'analysis-session-1',
            rawResponse: '',
            items: [
              {
                id: 'atomic-1',
                order: 1,
                capabilityType: 3,
                capabilityLabel: '单点修改',
                title: 'Adjust return value',
                intent: 'Change the local function behavior to return the new value.',
                files: ['src/example.ts'],
                diff,
                outputJson: {
                  id: 'atomic-1',
                  order: 1,
                  capability_type: 3,
                  capability_label: '单点修改',
                  title: 'Adjust return value',
                  intent: 'Change the local function behavior to return the new value.',
                  files: ['src/example.ts'],
                },
              },
            ],
          },
        },
      }),
    });
  });

  await page.goto('/ui/sessions/session-1/rounds/1/atomic_review');

  await expect(page.getByRole('heading', { name: 'Round 1' })).toBeVisible();
  await expect(page.getByText('1 atomic changes')).toBeVisible();
  await expect(page.getByText('Round changes')).not.toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Adjust return value' }),
  ).toBeVisible();
  await expect(page.getByText('src/example.ts').first()).toBeVisible();
  const atomicChange = page
    .locator('.atomic-review-item')
    .filter({ hasText: 'Adjust return value' });
  const intent = atomicChange.getByText(
    'Change the local function behavior to return the new value.',
    { exact: true },
  );

  await expect(atomicChange.getByText('+  return 2;')).toBeVisible();
  await atomicChange.getByRole('button', { name: 'Approve all' }).click();
  await expect(atomicChange.getByText('+  return 2;')).not.toBeVisible();
  await atomicChange.getByRole('button', { name: 'Unapprove all' }).click();
  await expect(atomicChange.getByText('+  return 2;')).toBeVisible();
  await atomicChange.getByLabel('Approve src/example.ts').check();
  await expect(atomicChange.getByText('+  return 2;')).not.toBeVisible();
  await atomicChange.getByLabel('Approve src/example.ts').uncheck();
  await expect(atomicChange.getByText('+  return 2;')).toBeVisible();
  await atomicChange.getByLabel('Collapse atomic change 1').click();
  await expect(
    page.getByRole('heading', { name: 'Adjust return value' }),
  ).toBeVisible();
  await expect(intent).toBeVisible();
  await expect(atomicChange.getByText('+  return 2;')).not.toBeVisible();
  await atomicChange.getByLabel('Expand atomic change 1').click();
  await expect(intent).toBeVisible();
  await expect(page.getByText('JSON output')).toHaveCount(0);
  await page.getByRole('button', { name: 'Full review' }).click();
  await expect(page).toHaveURL(/\/ui\/sessions\/session-1\/rounds\/1\/full_review$/);
  await expect(page.getByText('Round changes')).toBeVisible();
  await expect(page.getByText('1 atomic changes')).not.toBeVisible();
  await expect(page.getByText('+  return 2;').first()).toBeVisible();
  expect(browserErrors).toEqual([]);
});
