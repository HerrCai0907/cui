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
  const testDiff = [
    'diff --git a/src/example.test.ts b/src/example.test.ts',
    '--- a/src/example.test.ts',
    '+++ b/src/example.test.ts',
    '@@ -1,3 +1,4 @@',
    ' test("value", () => {',
    '-  expect(value()).toBe(1);',
    '+  expect(value()).toBe(2);',
    ' });',
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
                capabilityLabel: '局部修复',
                title: 'Adjust return value',
                intent: 'Change the local function behavior to return the new value.',
                files: ['src/example.ts'],
                diff,
                outputJson: {
                  id: 'atomic-1',
                  order: 1,
                  capability_type: 3,
                  capability_label: '局部修复',
                  title: 'Adjust return value',
                  intent: 'Change the local function behavior to return the new value.',
                  files: ['src/example.ts'],
                },
              },
              {
                id: 'atomic-2',
                order: 2,
                capabilityType: 5,
                capabilityLabel: '测试修改',
                title: 'Update value assertion',
                intent: 'Adjust the test assertion for the updated value() output.',
                files: ['src/example.test.ts'],
                diff: testDiff,
                outputJson: {
                  id: 'atomic-2',
                  order: 2,
                  capability_type: 5,
                  capability_label: '测试修改',
                  title: 'Update value assertion',
                  intent: 'Adjust the test assertion for the updated value() output.',
                  files: ['src/example.test.ts'],
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
  await expect(page.getByText('2 atomic changes')).toBeVisible();
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
  const testChange = page
    .locator('.atomic-review-item')
    .filter({ hasText: 'Update value assertion' });

  await expect(atomicChange.getByText('+  return 2;')).toBeVisible();
  await expect(testChange).toHaveClass(/is-capability-test/);
  await expect(testChange.getByText('+  expect(value()).toBe(2);')).toBeVisible();
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
  await page.reload();
  await expect(page.getByLabel('Expand atomic change 1')).toBeVisible();
  await expect(atomicChange.getByText('+  return 2;')).not.toBeVisible();
  await atomicChange.getByLabel('Expand atomic change 1').click();
  await expect(intent).toBeVisible();
  await atomicChange.getByLabel('Approve src/example.ts').check();
  await page.reload();
  await expect(atomicChange.getByText('+  return 2;')).not.toBeVisible();
  await expect(page.getByText('JSON output')).toHaveCount(0);
  await page.getByRole('button', { name: 'Full review' }).click();
  await expect(page).toHaveURL(/\/ui\/sessions\/session-1\/rounds\/1\/full_review$/);
  await expect(page.getByText('Round changes')).toBeVisible();
  await expect(page.getByText('2 atomic changes')).not.toBeVisible();
  await expect(page.getByText('+  return 2;').first()).toBeVisible();
  await page.getByLabel('Approve src/example.ts').check();
  await page.reload();
  await expect(page.getByText('+  return 2;').first()).not.toBeVisible();
  expect(
    await page.evaluate(() => {
      const rawState = localStorage.getItem('cui:review-state:v1:session-1:1');

      if (!rawState) {
        return null;
      }

      const state = JSON.parse(rawState) as {
        expiresAt?: number;
        updatedAt?: number;
      };

      return {
        ttlMs: (state.expiresAt ?? 0) - (state.updatedAt ?? 0),
      };
    }),
  ).toEqual({ ttlMs: 7 * 24 * 60 * 60 * 1000 });

  await page.evaluate(() => {
    localStorage.setItem(
      'cui:review-state:v1:session-1:1',
      JSON.stringify({
        version: 1,
        fullApprovedFileIds: ['0:src/example.ts'],
        atomicItems: {
          'atomic-1': {
            collapsed: true,
            approvedFileIds: ['0:src/example.ts'],
          },
        },
        updatedAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
        expiresAt: Date.now() - 1,
      }),
    );
  });
  await page.goto('/ui/sessions/session-1/rounds/1/atomic_review');
  await expect(page.getByLabel('Collapse atomic change 1')).toBeVisible();
  await expect(page.getByText('+  return 2;')).toBeVisible();
  await expect(
    page.evaluate(() => localStorage.getItem('cui:review-state:v1:session-1:1')),
  ).resolves.toBeNull();
  expect(browserErrors).toEqual([]);
});

