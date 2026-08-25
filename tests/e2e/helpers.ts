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
  await page.route("**/api/sessions", async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, {
        sessions: typeof sessions === "function" ? sessions() : sessions,
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
