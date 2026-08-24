import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { AtomicDiffReview, ChatMessage, ChatRound, ChatSession } from "../../types.js";

const STORE_VERSION = 3;

type StoredSession = Omit<ChatSession, "messages" | "rounds">;

type SessionIndexData = {
  version: typeof STORE_VERSION;
  sessions: StoredSession[];
};

type SessionDetailData = {
  version: typeof STORE_VERSION;
  id: string;
  messages: ChatMessage[];
  rounds: ChatRound[];
};

export class JsonSessionStore {
  private readonly filePath: string;
  private readonly detailDirectoryPath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(filePath = process.env.CUI_STORE_PATH ?? "data/sessions.json") {
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
      const raw = await readFile(this.filePath, "utf8");

      return normalizeIndexData(JSON.parse(raw) as unknown);
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
    const raw = await readFile(this.getSessionDetailPath(sessionId), "utf8");

    return normalizeSessionDetail(JSON.parse(raw) as unknown, sessionId);
  }

  private async writeIndex(data: SessionIndexData): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }

  private async writeSessionDetail(detail: SessionDetailData): Promise<void> {
    await mkdir(this.detailDirectoryPath, { recursive: true });
    await writeFile(
      this.getSessionDetailPath(detail.id),
      `${JSON.stringify(detail, null, 2)}\n`,
      "utf8",
    );
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
  };
}

function hydrateSession(session: StoredSession, detail: SessionDetailData): ChatSession {
  const rounds = detail.rounds;

  return {
    ...session,
    messages: detail.messages,
    ...(rounds.length > 0 ? { rounds } : {}),
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
  };
}

function toStoredSession(session: ChatSession | StoredSession): StoredSession {
  return {
    id: session.id,
    workspace: session.workspace,
    title: session.title,
    summary: session.summary,
    ...(session.doneAt ? { doneAt: session.doneAt } : {}),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

function parseArray<T>(value: unknown, fallback: T[] = []): T[] {
  return Array.isArray(value) ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