test('expands review diff context by 10 lines in each direction', async ({
  page,
}) => {
  const session = {
    id: 'session-context',
    workspace: '/Users/bytedance/cui',
    title: 'Context expansion session',
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
  const contextLines = Array.from(
    { length: 40 },
    (_, index) => ` const value${index + 1} = ${index + 1};`,
  );
  const diff = [
    'diff --git a/src/context.ts b/src/context.ts',
    '--- a/src/context.ts',
    '+++ b/src/context.ts',
    '@@ -1,40 +1,40 @@',
    ...contextLines.slice(0, 19),
    '-const value20 = 20;',
    '+const value20 = 200;',
    ...contextLines.slice(20),
  ].join('\n');

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
  await page.route('**/api/sessions/session-context', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ session }),
    });
  });
  await page.route(
    '**/api/sessions/session-context/rounds/1/review',
    async (route) => {
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
          },
        }),
      });
    },
  );

  await page.goto('/ui/sessions/session-context/rounds/1/full_review');

  await expect(page.getByText(' const value17 = 17;')).toBeVisible();
  await expect(page.getByText(' const value16 = 16;')).not.toBeVisible();
  await expect(page.getByText(' const value23 = 23;')).toBeVisible();
  await expect(page.getByText(' const value24 = 24;')).not.toBeVisible();

  await page.getByLabel('Expand 10 lines up').click();
  await expect(page.getByText(' const value7 = 7;')).toBeVisible();
  await expect(page.getByText(' const value6 = 6;')).not.toBeVisible();

  await page.getByLabel('Expand 10 lines down').click();
  await expect(page.getByText(' const value33 = 33;')).toBeVisible();
  await expect(page.getByText(' const value34 = 34;')).not.toBeVisible();
});

