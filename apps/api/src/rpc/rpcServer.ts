import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { z } from "zod";
import type { AiModel } from "../types.js";
import {
  CodeFileNotFoundError,
  CodeFileTooLargeError,
  CodePathNotFileError,
  CodeRangeTooLargeError,
  type CodeQueryService,
} from "../domain/code/CodeQueryService.js";
import {
  UnsupportedLanguageServerError,
  type SourceDefinitionService,
} from "../domain/lsp/SourceDefinitionService.js";
import {
  InvalidPathError,
  PathNotDirectoryError,
  PathNotFoundError,
} from "../domain/paths/pathValidation.js";
import { suggestWorkspacePaths } from "../domain/paths/workspacePaths.js";
import type { RunStreamEvent } from "../domain/runs/runEvents.js";
import { filterSessionViewTraceMessages } from "../domain/sessions/sessionViews.js";
import { isTraceEventVisible, type TraceMessageType } from "../domain/sessions/traceMessages.js";
import {
  QueuedPromptNotFoundError,
  RoundReviewNotFoundError,
  RunNotFoundError,
  SessionBusyError,
  SessionNotFoundError,
  type SessionService,
} from "../domain/sessions/SessionService.js";
import type { AppLogger } from "../infrastructure/logging/AppLogger.js";
import { LanguageServerProcessError } from "../infrastructure/lsp/JsonRpcLanguageClient.js";
import type { StoredRunStreamEvent } from "../infrastructure/store/SessionStore.js";
import {
  parseAtomicDiffFileParams,
  parseCodeRangeQuery,
  parseCreateRoundReviewRunBody,
  parseCreateRunBody,
  parseCreateSessionBody,
  parseDiffFilePageQuery,
  parseGetSessionMessagesQuery,
  parseGetSessionQuery,
  parseListModelsQuery,
  parseListSessionsQuery,
  parseQueuedPromptParams,
  parseRoundDiffFileParams,
  parseRoundReviewParams,
  parseRunEventsQuery,
  parseSourceDefinitionQuery,
  parseUpdateSessionBody,
  parseWorkspaceGitInfoQuery,
  parseWorkspacePathSuggestionsQuery,
  type ParsedBody,
} from "./requestParsers.js";

const RPC_PATHS = ["/api/v1/rpc", "/api/v1/rpc/state", "/api/v1/rpc/actions"] as const;
const jsonRpcVersion = "2.0";

type JsonRpcId = string | number | null;
type JsonRpcRequest = {
  jsonrpc: typeof jsonRpcVersion;
  id?: JsonRpcId;
  method: string;
  params?: unknown;
};
type RpcContext = {
  client: WebSocket;
  subscriptions: Map<string, RunSubscription>;
};
type RunSubscription = {
  runId: string;
  unsubscribe: () => void;
  close: () => void;
};

const RpcEnvelopeSchema = z.object({
  jsonrpc: z.literal(jsonRpcVersion),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.string(),
  params: z.unknown().optional(),
});
const RpcParamsObjectSchema = z.record(z.string(), z.unknown());
const SessionIdParamsSchema = z.object({
  sessionId: z.string().min(1),
});
const RunIdParamsSchema = z.object({
  runId: z.string().min(1),
});
const RunSubscriptionParamsSchema = z.object({
  subscriptionId: z.string().min(1),
});

export function attachRpcServer(
  server: Server,
  input: {
    logger: AppLogger;
    aiModel: AiModel;
    sessionService: SessionService;
    codeQueryService: CodeQueryService;
    sourceDefinitionService: SourceDefinitionService;
  },
): WebSocketServer {
  const webSocketServer = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const pathname = request.url ? new URL(request.url, "http://localhost").pathname : "";

    if (!RPC_PATHS.includes(pathname as (typeof RPC_PATHS)[number])) {
      socket.destroy();
      return;
    }

    webSocketServer.handleUpgrade(request, socket, head, (client) => {
      webSocketServer.emit("connection", client, request);
    });
  });

  webSocketServer.on("connection", (client) => {
    const context: RpcContext = {
      client,
      subscriptions: new Map(),
    };

    client.on("message", (data) => {
      void handleMessage(input, context, data).catch((error: unknown) => {
        void input.logger.framework.error("rpc.message.failed", error);
        sendError(client, null, toRpcError(error));
      });
    });
    client.on("close", () => {
      for (const subscription of context.subscriptions.values()) {
        subscription.close();
      }
      context.subscriptions.clear();
    });
  });

  return webSocketServer;
}

