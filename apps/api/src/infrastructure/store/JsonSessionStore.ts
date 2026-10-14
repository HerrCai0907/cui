import { readdir, rm } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { defaultJsonFileDb, type JsonFileDb } from "./JsonFileDb.js";
import {
  AiHarness,
  AtomicDiffReview,
  ChatMessage,
  ChatRound,
  ChatSession,
  ChatSessionIndexEntry,
  QueuedPrompt,
  QueuedPromptView,
  SessionListPage,
} from "../../types.js";
import type {
  ListRunEventsOptions,
  ListSessionIndexEntriesOptions,
  PersistedRunStreamEvent,
  SessionStore,
} from "./SessionStore.js";

const STORE_VERSION = 3;

type StoredSession = Omit<ChatSession, "messages" | "rounds" | "queuedPrompts"> & {
  currentRound?: number;
  queuedPromptCount?: number;
};

type StoredChatRound = Omit<ChatRound, "beforeDiff" | "afterDiff"> &
  Partial<Pick<ChatRound, "beforeDiff" | "afterDiff">>;

type SessionIndexData = {
  version: typeof STORE_VERSION;
  sessions: StoredSession[];
};

type SessionDetailData = {
  version: typeof STORE_VERSION;
  id: string;
  messages: ChatMessage[];
  rounds: StoredChatRound[];
  queuedPrompts: QueuedPrompt[];
};

type RunEventsData = {
  version: typeof STORE_VERSION;
  runId: string;
  events: PersistedRunStreamEvent[];
};

export class JsonSessionStore implements SessionStore {
  private readonly filePath: string;
  private readonly detailDirectoryPath: string;
  private readonly runEventDirectoryPath: string;
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
    this.runEventDirectoryPath = join(dirname(this.filePath), "run-events");
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

  async listQueuedSessionIds(): Promise<string[]> {
    const index = await this.readIndex();

    return index.sessions
      .filter((session) => (session.queuedPromptCount ?? 0) > 0)
      .map((session) => session.id);
  }

  async hasQueuedPrompt(queuedPromptId: string): Promise<boolean> {
    const index = await this.readIndex();

    for (const session of index.sessions) {
      if ((session.queuedPromptCount ?? 0) === 0) {
        continue;
      }

      const detail = await this.readSessionDetail(session.id);

      if (detail.queuedPrompts.some((queuedPrompt) => queuedPrompt.id === queuedPromptId)) {
        return true;
      }
    }

    return false;
  }

