import { basename, dirname, extname, join, resolve } from "node:path";
import { defaultJsonFileDb, type JsonFileDb } from "./JsonFileDb.js";
import {
  AtomicDiffReview,
  ChatMessage,
  ChatRound,
  ChatSession,
  ChatSessionIndexEntry,
  QueuedPrompt,
  QueuedPromptView,
  SessionListPage,
} from "../../types.js";

const STORE_VERSION = 3;

type StoredSession = Omit<ChatSession, "messages" | "rounds" | "queuedPrompts"> & {
  currentRound?: number;
};

type SessionIndexData = {
  version: typeof STORE_VERSION;
  sessions: StoredSession[];
};

type SessionDetailData = {
  version: typeof STORE_VERSION;
  id: string;
  messages: ChatMessage[];
  rounds: ChatRound[];
  queuedPrompts: QueuedPrompt[];
};

export type ListSessionIndexEntriesOptions = {
  page?: number;
  pageSize?: number;
};

export class JsonSessionStore {
  private readonly filePath: string;
  private readonly detailDirectoryPath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    filePath = process.env.CUI_STORE_PATH ?? "data/sessions.json",
    private readonly db: JsonFileDb = defaultJsonFileDb,
  ) {
    this.filePath = resolve(process.cwd(), filePath);
    this.detailDirectoryPath = join(
      dirname(this.filePath),
      basename(this.filePath, extname(this.filePath)),
    );
  }

  async listSessions(): Promise<ChatSession[]> {
    const index = await this.readIndex();
    const sessions = await Promise.all(
      index.sessions.map(async (session) =>
        hydrateSession(session, await this.readSessionDetail(session.id)),
      ),
    );

    return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async listSessionIndexEntries(
    options: ListSessionIndexEntriesOptions = {},
  ): Promise<SessionListPage<ChatSessionIndexEntry>> {
    const index = await this.readIndex();
    const sortedSessions = sortStoredSessions(index.sessions);
    const pagination = createPagination(sortedSessions.length, options);
    const pageSessions = sortedSessions.slice(
      (pagination.page - 1) * pagination.pageSize,
      pagination.page * pagination.pageSize,
    );
    const sessions = await Promise.all(
      pageSessions.map(async (session) => {
        const detail = await this.readSessionDetail(session.id);

        return {
          ...toSessionIndexEntry(session),
          currentRound: session.currentRound ?? getCurrentRoundFromSessionDetail(detail),
          ...toQueuedPromptViewsProperty(detail.queuedPrompts),
        };
      }),
    );

    return {
      sessions,
      pagination,
    };
  }

  async getSession(sessionId: string): Promise<ChatSession | undefined> {
    const index = await this.readIndex();
    const session = index.sessions.find((current) => current.id === sessionId);

    return session ? hydrateSession(session, await this.readSessionDetail(sessionId)) : undefined;
  }

  async createSession(session: ChatSession): Promise<ChatSession> {
    await this.enqueueWrite(async () => {
      const index = await this.readIndex();
      const nextIndex: SessionIndexData = {
        ...index,
        sessions: [
          toStoredSession(session),
          ...index.sessions.filter((current) => current.id !== session.id),
        ],
      };

      await this.writeSessionDetail(toSessionDetail(session));
      await this.writeIndex(nextIndex);
    });

    return session;
  }

  async appendMessages(sessionId: string, messages: ChatMessage[]): Promise<ChatSession> {
    let updatedSession: ChatSession | undefined;

    await this.enqueueWrite(async () => {
      const index = await this.readIndex();
      const storedSession = index.sessions.find((session) => session.id === sessionId);

      if (!storedSession) {
        return;
      }

      const detail = await this.readSessionDetail(sessionId);
      const sessions = index.sessions.map((session) => {
        if (session.id !== sessionId) {
          return session;
        }

        updatedSession = {
          ...hydrateSession(session, detail),
          updatedAt: new Date().toISOString(),
          doneAt: undefined,
          messages: [...detail.messages, ...messages],
        };

        return toStoredSession(updatedSession);
      });

      if (!updatedSession) {
        return;
      }

      await this.writeSessionDetail(toSessionDetail(updatedSession));
      await this.writeIndex({ ...index, sessions });
    });

    if (!updatedSession) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    return updatedSession;
  }

  async enqueuePrompt(sessionId: string, prompt: QueuedPrompt): Promise<ChatSession> {
    let updatedSession: ChatSession | undefined;

    await this.enqueueWrite(async () => {
      const index = await this.readIndex();
      const storedSession = index.sessions.find((session) => session.id === sessionId);

      if (!storedSession) {
        return;
      }

      const detail = await this.readSessionDetail(sessionId);
      const sessions = index.sessions.map((session) => {
        if (session.id !== sessionId) {
          return session;
        }

        updatedSession = {
          ...hydrateSession(session, detail),
          updatedAt: new Date().toISOString(),
          doneAt: undefined,
          queuedPrompts: [...detail.queuedPrompts, prompt],
        };

        return toStoredSession(updatedSession);
      });

      if (!updatedSession) {
        return;
      }

      await this.writeSessionDetail(toSessionDetail(updatedSession));
      await this.writeIndex({ ...index, sessions });
    });

    if (!updatedSession) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    return updatedSession;
  }

  async shiftQueuedPrompt(sessionId: string): Promise<QueuedPrompt | undefined> {
    let shiftedPrompt: QueuedPrompt | undefined;

    await this.enqueueWrite(async () => {
      const index = await this.readIndex();
      const storedSession = index.sessions.find((session) => session.id === sessionId);

      if (!storedSession) {
        return;
      }

      const detail = await this.readSessionDetail(sessionId);
      const [nextPrompt, ...remainingPrompts] = detail.queuedPrompts;

      if (!nextPrompt) {
        return;
      }

      shiftedPrompt = nextPrompt;
      await this.writeSessionDetail({
        ...detail,
        queuedPrompts: remainingPrompts,
      });
    });

    return shiftedPrompt;
  }

  async appendRoundAndMessages(
    sessionId: string,
    round: ChatRound | undefined,
    messages: ChatMessage[],
  ): Promise<ChatSession> {
    let updatedSession: ChatSession | undefined;

    await this.enqueueWrite(async () => {
      const index = await this.readIndex();
      const storedSession = index.sessions.find((session) => session.id === sessionId);

      if (!storedSession) {
        return;
      }

      const detail = await this.readSessionDetail(sessionId);
      const sessions = index.sessions.map((session) => {
        if (session.id !== sessionId) {
          return session;
        }

        const currentRounds = detail.rounds;
        const nextRounds = round ? [...currentRounds, round] : currentRounds;

        updatedSession = {
          ...hydrateSession(session, detail),
          updatedAt: new Date().toISOString(),
          doneAt: undefined,
          messages: [...detail.messages, ...messages],
          ...(nextRounds.length > 0 ? { rounds: nextRounds } : {}),
        };

        return toStoredSession(updatedSession);
      });

      if (!updatedSession) {
        return;
      }

      await this.writeSessionDetail(toSessionDetail(updatedSession));
      await this.writeIndex({ ...index, sessions });
    });

    if (!updatedSession) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    return updatedSession;
  }

  async updateSessionAiThreadId(sessionId: string, aiThreadId: string): Promise<ChatSession> {
    let updatedSession: ChatSession | undefined;

    await this.enqueueWrite(async () => {
      const index = await this.readIndex();
      let updatedStoredSession: StoredSession | undefined;
      const sessions = index.sessions.map((session) => {
        if (session.id !== sessionId) {
          return session;
        }

        updatedStoredSession = {
          ...session,
          aiThreadId,
        };

        return toStoredSession(updatedStoredSession);
      });

      if (!updatedStoredSession) {
        return;
      }

      await this.writeIndex({ ...index, sessions });
      updatedSession = hydrateSession(
        updatedStoredSession,
        await this.readSessionDetail(updatedStoredSession.id),
      );
    });

    if (!updatedSession) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    return updatedSession;
  }

  async getRound(sessionId: string, roundNumber: number): Promise<ChatRound | undefined> {
    const session = await this.getSession(sessionId);

    return session?.rounds?.find((round) => round.round === roundNumber);
  }

  async updateRoundAtomicReview(
    sessionId: string,
    roundNumber: number,
    atomicReview: AtomicDiffReview,
  ): Promise<ChatRound> {
    let updatedRound: ChatRound | undefined;

    await this.enqueueWrite(async () => {
      const index = await this.readIndex();
      const storedSession = index.sessions.find((session) => session.id === sessionId);

      if (!storedSession) {
        return;
      }

      const detail = await this.readSessionDetail(sessionId);
      const rounds = detail.rounds.map((round) => {
        if (round.round !== roundNumber) {
          return round;
        }

        updatedRound = {
          ...round,
          atomicReview,
        };

        return updatedRound;
      });

      if (!updatedRound) {
        return;
      }

      await this.writeSessionDetail({
        ...detail,
        rounds,
      });
    });

    if (!updatedRound) {
      throw new Error(`Round not found: ${sessionId}#${roundNumber}`);
    }

    return updatedRound;
  }

  async updateSessionSummary(
    sessionId: string,
    summary: Pick<ChatSession, "title" | "summary">,
  ): Promise<ChatSession> {
    let updatedSession: ChatSession | undefined;

    await this.enqueueWrite(async () => {
      const index = await this.readIndex();
      let updatedStoredSession: StoredSession | undefined;
      const sessions = index.sessions.map((session) => {
        if (session.id !== sessionId) {
          return session;
        }

        updatedStoredSession = {
          ...session,
          title: summary.title,
          summary: summary.summary,
        };

        return updatedStoredSession;
      });

      if (!updatedStoredSession) {
        return;
      }

      await this.writeIndex({ ...index, sessions });
      updatedSession = hydrateSession(
        updatedStoredSession,
        await this.readSessionDetail(updatedStoredSession.id),
      );
    });

    if (!updatedSession) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    return updatedSession;
  }

  async updateSessionDoneAt(sessionId: string, doneAt: string | undefined): Promise<ChatSession> {
    let updatedSession: ChatSession | undefined;

    await this.enqueueWrite(async () => {
      const index = await this.readIndex();
      let updatedStoredSession: StoredSession | undefined;
      const sessions = index.sessions.map((session) => {
        if (session.id !== sessionId) {
          return session;
        }

        updatedStoredSession = {
          ...session,
          doneAt,
        };

        return toStoredSession(updatedStoredSession);
      });

      if (!updatedStoredSession) {
        return;
      }

      await this.writeIndex({ ...index, sessions });
      updatedSession = hydrateSession(
        updatedStoredSession,
        await this.readSessionDetail(updatedStoredSession.id),
      );
    });

    if (!updatedSession) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    return updatedSession;
  }

  private async readIndex(): Promise<SessionIndexData> {
    try {
      return normalizeIndexData(await this.db.read<unknown>(this.filePath));
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return createEmptyIndexData();
      }

      throw error;
    }
  }

  private enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(operation);

    this.writeQueue = result.then(
      () => undefined,
      () => undefined,
    );

    return result;
  }

  private async readSessionDetail(sessionId: string): Promise<SessionDetailData> {
    return normalizeSessionDetail(
      await this.db.read<unknown>(this.getSessionDetailPath(sessionId)),
      sessionId,
    );
  }

  private async writeIndex(data: SessionIndexData): Promise<void> {
    await this.db.write(this.filePath, data);
  }

  private async writeSessionDetail(detail: SessionDetailData): Promise<void> {
    await this.db.write(this.getSessionDetailPath(detail.id), detail);
  }

  private getSessionDetailPath(sessionId: string): string {
    return join(this.detailDirectoryPath, `${encodeURIComponent(sessionId)}.json`);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function normalizeIndexData(data: unknown): SessionIndexData {
  const store = isRecord(data) ? data : {};

  if (store.version !== STORE_VERSION) {
    throw new Error(`Unsupported session store version: ${String(store.version)}`);
  }

  return {
    version: STORE_VERSION,
    sessions: parseArray<StoredSession>(store.sessions).map((session) => toStoredSession(session)),
  };
}

function normalizeSessionDetail(data: unknown, sessionId: string): SessionDetailData {
  const detail = isRecord(data) ? data : {};

  if (detail.version !== STORE_VERSION) {
    throw new Error(
      `Unsupported session detail version for ${sessionId}: ${String(detail.version)}`,
    );
  }

  if (detail.id !== sessionId) {
    throw new Error(`Session detail id mismatch: expected ${sessionId}`);
  }

  return {
    version: STORE_VERSION,
    id: sessionId,
    messages: parseArray<ChatMessage>(detail.messages),
    rounds: parseArray<ChatRound>(detail.rounds),
    queuedPrompts: parseArray<QueuedPrompt>(detail.queuedPrompts),
  };
}

function hydrateSession(session: StoredSession, detail: SessionDetailData): ChatSession {
  const { currentRound: _currentRound, ...sessionMetadata } = session;
  const rounds = detail.rounds;

  return {
    ...sessionMetadata,
    messages: detail.messages,
    ...(rounds.length > 0 ? { rounds } : {}),
    ...(detail.queuedPrompts.length > 0 ? { queuedPrompts: detail.queuedPrompts } : {}),
  };
}

function createEmptyIndexData(): SessionIndexData {
  return {
    version: STORE_VERSION,
    sessions: [],
  };
}

function toSessionDetail(session: ChatSession): SessionDetailData {
  return {
    version: STORE_VERSION,
    id: session.id,
    messages: session.messages,
    rounds: session.rounds ?? [],
    queuedPrompts: session.queuedPrompts ?? [],
  };
}

function toStoredSession(session: ChatSession | StoredSession): StoredSession {
  return {
    id: session.id,
    ...(session.origin ? { origin: session.origin } : {}),
    ...(session.aiThreadId ? { aiThreadId: session.aiThreadId } : {}),
    workspace: session.workspace,
    title: session.title,
    summary: session.summary,
    ...(session.doneAt ? { doneAt: session.doneAt } : {}),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    currentRound:
      ("currentRound" in session ? session.currentRound : undefined) ??
      ("messages" in session ? getCurrentRoundFromSession(session) : undefined),
  };
}

function toSessionIndexEntry(session: StoredSession): ChatSessionIndexEntry {
  return {
    id: session.id,
    ...(session.origin ? { origin: session.origin } : {}),
    workspace: session.workspace,
    title: session.title,
    summary: session.summary,
    ...(session.doneAt ? { doneAt: session.doneAt } : {}),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    currentRound: session.currentRound ?? 0,
  };
}

function toQueuedPromptViews(queuedPrompts: QueuedPrompt[]): QueuedPromptView[] | undefined {
  if (queuedPrompts.length === 0) {
    return undefined;
  }

  return queuedPrompts.map(({ id, mode, prompt, createdAt }) => ({
    id,
    mode,
    prompt,
    createdAt,
  }));
}

function toQueuedPromptViewsProperty(
  queuedPrompts: QueuedPrompt[],
): Pick<ChatSessionIndexEntry, "queuedPrompts"> | Record<string, never> {
  const queuedPromptViews = toQueuedPromptViews(queuedPrompts);

  return queuedPromptViews ? { queuedPrompts: queuedPromptViews } : {};
}

function sortStoredSessions(sessions: StoredSession[]): StoredSession[] {
  return [...sessions].sort((left, right) => compareSessionsByUpdatedAt(left, right));
}

function compareSessionsByUpdatedAt(
  left: Pick<ChatSession, "id" | "updatedAt">,
  right: Pick<ChatSession, "id" | "updatedAt">,
): number {
  const updatedAtOrder = right.updatedAt.localeCompare(left.updatedAt);

  return updatedAtOrder !== 0 ? updatedAtOrder : right.id.localeCompare(left.id);
}

function createPagination(
  total: number,
  options: ListSessionIndexEntriesOptions,
): SessionListPage<unknown>["pagination"] {
  const pageSize = normalizePositiveInteger(options.pageSize, 30);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const requestedPage = normalizePositiveInteger(options.page, 1);
  const page = Math.min(requestedPage, totalPages);

  return {
    page,
    pageSize,
    total,
    totalPages,
    hasPreviousPage: page > 1,
    hasNextPage: page < totalPages,
  };
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isInteger(value) && value > 0 ? value : fallback;
}

function getCurrentRoundFromSession(session: ChatSession): number {
  return getCurrentRoundFromParts(session.messages, session.rounds ?? []);
}

function getCurrentRoundFromSessionDetail(detail: SessionDetailData): number {
  return getCurrentRoundFromParts(detail.messages, detail.rounds);
}

function getCurrentRoundFromParts(messages: ChatMessage[], rounds: ChatRound[]): number {
  const storedRound = Math.max(0, ...rounds.map(({ round }) => round));
  const messageRound = Math.max(
    0,
    ...messages
      .map(({ round }) => round ?? 0)
      .filter((round) => Number.isInteger(round) && round > 0),
  );
  const completedTurnCount = Math.max(
    countAssistantMessages(messages, "trace"),
    countAssistantMessages(messages, "response"),
  );

  return Math.max(storedRound, messageRound, completedTurnCount);
}

function countAssistantMessages(messages: ChatMessage[], kind: "response" | "trace"): number {
  return messages.filter((message) => message.role === "assistant" && message.kind === kind).length;
}

function parseArray<T>(value: unknown, fallback: T[] = []): T[] {
  return Array.isArray(value) ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
