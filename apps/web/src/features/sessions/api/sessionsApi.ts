import { rpcRequest } from "../../../shared/api/rpcClient";
import type {
  AiModelPreferences,
  ApiSession,
  ApiSessionListItem,
  SubmittedRun,
} from "../../../types";
import type { ExecutionTraceMessageType } from "../../config/model/appConfig";

export type SessionListPage = {
  sessions: ApiSessionListItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasPreviousPage: boolean;
    hasNextPage: boolean;
  };
};

export type CreateSessionInput = {
  workspace: string;
  origin?: "chat" | "shell";
  title?: string;
  models?: AiModelPreferences;
};

export type CreateRunInput =
  | {
      type: "assistant_response";
      input: {
        prompt: string;
      };
      models?: AiModelPreferences;
    }
  | {
      type: "shell_command";
      input: {
        command: string;
      };
    };

export type UpdateSessionInput = {
  done?: boolean;
  models?: AiModelPreferences;
};

export type SessionMessagesPage = {
  messages: ApiSession["messages"];
  pageInfo: NonNullable<ApiSession["messagePageInfo"]>;
};

export type GetSessionOptions = {
  messageWindow?: "tail";
  messageLimit?: number;
  traceMessageTypes?: ExecutionTraceMessageType[];
};

export type GetSessionMessagesOptions = {
  beforeMessageId?: string;
  limit?: number;
  traceMessageTypes?: ExecutionTraceMessageType[];
};

type SessionResponse = {
  session: ApiSession;
};

type WithdrawQueuedPromptsResponse = {
  session: ApiSession;
  queuedPrompts: NonNullable<ApiSession["queuedPrompts"]>;
};

export async function listSessions(page = 1, pageSize = 30): Promise<SessionListPage> {
  return rpcRequest<SessionListPage>("sessions.list", {
    page,
    pageSize,
  });
}

export async function getSession(
  sessionId: string,
  options: GetSessionOptions = {},
): Promise<ApiSession> {
  const data = await rpcRequest<SessionResponse>("sessions.get", {
    sessionId,
    ...options,
  });

  return data.session;
}

export async function getSessionMessages(
  sessionId: string,
  options: GetSessionMessagesOptions = {},
): Promise<SessionMessagesPage> {
  return rpcRequest<SessionMessagesPage>("sessions.messages", {
    sessionId,
    ...options,
  });
}

export async function createSession(input: CreateSessionInput): Promise<ApiSession> {
  const data = await rpcRequest<SessionResponse>("sessions.create", input);

  return data.session;
}

export async function createRun(sessionId: string, input: CreateRunInput): Promise<SubmittedRun> {
  return rpcRequest<SubmittedRun>("sessions.createRun", {
    sessionId,
    request: input,
  });
}

export async function updateSession(
  sessionId: string,
  input: UpdateSessionInput,
): Promise<ApiSession> {
  const data = await rpcRequest<SessionResponse>("sessions.update", {
    sessionId,
    ...input,
  });

  return data.session;
}

export async function withdrawQueuedPrompts(
  sessionId: string,
  queuedPromptId: string,
): Promise<WithdrawQueuedPromptsResponse> {
  return rpcRequest<WithdrawQueuedPromptsResponse>("sessions.withdrawQueuedPrompts", {
    sessionId,
    queuedPromptId,
  });
}

export async function cancelRun(runId: string): Promise<void> {
  await rpcRequest("runs.cancel", { runId });
}