  async hasRunEvents(runId: string): Promise<boolean> {
    try {
      const data = await this.readRunEventsData(runId);

      return data.events.length > 0;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return false;
      }

      throw error;
    }
  }

  async appendRunEvents(events: PersistedRunStreamEvent[]): Promise<void> {
    if (events.length === 0) {
      return;
    }

    const eventsByRunId = new Map<string, PersistedRunStreamEvent[]>();

    events.forEach((event) => {
      const currentEvents = eventsByRunId.get(event.runId) ?? [];

      currentEvents.push(event);
      eventsByRunId.set(event.runId, currentEvents);
    });

    await this.enqueueWrite(async () => {
      for (const [runId, runEvents] of eventsByRunId) {
        const current = await this.readRunEventsDataOrEmpty(runId);
        const mergedEvents = new Map<number, PersistedRunStreamEvent>();

        current.events.forEach((event) => mergedEvents.set(event.id, event));
        runEvents.forEach((event) => mergedEvents.set(event.id, event));

        await this.writeRunEventsData({
          version: STORE_VERSION,
          runId,
          events: [...mergedEvents.values()].sort((left, right) => left.id - right.id),
        });
      }
    });
  }

  async listRunEvents(
    runId: string,
    options: ListRunEventsOptions = {},
  ): Promise<PersistedRunStreamEvent[]> {
    const afterSeq = normalizeNonNegativeInteger(options.afterSeq, 0);
    const limit = normalizePositiveInteger(options.limit, 1000);

    try {
      const data = await this.readRunEventsData(runId);

      return data.events.filter((event) => event.id > afterSeq).slice(0, limit);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }

      throw error;
    }
  }

  async listSessionIndexEntries(
    options: ListSessionIndexEntriesOptions = {},
  ): Promise<SessionListPage<ChatSessionIndexEntry>> {
    const index = await this.readIndex();
    const sortedSessions = sortStoredSessions(index.sessions);
    const pagination = createPagination(sortedSessions.length, options);
    const pagedSessions = sortedSessions.slice(
      (pagination.page - 1) * pagination.pageSize,
      pagination.page * pagination.pageSize,
    );
    const sessions = await Promise.all(
      pagedSessions.map(async (session) => {
        const detail =
          session.currentRound === undefined || (session.queuedPromptCount ?? 0) > 0
            ? await this.readSessionDetail(session.id)
            : undefined;

        return {
          ...toSessionIndexEntry(session),
          currentRound: session.currentRound ?? getCurrentRoundFromSessionDetail(detail),
          ...toQueuedPromptViewsProperty(detail?.queuedPrompts ?? []),
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
      const sessions = index.sessions.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              queuedPromptCount: remainingPrompts.length,
            }
          : session,
      );

      await this.writeSessionDetail({
        ...detail,
        queuedPrompts: remainingPrompts,
      });
      await this.writeIndex({ ...index, sessions });
    });

    return shiftedPrompt;
  }

  async truncateQueuedPromptsFrom(
    sessionId: string,
    queuedPromptId: string,
  ): Promise<{ session: ChatSession; removedPrompts: QueuedPrompt[] } | undefined> {
    let result: { session: ChatSession; removedPrompts: QueuedPrompt[] } | undefined;

    await this.enqueueWrite(async () => {
      const index = await this.readIndex();
      const storedSession = index.sessions.find((session) => session.id === sessionId);

      if (!storedSession) {
        return;
      }

      const detail = await this.readSessionDetail(sessionId);
      const queuedPromptIndex = detail.queuedPrompts.findIndex(
        (queuedPrompt) => queuedPrompt.id === queuedPromptId,
      );

      if (queuedPromptIndex === -1) {
        result = {
          session: hydrateSession(storedSession, detail),
          removedPrompts: [],
        };
        return;
      }

      const remainingPrompts = detail.queuedPrompts.slice(0, queuedPromptIndex);
      const removedPrompts = detail.queuedPrompts.slice(queuedPromptIndex);
      const updatedSession = {
        ...hydrateSession(storedSession, detail),
        updatedAt: new Date().toISOString(),
        queuedPrompts: remainingPrompts,
      };
      const sessions = index.sessions.map((session) =>
        session.id === sessionId ? toStoredSession(updatedSession) : session,
      );

      await this.writeSessionDetail(toSessionDetail(updatedSession));
      await this.writeIndex({ ...index, sessions });

      result = {
        session: updatedSession,
        removedPrompts,
      };
    });

    return result;
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

        const currentRounds = detail.rounds.map(hydrateRound);
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

  async updateSessionAiThreadId(
    sessionId: string,
    aiThreadId: string,
    aiHarness: ChatSession["aiHarness"],
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
          aiThreadId,
          ...(aiHarness ? { aiHarness } : {}),
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
          ...hydrateRound(round),
          atomicReview,
        };

        return toStoredRound(updatedRound);
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

  async updateSessionModels(
    sessionId: string,
    models: ChatSession["models"] | undefined,
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
          ...(models ? { models } : {}),
        };
        if (!models) {
          delete updatedStoredSession.models;
        }

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

  async deleteExpiredSessions(cutoffIso: string): Promise<number> {
    let deletedSessionIds: string[] = [];

    await this.enqueueWrite(async () => {
      const index = await this.readIndex();
      const [expiredSessions, retainedSessions] = partitionSessions(
        index.sessions,
        (session) => session.updatedAt < cutoffIso,
      );

      if (expiredSessions.length === 0) {
        return;
      }

      deletedSessionIds = expiredSessions.map((session) => session.id);
      await Promise.all(deletedSessionIds.map((sessionId) => this.deleteSessionFiles(sessionId)));
      await this.writeIndex({
        ...index,
        sessions: retainedSessions,
      });
    });

    return deletedSessionIds.length;
  }

  getArtifactDirectoryPath(): string {
    return join(dirname(this.filePath), "session-artifacts");
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
    await this.db.write(this.getSessionDetailPath(detail.id), compactSessionDetail(detail));
  }

  private async readRunEventsData(runId: string): Promise<RunEventsData> {
    return normalizeRunEventsData(await this.db.read<unknown>(this.getRunEventsPath(runId)), runId);
  }

  private async readRunEventsDataOrEmpty(runId: string): Promise<RunEventsData> {
    try {
      return await this.readRunEventsData(runId);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return {
          version: STORE_VERSION,
          runId,
          events: [],
        };
      }

      throw error;
    }
  }

  private async writeRunEventsData(data: RunEventsData): Promise<void> {
    await this.db.write(this.getRunEventsPath(data.runId), data);
  }

  private getSessionDetailPath(sessionId: string): string {
    return join(this.detailDirectoryPath, `${encodeURIComponent(sessionId)}.json`);
  }

  private getRunEventsPath(runId: string): string {
    return join(this.runEventDirectoryPath, `${encodeURIComponent(runId)}.json`);
  }

  private async deleteSessionFiles(sessionId: string): Promise<void> {
    const detailPath = this.getSessionDetailPath(sessionId);

    await Promise.all([
      rm(detailPath, { force: true }),
      this.deleteRunEventFilesForSession(sessionId),
      rm(join(this.getArtifactDirectoryPath(), encodeURIComponent(sessionId)), {
        force: true,
        recursive: true,
      }),
    ]);
    this.db.clearCache(detailPath);
  }

  private async deleteRunEventFilesForSession(sessionId: string): Promise<void> {
    let fileNames: string[];

    try {
      fileNames = await readdir(this.runEventDirectoryPath);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return;
      }

      throw error;
    }

    await Promise.all(
      fileNames.map(async (fileName) => {
        const filePath = join(this.runEventDirectoryPath, fileName);

        try {
          const data = normalizeRunEventsData(await this.db.read<unknown>(filePath));

          if (data.events.some((event) => event.sessionId === sessionId)) {
            await rm(filePath, { force: true });
            this.db.clearCache(filePath);
          }
        } catch {
          // A corrupt auxiliary run-events file should not block session expiry cleanup.
        }
      }),
    );
  }
}

