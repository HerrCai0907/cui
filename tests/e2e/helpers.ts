import type { Page } from "@playwright/test";
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
type RpcRequest = {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
};
type RpcHandler = (params: unknown, request: RpcRequest) => unknown | Promise<unknown>;
type RpcMockState = {
  handlers: Map<string, RpcHandler>;
  sessionSource?: SessionSource;
  sessionOverrides: Map<string, MockSession | (() => MockSession)>;
  roundReviews: Array<{
    sessionId: string;
    round: number;
    review: unknown;
  }>;
  diffPageHandlers: Array<{
    atomic: boolean;
    pageBody: unknown | ((params: Record<string, unknown>) => unknown);
  }>;
};

const rpcMocks = new WeakMap<Page, RpcMockState>();

export async function mockRpcMethod(page: Page, method: string, handler: RpcHandler) {
  const state = await ensureRpcMock(page);

  state.handlers.set(method, handler);
}

export async function emitRunEvent(page: Page, runId: string, event: unknown) {
  await page.evaluate(
    ({ currentRunId, currentEvent }) => {
      (
        window as Window & {
          __cuiRpcMockEmit?: (method: string, params: unknown) => void;
        }
      ).__cuiRpcMockEmit?.("run.event", {
        subscriptionId: `subscription-${currentRunId}`,
        runId: currentRunId,
        event: currentEvent,
      });
    },
    { currentRunId: runId, currentEvent: event },
  );
}