test('keeps only the running session blocked while another turn is active', async ({
  page,
}) => {
  const sessionOne = {
    id: 'session-1',
    workspace: '/Users/bytedance/cui',
    title: 'Running session',
    createdAt: '2026-08-22T00:00:00.000Z',
    updatedAt: '2026-08-22T00:00:00.000Z',
    messages: [],
    rounds: [],
  };
  const sessionTwo = {
    id: 'session-2',
    workspace: '/Users/bytedance/cui',
    title: 'Other session',
    createdAt: '2026-08-22T00:00:00.000Z',
    updatedAt: '2026-08-22T00:00:00.000Z',
    messages: [
      {
        id: 'message-2',
        role: 'assistant',
        kind: 'response',
        content: 'Available session',
        createdAt: '2026-08-22T00:00:00.000Z',
      },
    ],
    rounds: [],
  };
  const startedSessionOne = {
    ...sessionOne,
    messages: [
      {
        id: 'message-1',
        role: 'user',
        content: 'Run a long task',
        createdAt: '2026-08-22T00:00:00.000Z',
      },
    ],
  };

  await page.route('**/api/sessions', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ sessions: [sessionOne, sessionTwo] }),
      });
      return;
    }

    await route.fallback();
  });
  await page.route('**/api/sessions/session-1', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ session: sessionOne }),
    });
  });
  await page.route('**/api/sessions/session-2', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ session: sessionTwo }),
    });
  });
  await page.route('**/api/sessions/session-1/messages', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        session: startedSessionOne,
        turnId: 'turn-1',
      }),
    });
  });
  await page.route('**/api/turns/turn-1/events', async () => {
    // Keep the stream open so session-1 remains blocked.
  });

  await page.goto('/');
  await page.getByPlaceholder('Continue this session...').fill('Run a long task');
  await page.getByRole('button', { name: 'Send message' }).click();

  await expect(page.getByText('Waiting for TRAEX...')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send message' })).toBeDisabled();

  await page.getByRole('button', { name: 'Other session' }).click();

  await expect(page.getByRole('heading', { name: 'Other session' })).toBeVisible();
  await expect(page.getByText('Available session')).toBeVisible();
  await expect(page.getByText('Waiting for TRAEX...')).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Send message' })).toBeEnabled();

  await page.getByRole('button', { name: 'New session' }).click();

  await expect(page.getByRole('heading', { name: 'New session' })).toBeVisible();
  await expect(page.getByPlaceholder('Start with an initial prompt...')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send message' })).toBeEnabled();

  await page.getByRole('button', { name: 'Running session' }).click();

  await expect(page.getByRole('heading', { name: 'Running session' })).toBeVisible();
  await expect(page.getByText('Waiting for TRAEX...')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send message' })).toBeDisabled();
});

test('reconnects to a running turn after page reload', async ({ page }) => {
  const runningSession = {
    id: 'session-1',
    workspace: '/Users/bytedance/cui',
    title: 'Running session',
    createdAt: '2026-08-22T00:00:00.000Z',
    updatedAt: '2026-08-22T00:00:00.000Z',
    messages: [
      {
        id: 'message-1',
        role: 'user',
        content: 'Run a long task',
        createdAt: '2026-08-22T00:00:00.000Z',
      },
    ],
    rounds: [],
    runningTurnId: 'turn-1',
  };
  const completedSession = {
    ...runningSession,
    runningTurnId: undefined,
    messages: [
      ...runningSession.messages,
      {
        id: 'message-2',
        role: 'assistant',
        kind: 'response',
        content: 'Finished after reconnect.',
        createdAt: '2026-08-22T00:00:01.000Z',
      },
    ],
  };
  let sessionListRequests = 0;

  await page.addInitScript(() => {
    const eventSourceUrls: string[] = [];

    (
      window as Window & {
        __eventSourceUrls?: string[];
      }
    ).__eventSourceUrls = eventSourceUrls;

    class MockEventSource extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 2;
      readonly CONNECTING = 0;
      readonly OPEN = 1;
      readonly CLOSED = 2;
      readonly url: string;
      readonly withCredentials = false;
      readyState = MockEventSource.CONNECTING;
      onerror: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onopen: ((event: Event) => void) | null = null;

      constructor(url: string | URL) {
        super();
        this.url = String(url);
        eventSourceUrls.push(this.url);

        window.setTimeout(() => {
          this.readyState = MockEventSource.OPEN;
          this.dispatchEvent(new Event('open'));
          this.dispatchEvent(
            new MessageEvent('delta', {
              data: JSON.stringify({
                type: 'delta',
                text: 'Recovered response',
              }),
            }),
          );
          this.dispatchEvent(
            new MessageEvent('done', {
              data: JSON.stringify({
                type: 'done',
                session: {
                  id: 'session-1',
                  workspace: '/Users/bytedance/cui',
                  title: 'Running session',
                  createdAt: '2026-08-22T00:00:00.000Z',
                  updatedAt: '2026-08-22T00:00:00.000Z',
                  messages: [
                    {
                      id: 'message-1',
                      role: 'user',
                      content: 'Run a long task',
                      createdAt: '2026-08-22T00:00:00.000Z',
                    },
                    {
                      id: 'message-2',
                      role: 'assistant',
                      kind: 'response',
                      content: 'Finished after reconnect.',
                      createdAt: '2026-08-22T00:00:01.000Z',
                    },
                  ],
                  rounds: [],
                },
              }),
            }),
          );
        }, 0);
      }

      close() {
        this.readyState = MockEventSource.CLOSED;
      }
    }

    window.EventSource = MockEventSource as typeof EventSource;
  });

  await page.route('**/api/sessions', async (route) => {
    if (route.request().method() === 'GET') {
      sessionListRequests += 1;
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          sessions: [sessionListRequests === 1 ? runningSession : completedSession],
        }),
      });
      return;
    }

    await route.fallback();
  });
  await page.route('**/api/sessions/session-1', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ session: runningSession }),
    });
  });

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Running session' })).toBeVisible();
  await expect(page.getByText('Finished after reconnect.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send message' })).toBeEnabled();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __eventSourceUrls?: string[];
            }
          ).__eventSourceUrls ?? [],
      ),
    )
    .toEqual(['/api/turns/turn-1/events']);
});
