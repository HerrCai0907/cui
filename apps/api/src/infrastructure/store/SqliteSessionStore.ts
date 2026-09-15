import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AiHarness,
  AtomicDiffReview,
  ChatMessage,
  ChatRound,
  ChatSession,
  ChatSessionIndexEntry,
  QueuedPrompt,
  QueuedPromptView,
  RoundDiffSummary,
  SessionListPage,
} from "../../types.js";
import type { ListSessionIndexEntriesOptions, SessionStore } from "./SessionStore.js";

type SqliteDatabase = Database.Database;

type SessionRow = {
  id: string;
  origin: string | null;
  ai_thread_id: string | null;
  ai_harness: string | null;
  workspace: string;
  title: string;
  summary: string | null;
  pinned: 0 | 1;
  done_at: string | null;
  created_at: string;
  updated_at: string;
  current_round: number | null;
  queued_prompt_count: number;
};

type MessageRow = {
  id: string;
  role: ChatMessage["role"];
  kind: ChatMessage["kind"] | null;
  round: number | null;
  content: string;
  created_at: string;
};

type RoundRow = {
  round: number;
  base_commit: string | null;
  diff: string;
  diff_summary_json: string | null;
  has_changes: 0 | 1;
  created_at: string;
  atomic_review_json: string | null;
};

type QueuedPromptRow = {
  id: string;
  mode: QueuedPrompt["mode"];
  prompt: string;
  models_json: string | null;
  created_at: string;
};

export class SqliteSessionStore implements SessionStore {
  private readonly databasePath: string;
  private readonly db: SqliteDatabase;