async function handleMessage(
  services: Parameters<typeof attachRpcServer>[1],
  context: RpcContext,
  rawData: WebSocket.RawData,
) {
  const rawText = rawData.toString("utf8");
  let decoded: unknown;

  try {
    decoded = JSON.parse(rawText);
  } catch {
    sendError(context.client, null, {
      code: -32700,
      message: "Parse error",
    });
    return;
  }

  const parsedRequest = RpcEnvelopeSchema.safeParse(decoded);

  if (!parsedRequest.success) {
    sendError(context.client, readRequestId(decoded), {
      code: -32600,
      message: "Invalid Request",
    });
    return;
  }

  const request = parsedRequest.data;

  try {
    const result = await dispatchRpcRequest(services, context, request);

    if (request.id !== undefined) {
      sendResult(context.client, request.id, result);
    }
  } catch (error) {
    if (request.id !== undefined) {
      sendError(context.client, request.id, toRpcError(error));
    }
  }
}

async function dispatchRpcRequest(
  services: Parameters<typeof attachRpcServer>[1],
  context: RpcContext,
  request: JsonRpcRequest,
): Promise<unknown> {
  switch (request.method) {
    case "health.check":
      return { status: "ok", service: "@cui/api", time: new Date().toISOString() };
    case "models.list": {
      const params = parseParams(request.params, parseListModelsQuery);

      return { models: await services.aiModel.listModels(params.harness) };
    }
    case "sessions.list":
      return services.sessionService.listSessionViews(
        parseParams(request.params, parseListSessionsQuery),
      );
    case "sessions.get": {
      const params = parseObject(request.params);
      const { sessionId } = parseZod(SessionIdParamsSchema, params);
      const query = parseParams(params, parseGetSessionQuery);
      const session = await services.sessionService.getSessionView(sessionId, query);

      if (!session) {
        throw new RpcApplicationError(404, "Session not found");
      }

      return { session };
    }
    case "sessions.messages": {
      const params = parseObject(request.params);
      const { sessionId } = parseZod(SessionIdParamsSchema, params);
      const query = parseParams(params, parseGetSessionMessagesQuery);
      const page = await services.sessionService.getSessionMessages(sessionId, query);

      if (!page) {
        throw new RpcApplicationError(404, "Session not found");
      }

      return page;
    }
    case "sessions.create": {
      const session = await services.sessionService.createSessionContainer(
        parseParams(request.params, parseCreateSessionBody),
      );

      return { session };
    }
    case "sessions.update": {
      const params = parseObject(request.params);
      const { sessionId } = parseZod(SessionIdParamsSchema, params);
      const body = parseParams(params, parseUpdateSessionBody);
      const session = await services.sessionService.updateSession(sessionId, body);

      return { session };
    }
    case "sessions.fork": {
      const params = parseObject(request.params);
      const { sessionId } = parseZod(SessionIdParamsSchema, params);

      return services.sessionService.forkSession(sessionId);
    }
    case "sessions.createRun": {
      const params = parseObject(request.params);
      const { sessionId } = parseZod(SessionIdParamsSchema, params);
      const body = parseParams(params.request, parseCreateRunBody);

      return services.sessionService.createRun(sessionId, body);
    }
    case "sessions.withdrawQueuedPrompts": {
      const params = parseParams(request.params, parseQueuedPromptParams);

      return services.sessionService.withdrawQueuedPrompts(params.sessionId, params.queuedPromptId);
    }
    case "reviews.getRound": {
      const params = parseParams(request.params, parseRoundReviewParams);
      const review = await services.sessionService.getRoundReview(params.sessionId, params.round);

      if (!review) {
        throw new RpcApplicationError(404, "Round review not found");
      }

      return { review };
    }
    case "reviews.getRoundDiffFilePage": {
      const params = parseObject(request.params);
      const routeParams = parseParams(params, parseRoundDiffFileParams);
      const query = parseParams(params, parseDiffFilePageQuery);
      const page = await services.sessionService.getRoundDiffFilePage(
        routeParams.sessionId,
        routeParams.round,
        routeParams.fileId,
        query,
      );

      if (!page) {
        throw new RpcApplicationError(404, "Diff file not found");
      }

      return { page };
    }
    case "reviews.getAtomicDiffFilePage": {
      const params = parseObject(request.params);
      const routeParams = parseParams(params, parseAtomicDiffFileParams);
      const query = parseParams(params, parseDiffFilePageQuery);
      const page = await services.sessionService.getAtomicReviewItemDiffFilePage(
        routeParams.sessionId,
        routeParams.round,
        routeParams.itemId,
        routeParams.fileId,
        query,
      );

      if (!page) {
        throw new RpcApplicationError(404, "Atomic diff file not found");
      }

      return { page };
    }
    case "reviews.createRoundReviewRun": {
      const params = parseObject(request.params);
      const routeParams = parseParams(params, parseRoundReviewParams);
      const body = parseParams(params.request, parseCreateRoundReviewRunBody);

      return services.sessionService.createRoundReviewRun(
        routeParams.sessionId,
        routeParams.round,
        body,
      );
    }
    case "runs.cancel": {
      const { runId } = parseZod(RunIdParamsSchema, request.params);

      await services.sessionService.cancelRun(runId);
      return { status: "ok" };
    }
    case "runs.subscribe":
      return createRunSubscription(services, context, request.params);
    case "runs.unsubscribe": {
      const { subscriptionId } = parseZod(RunSubscriptionParamsSchema, request.params);
      const subscription = context.subscriptions.get(subscriptionId);

      if (subscription) {
        subscription.close();
        context.subscriptions.delete(subscriptionId);
      }

      return { status: "ok" };
    }
    case "code.workspacePathSuggestions": {
      const { path } = parseParams(request.params, parseWorkspacePathSuggestionsQuery);

      return { suggestions: await suggestWorkspacePaths(path) };
    }
    case "code.workspaceGitInfo":
      return services.codeQueryService.getWorkspaceGitInfo(
        parseParams(request.params, parseWorkspaceGitInfoQuery),
      );
    case "code.getRange":
      return services.codeQueryService.getCodeRange(
        parseParams(request.params, parseCodeRangeQuery),
      );
    case "code.getSourceDefinition":
      return services.sourceDefinitionService.findDefinition(
        parseParams(request.params, parseSourceDefinitionQuery),
      );
    default:
      throw new RpcProtocolError(-32601, `Method not found: ${request.method}`);
  }
}

