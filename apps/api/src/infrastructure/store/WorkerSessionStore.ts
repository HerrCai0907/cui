import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import type {
  AtomicDiffReview,
  ChatMessage,
  ChatRound,
  ChatSession,
  ChatSessionIndexEntry,
  QueuedPrompt,
  SessionListPage,
} from "../../types.js";
import type { ListSessionIndexEntriesOptions, SessionStore } from "./SessionStore.js";

type StoreWorkerRequest = {
  id: number;
  method: SessionStoreMethod;
  args: unknown[];
};

type StoreWorkerResponse =
  | {
      id: number;
      ok: true;
      value: unknown;
    }
  | {
      id: number;
      ok: false;
      error: {
        name?: string;
        message: string;
        stack?: string;
      };
    };

type RemoteErrorPayload = Extract<StoreWorkerResponse, { ok: false }>["error"];

type SessionStoreMethod =
  | "listSessions"
  | "listQueuedSessionIds"
  | "hasQueuedPrompt"
  | "listSessionIndexEntries"
  | "getSession"
  | "createSession"
  | "appendMessages"
  | "enqueuePrompt"
  | "shiftQueuedPrompt"
  | "truncateQueuedPromptsFrom"
  | "appendRoundAndMessages"
  | "updateSessionAiThreadId"
  | "getRound"
  | "updateRoundAtomicReview"
  | "updateSessionSummary"
  | "updateSessionDoneAt"
  | "updateSessionPinned";

type PendingCall = {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};

export class WorkerSessionStore implements SessionStore {
  private readonly databasePath: string;
  private readonly worker: Worker;
  private readonly pendingCalls = new Map<number, PendingCall>();
  private nextRequestId = 1;
  private closed = false;

  constructor(databasePath?: string) {
    this.databasePath = resolve(
      process.cwd(),
      databasePath ?? process.env.CUI_DATABASE_PATH ?? "data/cui.sqlite",
    );
    this.worker = new Worker(resolveWorkerPath(), {
      workerData: {
        databasePath: this.databasePath,
      },
    });
    this.worker.on("message", (response: StoreWorkerResponse) => this.handleResponse(response));
    this.worker.on("error", (error) => this.rejectPendingCalls(error));
    this.worker.on("exit", (code) => {
      if (this.closed || code === 0) {
        this.rejectPendingCalls(new Error("Session store worker closed"));
        return;
      }

      this.rejectPendingCalls(new Error(`Session store worker exited with code ${code}`));
    });
  }

  listSessions(): Promise<ChatSession[]> {
    return this.call("listSessions");
  }

  listQueuedSessionIds(): Promise<string[]> {
    return this.call("listQueuedSessionIds");
  }

  hasQueuedPrompt(queuedPromptId: string): Promise<boolean> {
    return this.call("hasQueuedPrompt", queuedPromptId);
  }

  listSessionIndexEntries(
    options?: ListSessionIndexEntriesOptions,
  ): Promise<SessionListPage<ChatSessionIndexEntry>> {
    return this.call("listSessionIndexEntries", options);
  }

  getSession(sessionId: string): Promise<ChatSession | undefined> {
    return this.call("getSession", sessionId);
  }

  createSession(session: ChatSession): Promise<ChatSession> {
    return this.call("createSession", session);
  }

  appendMessages(sessionId: string, messages: ChatMessage[]): Promise<ChatSession> {
    return this.call("appendMessages", sessionId, messages);
  }

  enqueuePrompt(sessionId: string, prompt: QueuedPrompt): Promise<ChatSession> {
    return this.call("enqueuePrompt", sessionId, prompt);
  }

  shiftQueuedPrompt(sessionId: string): Promise<QueuedPrompt | undefined> {
    return this.call("shiftQueuedPrompt", sessionId);
  }

  truncateQueuedPromptsFrom(
    sessionId: string,
    queuedPromptId: string,
  ): Promise<{ session: ChatSession; removedPrompts: QueuedPrompt[] } | undefined> {
    return this.call("truncateQueuedPromptsFrom", sessionId, queuedPromptId);
  }

  appendRoundAndMessages(
    sessionId: string,
    round: ChatRound | undefined,
    messages: ChatMessage[],
  ): Promise<ChatSession> {
    return this.call("appendRoundAndMessages", sessionId, round, messages);
  }

  updateSessionAiThreadId(
    sessionId: string,
    aiThreadId: string,
    aiHarness: ChatSession["aiHarness"],
  ): Promise<ChatSession> {
    return this.call("updateSessionAiThreadId", sessionId, aiThreadId, aiHarness);
  }

  getRound(sessionId: string, roundNumber: number): Promise<ChatRound | undefined> {
    return this.call("getRound", sessionId, roundNumber);
  }

  updateRoundAtomicReview(
    sessionId: string,
    roundNumber: number,
    atomicReview: AtomicDiffReview,
  ): Promise<ChatRound> {
    return this.call("updateRoundAtomicReview", sessionId, roundNumber, atomicReview);
  }

  updateSessionSummary(
    sessionId: string,
    summary: Pick<ChatSession, "title" | "summary">,
  ): Promise<ChatSession> {
    return this.call("updateSessionSummary", sessionId, summary);
  }

  updateSessionDoneAt(sessionId: string, doneAt: string | undefined): Promise<ChatSession> {
    return this.call("updateSessionDoneAt", sessionId, doneAt);
  }

  updateSessionPinned(sessionId: string, pinned: boolean): Promise<ChatSession> {
    return this.call("updateSessionPinned", sessionId, pinned);
  }

  getArtifactDirectoryPath(): string {
    return resolve(dirname(this.databasePath), "session-artifacts");
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.worker.terminate().catch(() => undefined);
  }

  private call<T>(method: SessionStoreMethod, ...args: unknown[]): Promise<T> {
    if (this.closed) {
      return Promise.reject(new Error("Session store worker is closed"));
    }

    const id = this.nextRequestId;
    this.nextRequestId += 1;
    const request: StoreWorkerRequest = { id, method, args };

    return new Promise<T>((resolvePromise, reject) => {
      this.pendingCalls.set(id, {
        resolve: (value) => resolvePromise(value as T),
        reject,
      });
      this.worker.postMessage(request);
    });
  }

  private handleResponse(response: StoreWorkerResponse): void {
    const pendingCall = this.pendingCalls.get(response.id);

    if (!pendingCall) {
      return;
    }

    this.pendingCalls.delete(response.id);

    if (response.ok) {
      pendingCall.resolve(response.value);
      return;
    }

    pendingCall.reject(createRemoteError(response.error));
  }

  private rejectPendingCalls(error: Error): void {
    this.pendingCalls.forEach((pendingCall) => pendingCall.reject(error));
    this.pendingCalls.clear();
  }
}

function resolveWorkerPath(): URL {
  const currentPath = fileURLToPath(import.meta.url);
  const sourceWorkerPath = currentPath.replace(
    /WorkerSessionStore\.(?:ts|js)$/,
    "SqliteSessionStoreWorker.ts",
  );
  const compiledWorkerPath = currentPath.replace(
    /WorkerSessionStore\.(?:ts|js)$/,
    "SqliteSessionStoreWorker.js",
  );

  return pathToFileURL(existsSync(compiledWorkerPath) ? compiledWorkerPath : sourceWorkerPath);
}

function createRemoteError(error: RemoteErrorPayload): Error {
  const remoteError = new Error(error.message);

  remoteError.name = error.name ?? "Error";
  remoteError.stack = error.stack;

  return remoteError;
}
