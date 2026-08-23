import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { AtomicDiffReview, ChatMessage, ChatRound, ChatSession } from "../../types.js";

type SessionStoreData = {
  sessions: ChatSession[];
};

export class JsonSessionStore {
  private readonly filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(filePath = process.env.CUI_STORE_PATH ?? "data/sessions.json") {
    this.filePath = resolve(process.cwd(), filePath);
  }

  async listSessions(): Promise<ChatSession[]> {
    const data = await this.readData();

    return data.sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getSession(sessionId: string): Promise<ChatSession | undefined> {
    const data = await this.readData();

    return data.sessions.find((session) => session.id === sessionId);
  }

  async createSession(session: ChatSession): Promise<ChatSession> {
    await this.updateData((data) => ({
      sessions: [session, ...data.sessions.filter((current) => current.id !== session.id)],
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
          ...session,
          updatedAt: new Date().toISOString(),
          messages: [...session.messages, ...messages],
        };

        return updatedSession;
      });

      return { sessions };
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

        updatedSession = {
          ...session,
          updatedAt: new Date().toISOString(),
          messages: [...session.messages, ...messages],
          ...(round ? { rounds: [...(session.rounds ?? []), round] } : {}),
        };

        return updatedSession;
      });

      return { sessions };
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
      const sessions = data.sessions.map((session) => {
        if (session.id !== sessionId) {
          return session;
        }

        const rounds = session.rounds?.map((round) => {
          if (round.round !== roundNumber) {
            return round;
          }

          updatedRound = {
            ...round,
            atomicReview,
          };

          return updatedRound;
        });

        return {
          ...session,
          ...(rounds ? { rounds } : {}),
        };
      });

      return { sessions };
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
          ...session,
          title: summary.title,
          summary: summary.summary,
        };

        return updatedSession;
      });

      return { sessions };
    });

    if (!updatedSession) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    return updatedSession;
  }

  private async readData(): Promise<SessionStoreData> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const data = JSON.parse(raw) as SessionStoreData;

      return {
        sessions: Array.isArray(data.sessions) ? data.sessions : [],
      };
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return { sessions: [] };
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