async function createRunSubscription(
  services: Parameters<typeof attachRpcServer>[1],
  context: RpcContext,
  paramsInput: unknown,
): Promise<{ subscriptionId: string }> {
  const params = parseObject(paramsInput);
  const { runId } = parseZod(RunIdParamsSchema, params);
  const eventOptions = parseParams(params, parseRunEventsQuery);

  if (!(await services.sessionService.hasKnownRun(runId))) {
    throw new RpcApplicationError(404, "Run not found");
  }

  const subscriptionId = randomUUID();
  const visibleTraceTypes = eventOptions.traceMessageTypes
    ? new Set(eventOptions.traceMessageTypes)
    : undefined;
  let closed = false;
  let replaying = true;
  let lastSeq = 0;
  const liveBuffer: StoredRunStreamEvent[] = [];
  let unsubscribe = () => {};

  const close = () => {
    closed = true;
    unsubscribe();
  };
  const writeStoredEvent = (storedEvent: StoredRunStreamEvent): boolean => {
    if (closed || storedEvent.id <= lastSeq) {
      return true;
    }

    lastSeq = storedEvent.id;
    const event = filterRunStreamEvent(storedEvent.event, visibleTraceTypes);

    if (!event) {
      return true;
    }

    sendNotification(context.client, "run.event", {
      subscriptionId,
      runId,
      event,
    });

    if (
      event.type === "run.succeeded" ||
      event.type === "run.failed" ||
      event.type === "run.cancelled"
    ) {
      close();
      context.subscriptions.delete(subscriptionId);
      return false;
    }

    return true;
  };

  unsubscribe = services.sessionService.subscribeToRunEvents(runId, (event) => {
    if (replaying) {
      liveBuffer.push(event);
      return;
    }

    writeStoredEvent(event);
  });
  context.subscriptions.set(subscriptionId, { runId, unsubscribe, close });
  void replayRunSubscription(services, context, {
    runId,
    subscriptionId,
    visibleTraceTypes,
    isClosed: () => closed,
    setReplaying: (value) => {
      replaying = value;
    },
    getLastSeq: () => lastSeq,
    setLastSeq: (value) => {
      lastSeq = value;
    },
    liveBuffer,
    close,
  }).catch((error: unknown) => {
    close();
    context.subscriptions.delete(subscriptionId);
    sendNotification(context.client, "run.event", {
      subscriptionId,
      runId,
      event: {
        type: "run.failed",
        error: error instanceof Error ? error.message : "Run subscription failed",
      },
    });
  });

  return { subscriptionId };
}