  constructor(databasePath?: string) {
    this.databasePath = resolve(
      process.cwd(),
      databasePath ?? process.env.CUI_DATABASE_PATH ?? "data/cui.sqlite",
    );
    mkdirSync(dirname(this.databasePath), { recursive: true });
    this.db = new Database(this.databasePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    runMigrations(this.db);
  }

  async listSessions(): Promise<ChatSession[]> {
    return this.listSessionRows().map((session) => this.hydrateSession(session));
  }

  async listQueuedSessionIds(): Promise<string[]> {
    return this.db
      .prepare("SELECT id FROM sessions WHERE queued_prompt_count > 0")
      .all()
      .map((row) => (row as Pick<SessionRow, "id">).id);
  }

  async hasQueuedPrompt(queuedPromptId: string): Promise<boolean> {
    return (
      this.db.prepare("SELECT 1 FROM queued_prompts WHERE id = ? LIMIT 1").get(queuedPromptId) !==
      undefined
    );
  }

  async listSessionIndexEntries(
    options: ListSessionIndexEntriesOptions = {},
  ): Promise<SessionListPage<ChatSessionIndexEntry>> {
    const sortedSessions = this.listSessionRows();
    const pagination = createPagination(sortedSessions.length, options);
    const pagedSessions = sortedSessions.slice(
      (pagination.page - 1) * pagination.pageSize,
      pagination.page * pagination.pageSize,
    );
    const pinnedSessions =
      pagination.page === 1 ? sortedSessions.filter((session) => Boolean(session.pinned)) : [];
    const pageSessions = uniqueSessionRowsById([...pinnedSessions, ...pagedSessions]);

    return {
      sessions: pageSessions.map((session) => ({
        ...toSessionIndexEntry(session),
        ...toQueuedPromptViewsProperty(this.listQueuedPrompts(session.id)),
      })),
      pagination,
    };
  }

  async getSession(sessionId: string): Promise<ChatSession | undefined> {
    return this.getSessionSync(sessionId);
  }

  async createSession(session: ChatSession): Promise<ChatSession> {
    this.db.transaction(() => this.replaceSession(session))();

    return session;
  }

  async appendMessages(sessionId: string, messages: ChatMessage[]): Promise<ChatSession> {
    return this.updateExistingSession(sessionId, (session) => ({
      ...session,
      updatedAt: new Date().toISOString(),
      doneAt: undefined,
      messages: [...session.messages, ...messages],
    }));
  }

  async enqueuePrompt(sessionId: string, prompt: QueuedPrompt): Promise<ChatSession> {
    return this.updateExistingSession(sessionId, (session) => ({
      ...session,
      updatedAt: new Date().toISOString(),
      doneAt: undefined,
      queuedPrompts: [...(session.queuedPrompts ?? []), prompt],
    }));
  }

  async shiftQueuedPrompt(sessionId: string): Promise<QueuedPrompt | undefined> {
    let shiftedPrompt: QueuedPrompt | undefined;

    this.db.transaction(() => {
      const session = this.getSessionSync(sessionId);

      if (!session) {
        return;
      }

      const [nextPrompt, ...remainingPrompts] = session.queuedPrompts ?? [];

      if (!nextPrompt) {
        return;
      }

      shiftedPrompt = nextPrompt;
      this.replaceSession({ ...session, queuedPrompts: remainingPrompts });
    })();

    return shiftedPrompt;
  }

  async truncateQueuedPromptsFrom(
    sessionId: string,
    queuedPromptId: string,
  ): Promise<{ session: ChatSession; removedPrompts: QueuedPrompt[] } | undefined> {
    let result: { session: ChatSession; removedPrompts: QueuedPrompt[] } | undefined;

    this.db.transaction(() => {
      const session = this.getSessionSync(sessionId);

      if (!session) {
        return;
      }

      const queuedPrompts = session.queuedPrompts ?? [];
      const queuedPromptIndex = queuedPrompts.findIndex(
        (queuedPrompt) => queuedPrompt.id === queuedPromptId,
      );

      if (queuedPromptIndex === -1) {
        result = { session, removedPrompts: [] };
        return;
      }

      const updatedSession = {
        ...session,
        updatedAt: new Date().toISOString(),
        queuedPrompts: queuedPrompts.slice(0, queuedPromptIndex),
      };

      this.replaceSession(updatedSession);
      result = {
        session: updatedSession,
        removedPrompts: queuedPrompts.slice(queuedPromptIndex),
      };
    })();

    return result;
  }

  async appendRoundAndMessages(
    sessionId: string,
    round: ChatRound | undefined,
    messages: ChatMessage[],
  ): Promise<ChatSession> {
    return this.updateExistingSession(sessionId, (session) => {
      const nextRounds = round ? [...(session.rounds ?? []), round] : (session.rounds ?? []);

      return {
        ...session,
        updatedAt: new Date().toISOString(),
        doneAt: undefined,
        messages: [...session.messages, ...messages],
        ...(nextRounds.length > 0 ? { rounds: nextRounds } : { rounds: undefined }),
      };
    });
  }

  async updateSessionAiThreadId(
    sessionId: string,
    aiThreadId: string,
    aiHarness: ChatSession["aiHarness"],
  ): Promise<ChatSession> {
    return this.updateExistingSession(sessionId, (session) => ({
      ...session,
      aiThreadId,
      ...(aiHarness ? { aiHarness } : {}),
    }));
  }

  async getRound(sessionId: string, roundNumber: number): Promise<ChatRound | undefined> {
    return this.getRoundSync(sessionId, roundNumber);
  }

  async updateRoundAtomicReview(
    sessionId: string,
    roundNumber: number,
    atomicReview: AtomicDiffReview,
  ): Promise<ChatRound> {
    let updatedRound: ChatRound | undefined;

    this.db.transaction(() => {
      const round = this.getRoundSync(sessionId, roundNumber);

      if (!round) {
        return;
      }

      updatedRound = { ...round, atomicReview };
      this.upsertRound(sessionId, updatedRound);
    })();

    if (!updatedRound) {
      throw new Error(`Round not found: ${sessionId}#${roundNumber}`);
    }

    return updatedRound;
  }

  async updateSessionSummary(
    sessionId: string,
    summary: Pick<ChatSession, "title" | "summary">,
  ): Promise<ChatSession> {
    return this.updateExistingSession(sessionId, (session) => ({
      ...session,
      title: summary.title,
      summary: summary.summary,
    }));
  }

  async updateSessionDoneAt(sessionId: string, doneAt: string | undefined): Promise<ChatSession> {
    return this.updateExistingSession(sessionId, (session) => ({ ...session, doneAt }));
  }

  async updateSessionPinned(sessionId: string, pinned: boolean): Promise<ChatSession> {
    return this.updateExistingSession(sessionId, (session) => ({ ...session, pinned }));
  }

  getArtifactDirectoryPath(): string {
    return join(dirname(this.databasePath), "session-artifacts");
  }

  close(): void {
    this.db.close();
  }

  private updateExistingSession(
    sessionId: string,
    update: (session: ChatSession) => ChatSession,
  ): ChatSession {
    let updatedSession: ChatSession | undefined;

    this.db.transaction(() => {
      const session = this.getSessionSync(sessionId);

      if (!session) {
        return;
      }

      updatedSession = update(session);
      this.replaceSession(updatedSession);
    })();

    if (!updatedSession) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    return updatedSession;
  }

  private getSessionSync(sessionId: string): ChatSession | undefined {
    const session = this.getSessionRow(sessionId);

    return session ? this.hydrateSession(session) : undefined;
  }

  private listSessionRows(): SessionRow[] {
    return this.db
      .prepare("SELECT * FROM sessions ORDER BY updated_at DESC, id DESC")
      .all() as SessionRow[];
  }

  private getSessionRow(sessionId: string): SessionRow | undefined {
    return this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as
      SessionRow | undefined;
  }

  private hydrateSession(session: SessionRow): ChatSession {
    const rounds = this.listRounds(session.id);
    const queuedPrompts = this.listQueuedPrompts(session.id);

    return {
      id: session.id,
      ...(session.origin ? { origin: toSessionOrigin(session.origin) } : {}),
      ...(session.ai_thread_id ? { aiThreadId: session.ai_thread_id } : {}),
      ...(session.ai_harness ? { aiHarness: toAiHarness(session.ai_harness) } : {}),
      workspace: session.workspace,
      title: session.title,
      summary: session.summary ?? undefined,
      ...(session.pinned ? { pinned: true } : {}),
      ...(session.done_at ? { doneAt: session.done_at } : {}),
      createdAt: session.created_at,
      updatedAt: session.updated_at,
      messages: this.listMessages(session.id),
      ...(rounds.length > 0 ? { rounds } : {}),
      ...(queuedPrompts.length > 0 ? { queuedPrompts } : {}),
    };
  }

  private listMessages(sessionId: string): ChatMessage[] {
    return (
      this.db
        .prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY order_index ASC")
        .all(sessionId) as MessageRow[]
    ).map(toChatMessage);
  }

  private listRounds(sessionId: string): ChatRound[] {
    return (
      this.db
        .prepare("SELECT * FROM rounds WHERE session_id = ? ORDER BY round ASC")
        .all(sessionId) as RoundRow[]
    ).map(toChatRound);
  }

  private listQueuedPrompts(sessionId: string): QueuedPrompt[] {
    return (
      this.db
        .prepare("SELECT * FROM queued_prompts WHERE session_id = ? ORDER BY order_index ASC")
        .all(sessionId) as QueuedPromptRow[]
    ).map(toQueuedPrompt);
  }

  private replaceSession(session: ChatSession): void {
    this.deleteSession(session.id);
    this.insertSession(session);
    this.insertSessionDetails(session);
  }

  private deleteSession(sessionId: string): void {
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
  }

  private insertSession(session: ChatSession): void {
    this.db
      .prepare(
        `INSERT INTO sessions (
          id, origin, ai_thread_id, ai_harness, workspace, title, summary, pinned, done_at,
          created_at, updated_at, current_round, queued_prompt_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        session.id,
        session.origin ?? null,
        session.aiThreadId ?? null,
        session.aiHarness ?? null,
        session.workspace,
        session.title,
        session.summary ?? null,
        session.pinned ? 1 : 0,
        session.doneAt ?? null,
        session.createdAt,
        session.updatedAt,
        getCurrentRoundFromSession(session),
        session.queuedPrompts?.length ?? 0,
      );
  }

  private insertSessionDetails(session: ChatSession): void {
    session.messages.forEach((message, index) => this.insertMessage(session.id, message, index));
    (session.rounds ?? []).forEach((round) => this.upsertRound(session.id, round));
    (session.queuedPrompts ?? []).forEach((prompt, index) =>
      this.insertQueuedPrompt(session.id, prompt, index),
    );
  }

  private insertMessage(sessionId: string, message: ChatMessage, orderIndex: number): void {
    this.db
      .prepare(
        `INSERT INTO messages (
          id, session_id, role, kind, round, content, created_at, order_index
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        message.id,
        sessionId,
        message.role,
        message.kind ?? null,
        message.round ?? null,
        message.content,
        message.createdAt,
        orderIndex,
      );
  }

  private upsertRound(sessionId: string, round: ChatRound): void {
    this.db
      .prepare(
        `INSERT INTO rounds (
          session_id, round, base_commit, diff, diff_summary_json, has_changes, created_at,
          atomic_review_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id, round) DO UPDATE SET
          base_commit = excluded.base_commit,
          diff = excluded.diff,
          diff_summary_json = excluded.diff_summary_json,
          has_changes = excluded.has_changes,
          created_at = excluded.created_at,
          atomic_review_json = excluded.atomic_review_json`,
      )
      .run(
        sessionId,
        round.round,
        round.baseCommit ?? null,
        round.diff,
        stringifyJsonField(round.diffSummary),
        round.hasChanges ? 1 : 0,
        round.createdAt,
        stringifyJsonField(round.atomicReview),
      );
  }

  private insertQueuedPrompt(sessionId: string, prompt: QueuedPrompt, orderIndex: number): void {
    this.db
      .prepare(
        `INSERT INTO queued_prompts (
          id, session_id, mode, prompt, models_json, created_at, order_index
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        prompt.id,
        sessionId,
        prompt.mode,
        prompt.prompt,
        stringifyJsonField(prompt.models),
        prompt.createdAt,
        orderIndex,
      );
  }

  private getRoundSync(sessionId: string, roundNumber: number): ChatRound | undefined {
    const row = this.db
      .prepare("SELECT * FROM rounds WHERE session_id = ? AND round = ?")
      .get(sessionId, roundNumber) as RoundRow | undefined;

    return row ? toChatRound(row) : undefined;
  }
}

function runMigrations(db: SqliteDatabase): void {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY)");

  const appliedVersions = new Set(
    db
      .prepare("SELECT version FROM schema_migrations")
      .all()
      .map((row) => (row as { version: string }).version),
  );

  for (const migration of getMigrations()) {
    if (appliedVersions.has(migration.version)) {
      continue;
    }

    db.transaction(() => {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations (version) VALUES (?)").run(migration.version);
    })();
  }
}

function getMigrations(): Array<{ version: string; sql: string }> {
  return [
    {
      version: "001_initial_schema",
      sql: readMigration("001_initial_schema.sql"),
    },
  ];
}

function readMigration(fileName: string): string {
  const localPath = join(dirname(fileURLToPath(import.meta.url)), "migrations", fileName);
  const sourcePath = resolve(
    process.cwd(),
    "apps/api/src/infrastructure/store/migrations",
    fileName,
  );
  const migrationPath = existsSync(localPath) ? localPath : sourcePath;

  return readFileSync(migrationPath, "utf8");
}

function toSessionIndexEntry(session: SessionRow): ChatSessionIndexEntry {
  return {
    id: session.id,
    ...(session.origin ? { origin: toSessionOrigin(session.origin) } : {}),
    workspace: session.workspace,
    title: session.title,
    summary: session.summary ?? undefined,
    ...(session.pinned ? { pinned: true } : {}),
    ...(session.done_at ? { doneAt: session.done_at } : {}),
    createdAt: session.created_at,
    updatedAt: session.updated_at,
    currentRound: session.current_round ?? 0,
  };
}

function toChatMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    role: row.role,
    ...(row.kind ? { kind: row.kind } : {}),
    ...(row.round !== null ? { round: row.round } : {}),
    content: row.content,
    createdAt: row.created_at,
  };
}

function toChatRound(row: RoundRow): ChatRound {
  return {
    round: row.round,
    ...(row.base_commit ? { baseCommit: row.base_commit } : {}),
    beforeDiff: "",
    afterDiff: "",
    diff: row.diff,
    ...(row.diff_summary_json
      ? { diffSummary: parseJsonField<RoundDiffSummary>(row.diff_summary_json) }
      : {}),
    hasChanges: Boolean(row.has_changes),
    createdAt: row.created_at,
    ...(row.atomic_review_json
      ? { atomicReview: parseJsonField<AtomicDiffReview>(row.atomic_review_json) }
      : {}),
  };
}

function toQueuedPrompt(row: QueuedPromptRow): QueuedPrompt {
  return {
    id: row.id,
    mode: row.mode,
    prompt: row.prompt,
    createdAt: row.created_at,
    ...(row.models_json ? { models: parseJsonField(row.models_json) } : {}),
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

function uniqueSessionRowsById(sessions: SessionRow[]): SessionRow[] {
  const seen = new Set<string>();

  return sessions.filter((session) => {
    if (seen.has(session.id)) {
      return false;
    }

    seen.add(session.id);

    return true;
  });
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
  const storedRound = Math.max(0, ...(session.rounds ?? []).map(({ round }) => round));
  const messageRound = Math.max(
    0,
    ...session.messages
      .map(({ round }) => round ?? 0)
      .filter((round) => Number.isInteger(round) && round > 0),
  );
  const completedTurnCount = Math.max(
    countAssistantMessages(session.messages, "trace"),
    countAssistantMessages(session.messages, "response"),
  );

  return Math.max(storedRound, messageRound, completedTurnCount);
}

function countAssistantMessages(messages: ChatMessage[], kind: "response" | "trace"): number {
  return messages.filter((message) => message.role === "assistant" && message.kind === kind).length;
}

function stringifyJsonField(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

function parseJsonField<T>(value: string): T {
  return JSON.parse(value) as T;
}

function toSessionOrigin(value: string): ChatSession["origin"] {
  return value === "shell" ? "shell" : "chat";
}

function toAiHarness(value: string): AiHarness | undefined {
  return value === "traex" || value === "codex" ? value : undefined;
}
