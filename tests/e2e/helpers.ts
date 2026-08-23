import type { Page, Route } from '@playwright/test';

export const currentWorkspace = '/Users/bytedance/cui';

export type MockSession = {
  id: string;
  [key: string]: unknown;
};

type SessionSource = MockSession[] | (() => MockSession[]);

export async function fulfillJson(route: Route, body: unknown) {
  await route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

export async function mockSessions(page: Page, sessions: SessionSource) {
  await page.route('**/api/sessions', async (route) => {
    if (route.request().method() === 'GET') {
      await fulfillJson(route, {
        sessions: typeof sessions === 'function' ? sessions() : sessions,
      });
      return;
    }

    await route.fallback();
  });
}

export async function mockSession(page: Page, session: MockSession) {
  await page.route(`**/api/sessions/${session.id}`, async (route) => {
    await fulfillJson(route, { session });
  });
}

export async function mockSessionById(
  page: Page,
  sessionId: string,
  session: MockSession | (() => MockSession),
) {
  await page.route(`**/api/sessions/${sessionId}`, async (route) => {
    await fulfillJson(route, {
      session: typeof session === 'function' ? session() : session,
    });
  });
}

export async function mockRoundReview(
  page: Page,
  sessionId: string,
  round: number,
  review: unknown,
) {
  await page.route(
    `**/api/sessions/${sessionId}/rounds/${round}/review`,
    async (route) => {
      await fulfillJson(route, { review });
    },
  );
}