async function replayRunSubscription(
  services: Parameters<typeof attachRpcServer>[1],
  context: RpcContext,
  input: {
    runId: string;
    subscriptionId: string;
    visibleTraceTypes: Set<TraceMessageType> | undefined;
    isClosed: () => boolean;
    setReplaying: (value: boolean) => void;
    getLastSeq: () => number;
    setLastSeq: (value: number) => void;
    liveBuffer: StoredRunStreamEvent[];
    close: () => void;
  },
): Promise<void> {
  const writeStoredEvent = (storedEvent: StoredRunStreamEvent): boolean => {
    const lastSeq = input.getLastSeq();

    if (input.isClosed() || storedEvent.id <= lastSeq) {
      return true;
    }

    input.setLastSeq(storedEvent.id);
    const event = filterRunStreamEvent(storedEvent.event, input.visibleTraceTypes);

    if (!event) {
      return true;
    }

    sendNotification(context.client, "run.event", {
      subscriptionId: input.subscriptionId,
      runId: input.runId,
      event,
    });

    if (
      event.type === "run.succeeded" ||
      event.type === "run.failed" ||
      event.type === "run.cancelled"
    ) {
      input.close();
      context.subscriptions.delete(input.subscriptionId);
      return false;
    }

    return true;
  };

  try {
    while (!input.isClosed()) {
      const events = await services.sessionService.listRunEvents(input.runId, {
        afterSeq: input.getLastSeq(),
        limit: 1000,
      });

      if (events.length === 0) {
        break;
      }

      for (const event of events) {
        if (!writeStoredEvent(event)) {
          return;
        }
      }
    }

    input.setReplaying(false);
    input.liveBuffer.sort((left, right) => left.id - right.id);
    for (const event of input.liveBuffer) {
      if (!writeStoredEvent(event)) {
        return;
      }
    }
  } catch (error) {
    input.close();
    context.subscriptions.delete(input.subscriptionId);
    throw error;
  }
}

function filterRunStreamEvent(
  event: RunStreamEvent,
  visibleTraceTypes: Set<TraceMessageType> | undefined,
): RunStreamEvent | undefined {
  if (!visibleTraceTypes) {
    return event;
  }

  if (event.type === "run.trace") {
    return isTraceEventVisible(event.event, visibleTraceTypes) ? event : undefined;
  }

  if (event.type === "session.updated" || event.type === "run.succeeded") {
    return {
      ...event,
      session: filterSessionViewTraceMessages(event.session, [...visibleTraceTypes]),
    };
  }

  return event;
}