function partitionSessions<T>(items: T[], predicate: (item: T) => boolean): [T[], T[]] {
  const matches: T[] = [];
  const misses: T[] = [];

  for (const item of items) {
    if (predicate(item)) {
      matches.push(item);
    } else {
      misses.push(item);
    }
  }

  return [matches, misses];
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
    rounds: parseArray<StoredChatRound>(detail.rounds),
    queuedPrompts: parseArray<QueuedPrompt>(detail.queuedPrompts),
  };
}

function normalizeRunEventsData(data: unknown, runId?: string): RunEventsData {
  const store = isRecord(data) ? data : {};

  if (store.version !== STORE_VERSION) {
    throw new Error(`Unsupported run event store version: ${String(store.version)}`);
  }

  if (runId !== undefined && store.runId !== runId) {
    throw new Error(`Run event id mismatch: expected ${runId}`);
  }

  const storedRunId = typeof store.runId === "string" ? store.runId : "";

  return {
    version: STORE_VERSION,
    runId: storedRunId,
    events: parseArray<PersistedRunStreamEvent>(store.events).filter(
      (event) => event.runId === storedRunId,
    ),
  };
}

function hydrateSession(session: StoredSession, detail: SessionDetailData): ChatSession {
  const {
    currentRound: _currentRound,
    queuedPromptCount: _queuedPromptCount,
    ...sessionMetadata
  } = session;
  const rounds = detail.rounds.map(hydrateRound);

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
    rounds: (session.rounds ?? []).map(toStoredRound),
    queuedPrompts: session.queuedPrompts ?? [],
  };
}

function compactSessionDetail(detail: SessionDetailData): SessionDetailData {
  return {
    ...detail,
    rounds: detail.rounds.map((round) => toStoredRound(hydrateRound(round))),
  };
}

function hydrateRound(round: StoredChatRound): ChatRound {
  return {
    beforeDiff: "",
    afterDiff: "",
    ...round,
  };
}

function toStoredRound(round: ChatRound): StoredChatRound {
  const { beforeDiff: _beforeDiff, afterDiff: _afterDiff, ...storedRound } = round;

  return storedRound;
}

function toStoredSession(session: ChatSession | StoredSession): StoredSession {
  return {
    id: session.id,
    ...(session.origin ? { origin: session.origin } : {}),
    ...(session.aiThreadId ? { aiThreadId: session.aiThreadId } : {}),
    ...(isAiHarness(session.aiHarness) ? { aiHarness: session.aiHarness } : {}),
    ...(session.models ? { models: session.models } : {}),
    workspace: session.workspace,
    title: session.title,
    summary: session.summary,
    ...(session.doneAt ? { doneAt: session.doneAt } : {}),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    currentRound:
      ("currentRound" in session ? session.currentRound : undefined) ??
      ("messages" in session ? getCurrentRoundFromSession(session) : undefined),
    queuedPromptCount:
      ("queuedPromptCount" in session ? session.queuedPromptCount : undefined) ??
      ("queuedPrompts" in session ? (session.queuedPrompts?.length ?? 0) : 0),
  };
}

function isAiHarness(value: unknown): value is AiHarness {
  return value === "traex" || value === "codex";
}

function toSessionIndexEntry(session: StoredSession): ChatSessionIndexEntry {
  return {
    id: session.id,
    ...(session.origin ? { origin: session.origin } : {}),
    ...(session.models ? { models: session.models } : {}),
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

function normalizeNonNegativeInteger(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function getCurrentRoundFromSession(session: ChatSession): number {
  return getCurrentRoundFromParts(session.messages, session.rounds ?? []);
}

function getCurrentRoundFromSessionDetail(detail: SessionDetailData | undefined): number {
  if (!detail) {
    return 0;
  }

  return getCurrentRoundFromParts(detail.messages, detail.rounds);
}

function getCurrentRoundFromParts(
  messages: ChatMessage[],
  rounds: Array<Pick<ChatRound, "round">>,
): number {
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
