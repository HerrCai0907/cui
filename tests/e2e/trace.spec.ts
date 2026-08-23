import { expect, test } from '@playwright/test';

import { currentWorkspace, mockSession, mockSessions } from './helpers';

test('renders updated todo list items in the execution trace', async ({ page }) => {
  const traceEvents = [
    {
      type: 'thread.started',
      thread_id: '01a02bcd-24e4-7193-a9d9-f7f2c58ae3e0',
    },
    { type: 'turn.started' },
    {
      type: 'item.started',
      item: {
        id: 'item_0',
        type: 'todo_list',
        items: [
          { text: 'A', completed: false },
          { text: 'B', completed: false },
        ],
      },
    },
    {
      type: 'item.completed',
      item: {
        id: 'item_1',
        type: 'agent_message',
        text: '已添加两个 todo task：A、B。现在我把它们改成 C、D。',
      },
    },
    {
      type: 'item.updated',
      item: {
        id: 'item_0',
        type: 'todo_list',
        items: [
          { text: 'C', completed: false },
          { text: 'D', completed: false },
        ],
      },
    },
    {
      type: 'item.completed',
      item: {
        id: 'item_2',
        type: 'agent_message',
        text: '已把 todo task 改成 C、D。接着标记 C 完成。',
      },
    },
    {
      type: 'item.updated',
      item: {
        id: 'item_0',
        type: 'todo_list',
        items: [
          { text: 'C', completed: true },
          { text: 'D', completed: false },
        ],
      },
    },
    {
      type: 'item.completed',
      item: {
        id: 'item_0',
        type: 'todo_list',
        items: [
          { text: 'C', completed: true },
          { text: 'D', completed: false },
        ],
      },
    },
  ];
  const session = {
    id: 'session-trace-todo',
    workspace: currentWorkspace,
    title: 'Trace todo session',
    createdAt: '2026-08-22T00:00:00.000Z',
    updatedAt: '2026-08-22T00:00:00.000Z',
    messages: [
      {
        id: 'trace-message-1',
        role: 'assistant',
        kind: 'trace',
        content: traceEvents.map((event) => JSON.stringify(event)).join('\n'),
        createdAt: '2026-08-22T00:00:00.000Z',
      },
    ],
    rounds: [],
  };

  await mockSessions(page, [session]);
  await mockSession(page, session);

  await page.goto('/');
  await page.getByText('Show execution trace').click();

  await expect(page.getByText('updated / 0/2 done')).toBeVisible();
  await expect(page.getByText('updated / 1/2 done')).toBeVisible();
  await expect(page.getByText('completed / 1/2 done')).toBeVisible();
  const finalTodoList = page.locator('.trace-event-todo').last();

  await expect(finalTodoList.locator('li.is-completed', { hasText: 'C' })).toBeVisible();
  await expect(finalTodoList.locator('li:not(.is-completed)', { hasText: 'D' })).toBeVisible();
  await expect(page.getByText('Unknown item')).toHaveCount(0);
});
