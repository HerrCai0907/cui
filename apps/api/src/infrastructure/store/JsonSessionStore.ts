import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { AtomicDiffReview, ChatMessage, ChatRound, ChatSession } from "../../types.js";

const STORE_VERSION = 2;

type StoredSession = Omit<ChatSession, "messages" | "rounds">;

type SessionStoreData = {
  version: typeof STORE_VERSION;
  sessions: StoredSession[];
  messagesBySessionId: Record<string, ChatMessage[]>;
  roundsBySessionId: Record<string, ChatRound[]>;
};

export class JsonSessionStore {
  private readonly filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(filePath = process.env.CUI_STORE_PATH ?? "data/sessions.json") {
    this.filePath = resolve(process.cwd(), filePath);
  }

  async listSessions(): Promise<ChatSession[]> {
    const data = await this.readData();

    return hydrateSessions(data).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getSession(sessionId: string): Promise<ChatSession | undefined> {
    const data = await this.readData();
    const session = data.sessions.find((current) => current.id === sessionId);

    return session ? hydrateSession(data, session) : undefined;
  }

  async createSession(session: ChatSession): Promise<ChatSession> {
    await this.updateData((data) => ({
      ...data,
      sessions: [
        toStoredSession(session),
        ...data.sessions.filter((current) => current.id !== session.id),
      ],
      messagesBySessionId: {
        ...data.messagesBySessionId,
        [session.id]: session.messages,
      },
      roundsBySessionId: {
        ...data.roundsBySessionId,
        [session.id]: session.rounds ?? [],
      },
    }));

    return session;
  }

  async appendMessages(sessionId: string, messages: ChatMessage[]): Promise<ChatSession> {
    let updatedSession: ChatSession | undefined;

    await this.updateData((data) => {
      const sessions = data.sessions.map((session) => {
        if (session.id !== sessionId) {
          return session;
        }

        updatedSession = {
          ...hydrateSession(data, session),
          updatedAt: new Date().toISOString(),
          doneAt: undefined,
          messages: [...(data.messagesBySessionId[sessionId] ?? []), ...messages],
        };

        return toStoredSession(updatedSession);
      });

      return {
        ...data,
        sessions,
        ...(updatedSession
          ? {
              messagesBySessionId: {
                ...data.messagesBySessionId,
                [sessionId]: updatedSession.messages,
              },
            }
          : {}),
      };
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

    await this.updateData((data) => {
      const sessions = data.sessions.map((session) => {
        if (session.id !== sessionId) {
          return session;
        }

        const currentRounds = data.roundsBySessionId[sessionId] ?? [];
        const nextRounds = round ? [...currentRounds, round] : currentRounds;

        updatedSession = {
          ...hydrateSession(data, session),
          updatedAt: new Date().toISOString(),
          doneAt: undefined,
          messages: [...(data.messagesBySessionId[sessionId] ?? []), ...messages],
          ...(nextRounds.length > 0 ? { rounds: nextRounds } : {}),
        };

        return toStoredSession(updatedSession);
      });

      return {
        ...data,
        sessions,
        ...(updatedSession
          ? {
              messagesBySessionId: {
                ...data.messagesBySessionId,
                [sessionId]: updatedSession.messages,
              },
              roundsBySessionId: {
                ...data.roundsBySessionId,
                [sessionId]: updatedSession.rounds ?? [],
              },
            }
          : {}),
      };
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

    await this.updateData((data) => {
      const rounds = (data.roundsBySessionId[sessionId] ?? []).map((round) => {
        if (round.round !== roundNumber) {
          return round;
        }

        updatedRound = {
          ...round,
          atomicReview,
        };

        return updatedRound;
      });

      return updatedRound
        ? {
            ...data,
            roundsBySessionId: {
              ...data.roundsBySessionId,
              [sessionId]: rounds,
            },
          }
        : data;
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

    await this.updateData((data) => {
      const sessions = data.sessions.map((session) => {
        if (session.id !== sessionId) {
          return session;
        }

        updatedSession = {
          ...hydrateSession(data, session),
          title: summary.title,
          summary: summary.summary,
        };

        return toStoredSession(updatedSession);
      });

      return { ...data, sessions };
    });

    if (!updatedSession) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    return updatedSession;
  }

  async updateSessionDoneAt(sessionId: string, doneAt: string | undefined): Promise<ChatSession> {
    let updatedSession: ChatSession | undefined;

    await this.updateData((data) => {
      const sessions = data.sessions.map((session) => {
        if (session.id !== sessionId) {
          return session;
        }

        updatedSession = {
          ...hydrateSession(data, session),
          doneAt,
        };

        return toStoredSession(updatedSession);
      });

      return { ...data, sessions };
    });

    if (!updatedSession) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    return updatedSession;
  }

  private async readData(): Promise<SessionStoreData> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;

      return normalizeStoreData(parsed);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return createEmptyStoreData();
      }

      throw error;
    }
  }

  private async updateData(updater: (data: SessionStoreData) => SessionStoreData): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      const current = await this.readData();
      const next = updater(current);

      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(this.filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    });

    return this.writeQueue;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function createEmptyStoreData(): SessionStoreData {
  return {
    version: STORE_VERSION,
    sessions: [],
    messagesBySessionId: {},
    roundsBySessionId: {},
  };
}

function normalizeStoreData(data: unknown): SessionStoreData {
  const store = isRecord(data) ? data : {};
  const sessions = parseArray<ChatSession | StoredSession>(store.sessions);

  if (store.version === STORE_VERSION) {
    const messagesBySessionId = isRecord(store.messagesBySessionId)
      ? store.messagesBySessionId
      : {};
    const roundsBySessionId = isRecord(store.roundsBySessionId) ? store.roundsBySessionId : {};

    return {
      version: STORE_VERSION,
      sessions: sessions.map((session) => toStoredSession(session)),
      messagesBySessionId: Object.fromEntries(
        sessions.map((session) => [
          session.id,
          parseArray<ChatMessage>(
            messagesBySessionId[session.id],
            "messages" in session ? session.messages : [],
          ),
        ]),
      ),
      roundsBySessionId: Object.fromEntries(
        sessions.map((session) => [
          session.id,
          parseArray<ChatRound>(
            roundsBySessionId[session.id],
            "rounds" in session ? session.rounds : [],
          ),
        ]),
      ),
    };
  }

  return {
    version: STORE_VERSION,
    sessions: sessions.map((session) => toStoredSession(session)),
    messagesBySessionId: Object.fromEntries(
      sessions.map((session) => [
        session.id,
        parseArray<ChatMessage>("messages" in session ? session.messages : []),
      ]),
    ),
    roundsBySessionId: Object.fromEntries(
      sessions.map((session) => [
        session.id,
        parseArray<ChatRound>("rounds" in session ? session.rounds : []),
      ]),
    ),
  };
}

function hydrateSessions(data: SessionStoreData): ChatSession[] {
  return data.sessions.map((session) => hydrateSession(data, session));
}

function hydrateSession(data: SessionStoreData, session: StoredSession): ChatSession {
  const rounds = data.roundsBySessionId[session.id] ?? [];

  return {
    ...session,
    messages: data.messagesBySessionId[session.id] ?? [],
    ...(rounds.length > 0 ? { rounds } : {}),
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
