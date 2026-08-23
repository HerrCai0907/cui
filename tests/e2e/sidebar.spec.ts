import { expect, test } from '@playwright/test';

import { currentWorkspace, mockSession, mockSessions } from './helpers';

test('merges shared workspace path prefixes in the sidebar', async ({ page }) => {
  const firstSession = {
    id: 'session-1',
    workspace: currentWorkspace,
    title: 'CUI session',
    createdAt: '2026-08-22T00:00:00.000Z',
    updatedAt: '2026-08-22T00:00:00.000Z',
    messages: [],
    rounds: [],
  };
  const secondSession = {
    id: 'session-2',
    workspace: '/Users/bytedance/oss/go',
    title: 'Go session',
    createdAt: '2026-08-22T00:00:01.000Z',
    updatedAt: '2026-08-22T00:00:01.000Z',
    messages: [],
    rounds: [],
  };

  await mockSessions(page, [firstSession, secondSession]);

  await page.goto('/');

  const sidebar = page.getByLabel('Workspace sessions');

  await expect(
    sidebar.getByText('/Users/bytedance', { exact: true }),
  ).toBeVisible();
  await expect(sidebar.getByText('cui', { exact: true })).toBeVisible();
  await expect(sidebar.getByText('oss/go', { exact: true })).toBeVisible();
  await expect(
    sidebar.getByText('/Users/bytedance/oss/go', { exact: true }),
  ).toHaveCount(0);

  await page.getByRole('button', { name: '/Users/bytedance/oss/go' }).click();
  await expect(
    page.getByRole('button', { name: 'New session in /Users/bytedance/oss/go' }),
  ).toBeVisible();
});

test('moves older sessions into collapsed history', async ({ page }) => {
  const sessions = Array.from({ length: 18 }, (_, index) => ({
    id: `session-${index}`,
    workspace: currentWorkspace,
    title: `Session ${index}`,
    createdAt: new Date(Date.UTC(2026, 7, 22, 0, 0, index)).toISOString(),
    updatedAt: new Date(Date.UTC(2026, 7, 22, 0, 0, 17 - index)).toISOString(),
    messages: [
      {
        id: `message-${index}`,
        role: 'assistant',
        kind: 'response',
        content: `Session ${index} response`,
        createdAt: new Date(Date.UTC(2026, 7, 22, 0, 0, index)).toISOString(),
      },
    ],
    rounds: [],
    currentRound: 1,
    isRunning: false,
  }));

  await mockSessions(page, sessions);
  await mockSession(page, sessions[17]);

  await page.goto('/');

  await expect(page.getByRole('button', { name: 'Session 15' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Session 16' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Session 17' })).toHaveCount(0);

  await page.getByText('History', { exact: true }).click();

  await expect(page.getByRole('button', { name: 'Session 16' })).toBeVisible();
  await page.getByRole('button', { name: 'Session 17' }).click();
  await expect(page.getByRole('heading', { name: 'Session 17' })).toBeVisible();
});