async function ensureRpcMock(page: Page): Promise<RpcMockState> {
  const existing = rpcMocks.get(page);

  if (existing) {
    return existing;
  }

  const state: RpcMockState = {
    handlers: new Map(),
    sessionOverrides: new Map(),
    roundReviews: [],
    diffPageHandlers: [],
  };

  rpcMocks.set(page, state);
  state.handlers.set("health.check", () => ({
    status: "ok",
    service: "@cui/api",
    time: new Date().toISOString(),
  }));
  state.handlers.set("sessions.list", (params) => createSessionListPage(state, params));
  state.handlers.set("sessions.get", (params) => ({ session: findMockSession(state, params) }));
  state.handlers.set("sessions.messages", (params) => createSessionMessagesPage(state, params));
  state.handlers.set("runs.subscribe", (params) => ({
    subscriptionId: `subscription-${readRecord(params).runId ?? "run"}`,
  }));
  state.handlers.set("runs.unsubscribe", () => ({ status: "ok" }));
  await page.exposeFunction("__cuiRpcMockHandle", async (request: RpcRequest) => {
    try {
      const handler = state.handlers.get(request.method);

      if (!handler) {
        return {
          error: {
            code: -32601,
            message: `No e2e RPC mock registered for ${request.method}`,
          },
        };
      }

      return { result: await handler(request.params ?? {}, request) };
    } catch (error) {
      return {
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  });
  await page.addInitScript(() => {
    const nativeWebSocket = window.WebSocket;
    const rpcSockets = new Set<MockRpcWebSocket>();
    const rpcPaths = new Set(["/api/v1/rpc", "/api/v1/rpc/state", "/api/v1/rpc/actions"]);

    class MockRpcWebSocket extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      readonly url: string;
      rpcChannel: "legacy" | "state" | "actions" = "legacy";
      readyState = MockRpcWebSocket.CONNECTING;

      constructor(url: string | URL, protocols?: string | string[]) {
        super();
        this.url = String(url);
        const parsed = new URL(this.url, window.location.href);

        if (!rpcPaths.has(parsed.pathname)) {
          return new nativeWebSocket(url, protocols) as unknown as MockRpcWebSocket;
        }

        this.rpcChannel =
          parsed.pathname === "/api/v1/rpc/state"
            ? "state"
            : parsed.pathname === "/api/v1/rpc/actions"
              ? "actions"
              : "legacy";
        queueMicrotask(() => {
          this.readyState = MockRpcWebSocket.OPEN;
          rpcSockets.add(this);
          this.dispatchEvent(new Event("open"));
        });
      }

      send(data: string) {
        const request = JSON.parse(String(data)) as RpcRequest;
        void (
          window as Window & {
            __cuiRpcMockHandle?: (request: RpcRequest) => Promise<{
              result?: unknown;
              error?: { code: number; message: string };
            }>;
          }
        )
          .__cuiRpcMockHandle?.(request)
          .then((response) => {
            if (this.readyState !== MockRpcWebSocket.OPEN) {
              return;
            }

            this.dispatchEvent(
              new MessageEvent("message", {
                data: JSON.stringify({
                  jsonrpc: "2.0",
                  id: request.id,
                  ...(response?.error ? { error: response.error } : { result: response?.result }),
                }),
              }),
            );
          });
      }

      close() {
        if (this.readyState === MockRpcWebSocket.CLOSED) {
          return;
        }

        this.readyState = MockRpcWebSocket.CLOSED;
        rpcSockets.delete(this);
        this.dispatchEvent(new CloseEvent("close"));
      }
    }

    (
      window as Window & {
        __cuiRpcMockEmit?: (method: string, params: unknown) => void;
      }
    ).__cuiRpcMockEmit = (method, params) => {
      if (rpcSockets.size === 0) {
        throw new Error("No e2e RPC socket is connected");
      }

      for (const socket of rpcSockets) {
        if (
          socket.readyState !== MockRpcWebSocket.OPEN ||
          (socket.rpcChannel !== "state" && socket.rpcChannel !== "legacy")
        ) {
          continue;
        }

        socket.dispatchEvent(
          new MessageEvent("message", {
            data: JSON.stringify({
              jsonrpc: "2.0",
              method,
              params,
            }),
          }),
        );
      }
    };
    Object.assign(MockRpcWebSocket, {
      CONNECTING: nativeWebSocket.CONNECTING,
      OPEN: nativeWebSocket.OPEN,
      CLOSING: nativeWebSocket.CLOSING,
      CLOSED: nativeWebSocket.CLOSED,
    });
    window.WebSocket = MockRpcWebSocket as unknown as typeof WebSocket;
  });

  return state;
}

export function createSubmittedRunResponse(
  session: MockSession,
  runId: string,
  options: {
    status?: "queued" | "running";
    type?: "assistant_response" | "shell_command" | "round_review";
  } = {},
) {
  return {
    run: {
      id: runId,
      sessionId: session.id,
      type: options.type ?? "assistant_response",
      status: options.status ?? "running",
      createdAt: "2026-08-22T00:00:00.000Z",
    },
    session,
  };
}

function createSessionListPage(state: RpcMockState, params: unknown) {
  const record = readRecord(params);
  const currentSessions = getMockSessions(state);
  const page = Math.max(1, Number(record.page) || 1);
  const pageSize = Math.max(1, Number(record.pageSize) || currentSessions.length || 1);
  const totalPages = Math.max(1, Math.ceil(currentSessions.length / pageSize));
  const normalizedPage = Math.min(page, totalPages);
  const pageSessions = currentSessions.slice(
    (normalizedPage - 1) * pageSize,
    normalizedPage * pageSize,
  );

  return {
    sessions: pageSessions,
    pagination: {
      page: normalizedPage,
      pageSize,
      total: currentSessions.length,
      totalPages,
      hasPreviousPage: normalizedPage > 1,
      hasNextPage: normalizedPage < totalPages,
    },
  };
}

function findMockSession(state: RpcMockState, params: unknown): MockSession {
  const sessionId = String(readRecord(params).sessionId ?? "");
  const override = state.sessionOverrides.get(sessionId);
  const session =
    typeof override === "function"
      ? override()
      : (override ?? getMockSessions(state).find((current) => current.id === sessionId));

  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  return session;
}

function createSessionMessagesPage(state: RpcMockState, params: unknown) {
  const record = readRecord(params);
  const session = findMockSession(state, params);
  const messages = Array.isArray(session.messages) ? session.messages : [];
  const limit = Math.max(1, Number(record.limit) || messages.length || 1);
  const beforeMessageId = typeof record.beforeMessageId === "string" ? record.beforeMessageId : "";
  const endIndex = beforeMessageId
    ? Math.max(
        0,
        messages.findIndex((message) => readRecord(message).id === beforeMessageId),
      )
    : messages.length;
  const pageMessages = messages.slice(Math.max(0, endIndex - limit), endIndex);

  return {
    messages: pageMessages,
    pageInfo: {
      total: messages.length,
      returned: pageMessages.length,
      hasMoreBefore: endIndex - pageMessages.length > 0,
      hasMoreAfter: endIndex < messages.length,
      oldestMessageId: readRecord(pageMessages.at(0)).id,
      newestMessageId: readRecord(pageMessages.at(-1)).id,
    },
  };
}

function getMockSessions(state: RpcMockState): MockSession[] {
  return state.sessionSource
    ? typeof state.sessionSource === "function"
      ? state.sessionSource()
      : state.sessionSource
    : [];
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export async function mockSessions(page: Page, sessions: SessionSource) {
  const state = await ensureRpcMock(page);

  state.sessionSource = sessions;
  await mockModels(page);
}

export async function mockModels(page: Page) {
  await mockRpcMethod(page, "models.list", (params) => {
    const harness = String(readRecord(params).harness ?? "traex");
    const models =
      harness === "codex"
        ? [
            {
              name: "gpt-6-astra",
              provider: "openai",
              description: "Mock Codex model",
              defaultReasoningEffort: "medium",
              supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
            },
            {
              name: "gpt-5.5",
              provider: "openai",
              description: "Mock Codex model",
              defaultReasoningEffort: "medium",
              supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
            },
          ]
        : [
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
          ];

    return { models };
  });
}

export async function mockWorkspaceGitInfo(
  page: Page,
  gitInfo: {
    workspace?: string;
    gitBranch?: string;
    gitCommitSha?: string;
  },
) {
  await mockRpcMethod(page, "code.workspaceGitInfo", (params) => {
    return {
      workspace: gitInfo.workspace ?? String(readRecord(params).workspace ?? currentWorkspace),
      gitBranch: gitInfo.gitBranch,
      gitCommitSha: gitInfo.gitCommitSha,
    };
  });
}

export async function mockSession(page: Page, session: MockSession) {
  const state = await ensureRpcMock(page);

  state.sessionOverrides.set(session.id, session);
}

export async function mockSessionById(
  page: Page,
  sessionId: string,
  session: MockSession | (() => MockSession),
) {
  const state = await ensureRpcMock(page);

  state.sessionOverrides.set(sessionId, session);
}

export async function mockRoundReview(
  page: Page,
  sessionId: string,
  round: number,
  review: unknown,
) {
  const state = await ensureRpcMock(page);

  state.roundReviews.push({ sessionId, round, review });
  await mockRpcMethod(page, "reviews.getRound", (params) => {
    const record = readRecord(params);
    const match = state.roundReviews.find(
      (current) => current.sessionId === record.sessionId && current.round === Number(record.round),
    );

    if (match) {
      return { review: match.review };
    }

    throw new Error("Round review not found");
  });
}

export async function mockDiffFilePage(
  page: Page,
  options: { atomic?: boolean },
  pageBody: unknown | ((params: Record<string, unknown>) => unknown),
) {
  const state = await ensureRpcMock(page);
  const atomic = options.atomic === true;
  const handler = {
    atomic,
    pageBody,
  };

  state.diffPageHandlers.push(handler);
  await mockRpcMethod(
    page,
    atomic ? "reviews.getAtomicDiffFilePage" : "reviews.getRoundDiffFilePage",
    (params) => {
      const match = state.diffPageHandlers.findLast((current) => current.atomic === atomic);

      if (!match) {
        throw new Error("Diff page not found");
      }

      return {
        page:
          typeof match.pageBody === "function"
            ? match.pageBody(readRecord(params))
            : match.pageBody,
      };
    },
  );
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

export async function storeAppConfig(
  page: Page,
  configPatch: Partial<ReturnType<typeof createDefaultAppConfig>>,
) {
  const defaultConfig = createDefaultAppConfig();
  const storedConfig = {
    version: 1,
    ...defaultConfig,
    ...configPatch,
    sshTunnel: {
      ...defaultConfig.sshTunnel,
      ...configPatch.sshTunnel,
    },
    vscode: {
      ...defaultConfig.vscode,
      ...configPatch.vscode,
      remoteSsh: {
        ...defaultConfig.vscode.remoteSsh,
        ...configPatch.vscode?.remoteSsh,
      },
    },
    models: {
      ...defaultConfig.models,
      ...configPatch.models,
    },
    reasoningEfforts: {
      ...defaultConfig.reasoningEfforts,
      ...configPatch.reasoningEfforts,
    },
    executionTrace: {
      ...defaultConfig.executionTrace,
      ...configPatch.executionTrace,
      visibleMessageTypes: {
        ...defaultConfig.executionTrace.visibleMessageTypes,
        ...configPatch.executionTrace?.visibleMessageTypes,
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