function parseParams<T>(input: unknown, parser: (input: unknown) => ParsedBody<T>): T {
  const parsed = parser(input ?? {});

  if (parsed.ok) {
    return parsed.value;
  }

  throw new RpcProtocolError(-32602, parsed.error);
}

function parseObject(input: unknown): Record<string, unknown> {
  return parseZod(RpcParamsObjectSchema, input ?? {});
}

function parseZod<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const parsed = schema.safeParse(input);

  if (parsed.success) {
    return parsed.data;
  }

  throw new RpcProtocolError(-32602, parsed.error.issues[0]?.message ?? "Invalid params");
}

function sendResult(client: WebSocket, id: JsonRpcId, result: unknown) {
  send(client, {
    jsonrpc: jsonRpcVersion,
    id,
    result,
  });
}

function sendError(client: WebSocket, id: JsonRpcId, error: RpcError) {
  send(client, {
    jsonrpc: jsonRpcVersion,
    id,
    error,
  });
}

function sendNotification(client: WebSocket, method: string, params: unknown) {
  send(client, {
    jsonrpc: jsonRpcVersion,
    method,
    params,
  });
}

function send(client: WebSocket, message: unknown) {
  if (client.readyState !== client.OPEN) {
    return;
  }

  client.send(JSON.stringify(message));
}

function readRequestId(input: unknown): JsonRpcId {
  if (!input || typeof input !== "object" || !("id" in input)) {
    return null;
  }

  const id = (input as { id?: unknown }).id;

  return typeof id === "string" || typeof id === "number" || id === null ? id : null;
}

type RpcError = {
  code: number;
  message: string;
  data?: unknown;
};

class RpcProtocolError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = "RpcProtocolError";
  }
}

class RpcApplicationError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "RpcApplicationError";
  }
}

function toRpcError(error: unknown): RpcError {
  if (error instanceof RpcProtocolError) {
    return {
      code: error.code,
      message: error.message,
    };
  }

  const applicationError = toApplicationError(error);

  if (applicationError) {
    return {
      code: applicationError.status,
      message: applicationError.message,
      data: { status: applicationError.status },
    };
  }

  return {
    code: -32603,
    message: error instanceof Error ? error.message : "Internal server error",
  };
}

function toApplicationError(error: unknown): RpcApplicationError | undefined {
  if (error instanceof RpcApplicationError) {
    return error;
  }

  if (error instanceof SessionNotFoundError) {
    return new RpcApplicationError(404, "Session not found");
  }

  if (error instanceof RunNotFoundError) {
    return new RpcApplicationError(404, "Run not found");
  }

  if (error instanceof QueuedPromptNotFoundError) {
    return new RpcApplicationError(404, "Queued prompt not found");
  }

  if (error instanceof RoundReviewNotFoundError) {
    return new RpcApplicationError(404, "Round review not found");
  }

  if (error instanceof SessionBusyError) {
    return new RpcApplicationError(409, "Session already has a running run");
  }

  if (error instanceof InvalidPathError || error instanceof PathNotDirectoryError) {
    return new RpcApplicationError(400, error.message);
  }

  if (error instanceof PathNotFoundError) {
    return new RpcApplicationError(404, error.message);
  }

  if (error instanceof CodeFileNotFoundError) {
    return new RpcApplicationError(404, "Code file not found");
  }

  if (error instanceof CodePathNotFileError) {
    return new RpcApplicationError(400, "Code path is not a file");
  }

  if (error instanceof CodeFileTooLargeError) {
    return new RpcApplicationError(413, "Code file is too large to preview");
  }

  if (error instanceof CodeRangeTooLargeError) {
    return new RpcApplicationError(400, error.message);
  }

  if (error instanceof UnsupportedLanguageServerError) {
    return new RpcApplicationError(400, error.message);
  }

  if (error instanceof LanguageServerProcessError) {
    return new RpcApplicationError(503, error.message);
  }

  return undefined;
}
