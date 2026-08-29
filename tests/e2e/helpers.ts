import type { Page, Route } from "@playwright/test";
import {
  APP_CONFIG_STORAGE_KEY,
  EXECUTION_TRACE_MESSAGE_TYPES,
  createDefaultAppConfig,
  type ExecutionTraceMessageType,
} from "../../apps/web/src/features/config/model/appConfig";

export const currentWorkspace = "/Users/bytedance/cui";

export type MockSession = {
  id: string;
  [key: string]: unknown;
};

type SessionSource = MockSession[] | (() => MockSession[]);

export async function fulfillJson(route: Route, body: unknown) {
  await route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

export async function mockSessions(page: Page, sessions: SessionSource) {
  await mockModels(page);
  await page.route("**/api/sessions**", async (route) => {
    const url = new URL(route.request().url());

    if (route.request().method() === "GET" && url.pathname === "/api/sessions") {
      const currentSessions = typeof sessions === "function" ? sessions() : sessions;
      const pageNumber = Math.max(1, Number(url.searchParams.get("page")) || 1);
      const pageSize = Math.max(
        1,
        Number(url.searchParams.get("pageSize")) || currentSessions.length || 1,
      );
      const totalPages = Math.max(1, Math.ceil(currentSessions.length / pageSize));
      const normalizedPage = Math.min(pageNumber, totalPages);
      const pageSessions = currentSessions.slice(
        (normalizedPage - 1) * pageSize,
        normalizedPage * pageSize,
      );

      await fulfillJson(route, {
        sessions: pageSessions,
        pagination: {
          page: normalizedPage,
          pageSize,
          total: currentSessions.length,
          totalPages,
          hasPreviousPage: normalizedPage > 1,
          hasNextPage: normalizedPage < totalPages,
        },
      });
      return;
    }

    await route.fallback();
  });
}

export async function mockModels(page: Page) {
  await page.route("**/api/models", async (route) => {
    await fulfillJson(route, {
      models: [
        {
          name: "GPT-5.4",
          provider: "trae",
          description: "Mock model",
          contextWindow: 200000,
        },
        {
          name: "Seed-2.1-Turbo",
          provider: "trae",
          description: "Mock model",
          contextWindow: 184000,
        },
        {
          name: "DeepSeek-V4-Pro",
          provider: "trae",
          description: "Mock model",
          contextWindow: 200000,
        },
      ],
    });
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
      session: typeof session === "function" ? session() : session,
    });
  });
}

export async function mockRoundReview(
  page: Page,
  sessionId: string,
  round: number,
  review: unknown,
) {
  await page.route(`**/api/sessions/${sessionId}/rounds/${round}/review**`, async (route) => {
    await fulfillJson(route, { review });
  });
}

export async function showExecutionTraceTypes(page: Page, types: ExecutionTraceMessageType[]) {
  const defaultConfig = createDefaultAppConfig();
  const storedConfig = {
    version: 1,
    executionTrace: {
      visibleMessageTypes: {
        ...defaultConfig.executionTrace.visibleMessageTypes,
        ...Object.fromEntries(
          types
            .filter((type) => EXECUTION_TRACE_MESSAGE_TYPES.includes(type))
            .map((type) => [type, true]),
        ),
      },
    },
    updatedAt: Date.now(),
  };

  await page.addInitScript(
    ({ storageKey, config }) => {
      localStorage.setItem(storageKey, JSON.stringify(config));
    },
    {
      storageKey: APP_CONFIG_STORAGE_KEY,
      config: storedConfig,
    },
  );
}
