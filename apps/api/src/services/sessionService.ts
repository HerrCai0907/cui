import { randomUUID } from 'node:crypto';
import {
  AiModel,
  AiResponse,
  AiRunEvent,
  AiRunResult,
  ChatMessage,
  ChatRound,
  ChatSession,
  ChatSessionView,
} from '../types.js';
import { GitDiffService } from '../diff/gitDiffService.js';
import { JsonSessionStore } from '../store/jsonSessionStore.js';
import { AppLogger } from '../logging/logger.js';

export type CreateSessionRequest = {
  workspace: string;
  prompt: string;
};

export type ContinueSessionRequest = {
  prompt: string;
};

export type SubmittedTurn = {
  session: ChatSessionView;
  turnId: string;
};

export type TurnStreamEvent =
  | {
      type: 'delta';
      text: string;
    }
  | {
      type: 'raw';
      event: unknown;
    }
  | {
      type: 'done';
      session: ChatSessionView;
    }
  | {
      type: 'failed';
      error: string;
    };

type StoredTurnStreamEvent = {
  id: number;
  event: TurnStreamEvent;
};

type RunningTurn = {
  id: string;
  sessionId: string;
  events: StoredTurnStreamEvent[];
  subscribers: Set<(event: StoredTurnStreamEvent) => void>;
  completed: boolean;
  nextEventId: number;
};

export class SessionService {
  private readonly runningTurns = new Map<string, RunningTurn>();
  private readonly activeSessionIds = new Set<string>();

  constructor(
    private readonly aiModel: AiModel,
    private readonly store: JsonSessionStore,
    private readonly logger = new AppLogger(),
    private readonly diffService = new GitDiffService(),
  ) {}

  async listSessions(): Promise<ChatSession[]> {
    return this.store.listSessions();
  }

  async listSessionViews(): Promise<ChatSessionView[]> {
    const sessions = await this.store.listSessions();

    return sessions.map(toSessionView);
  }

  async getSession(sessionId: string): Promise<ChatSession | undefined> {
    return this.store.getSession(sessionId);
  }

  async getSessionView(
    sessionId: string,
  ): Promise<ChatSessionView | undefined> {
    const session = await this.store.getSession(sessionId);

    return session ? toSessionView(session) : undefined;
  }

  async getRoundReview(
    sessionId: string,
    round: number,
  ): Promise<ChatRound | undefined> {
    const review = await this.store.getRound(sessionId, round);

    if (!review) {
      return undefined;
    }

    const diff = this.diffService.createRoundDiff(
      review.beforeDiff,
      review.afterDiff,
    );

    return {
      ...review,
      diff,
      hasChanges: this.diffService.hasChanges(diff),
    };
  }

  async createSession(request: CreateSessionRequest): Promise<ChatSession> {
    await this.logger.framework.info('session.create.started', {
      workspace: request.workspace,
      promptLength: request.prompt.length,
    });
    const aiResponse = await this.aiModel.createSession({
      workspace: request.workspace,
      prompt: request.prompt,
    });
    const sessionId = aiResponse.sessionId;
    const now = new Date().toISOString();
    const userMessage = createMessage('user', request.prompt);
    const round = this.createRound(aiResponse, 1);
    const assistantMessages = createAssistantMessages(aiResponse, round);
    const session: ChatSession = {
      id: sessionId,
      workspace: request.workspace,
      title: createTitle(request.prompt),
      summary: '',
      createdAt: now,
      updatedAt: now,
      messages: [userMessage, ...assistantMessages],
      ...(round ? { rounds: [round] } : {}),
    };

    await this.logger.session(sessionId).info('session.created', {
      sessionId,
      workspace: request.workspace,
      prompt: request.prompt,
      response: aiResponse.content,
      rawEvents: aiResponse.rawEvents,
    });
    await this.logger.framework.info('session.create.completed', {
      sessionId,
      workspace: request.workspace,
    });

    const createdSession = await this.store.createSession(session);

    return this.refreshSessionSummary(createdSession);
  }

  async beginCreateSession(
    request: CreateSessionRequest,
  ): Promise<SubmittedTurn> {
    await this.logger.framework.info('session.create.started', {
      workspace: request.workspace,
      promptLength: request.prompt.length,
    });
    const bufferedEvents: TurnStreamEvent[] = [];
    let runningTurn: RunningTurn | undefined;
    const run = this.aiModel.createSessionStream(request, (event) => {
      handleAiRunEvent(event, (streamEvent) => {
        if (runningTurn) {
          this.emitTurnEvent(runningTurn, streamEvent);
        } else {
          bufferedEvents.push(streamEvent);
        }
      });
    });
    const sessionId = await run.sessionId;

    if (this.activeSessionIds.has(sessionId)) {
      throw new SessionBusyError(sessionId);
    }

    const now = new Date().toISOString();
    const userMessage = createMessage('user', request.prompt);
    const session: ChatSession = {
      id: sessionId,
      workspace: request.workspace,
      title: createTitle(request.prompt),
      summary: '',
      createdAt: now,
      updatedAt: now,
      messages: [userMessage],
    };

    const createdSession = await this.store.createSession(session);
    runningTurn = this.createRunningTurn(sessionId);
    bufferedEvents.forEach((event) => this.emitTurnEvent(runningTurn!, event));
    this.finishCreateSession(request, run.result, runningTurn);

    return { session: toSessionView(createdSession), turnId: runningTurn.id };
  }

  async continueSession(
    sessionId: string,
    request: ContinueSessionRequest,
  ): Promise<ChatSession> {
    await this.logger.framework.info('session.continue.started', {
      sessionId,
      promptLength: request.prompt.length,
    });
    const session = await this.store.getSession(sessionId);

    if (!session) {
      await this.logger.framework.warn('session.continue.not_found', {
        sessionId,
      });
      throw new SessionNotFoundError(sessionId);
    }

    const aiResponse = await this.aiModel.continueSession({
      sessionId,
      workspace: session.workspace,
      prompt: request.prompt,
    });
    const userMessage = createMessage('user', request.prompt);
    const round = this.createNextRound(session, aiResponse);
    const assistantMessages = createAssistantMessages(aiResponse, round);

    await this.logger.session(sessionId).info('session.continued', {
      sessionId,
      workspace: session.workspace,
      prompt: request.prompt,
      response: aiResponse.content,
      rawEvents: aiResponse.rawEvents,
    });
    await this.logger.framework.info('session.continue.completed', {
      sessionId,
      workspace: session.workspace,
    });

    const updatedSession = await this.store.appendRoundAndMessages(
      sessionId,
      round,
      [userMessage, ...assistantMessages],
    );

    return this.refreshSessionSummary(updatedSession);
  }

  async beginContinueSession(
    sessionId: string,
    request: ContinueSessionRequest,
  ): Promise<SubmittedTurn> {
    await this.logger.framework.info('session.continue.started', {
      sessionId,
      promptLength: request.prompt.length,
    });
    const session = await this.store.getSession(sessionId);

    if (!session) {
      await this.logger.framework.warn('session.continue.not_found', {
        sessionId,
      });
      throw new SessionNotFoundError(sessionId);
    }

    if (this.activeSessionIds.has(sessionId)) {
      throw new SessionBusyError(sessionId);
    }

    const userMessage = createMessage('user', request.prompt);
    const updatedSession = await this.store.appendMessages(sessionId, [
      userMessage,
    ]);
    const runningTurn = this.createRunningTurn(sessionId);
    const run = this.aiModel.continueSessionStream(
      {
        sessionId,
        workspace: session.workspace,
        prompt: request.prompt,
      },
      (event) => {
        handleAiRunEvent(event, (streamEvent) =>
          this.emitTurnEvent(runningTurn, streamEvent),
        );
      },
    );

    this.finishContinueSession(
      request,
      run.result,
      runningTurn,
      session.workspace,
    );

    return { session: toSessionView(updatedSession), turnId: runningTurn.id };
  }

  hasRunningTurn(turnId: string): boolean {
    return this.runningTurns.has(turnId);
  }

  subscribeToTurn(
    turnId: string,
    onEvent: (event: TurnStreamEvent) => void,
  ): () => void {
    const turn = this.runningTurns.get(turnId);

    if (!turn) {
      return () => undefined;
    }

    const subscriber = (storedEvent: StoredTurnStreamEvent) =>
      onEvent(storedEvent.event);

    turn.events.forEach(subscriber);

    if (!turn.completed) {
      turn.subscribers.add(subscriber);
    }

    return () => {
      turn.subscribers.delete(subscriber);
    };
  }

  private createRunningTurn(sessionId: string): RunningTurn {
    const turn: RunningTurn = {
      id: randomUUID(),
      sessionId,
      events: [],
      subscribers: new Set(),
      completed: false,
      nextEventId: 1,
    };

    this.runningTurns.set(turn.id, turn);
    this.activeSessionIds.add(sessionId);

    return turn;
  }

  private emitTurnEvent(turn: RunningTurn, event: TurnStreamEvent): void {
    const storedEvent = {
      id: turn.nextEventId,
      event,
    };

    turn.nextEventId += 1;
    turn.events.push(storedEvent);
    turn.subscribers.forEach((subscriber) => subscriber(storedEvent));

    if (event.type === 'done' || event.type === 'failed') {
      turn.completed = true;
      this.activeSessionIds.delete(turn.sessionId);
      setTimeout(
        () => {
          this.runningTurns.delete(turn.id);
        },
        5 * 60 * 1000,
      ).unref();
    }
  }

  private finishCreateSession(
    request: CreateSessionRequest,
    result: Promise<AiRunResult>,
    turn: RunningTurn,
  ): void {
    result
      .then(async (aiResponse) => {
        const currentSession = await this.store.getSession(
          aiResponse.sessionId,
        );
        const round = this.createNextRound(currentSession, aiResponse);
        const assistantMessages = createAssistantMessages(aiResponse, round);
        const updatedSession = await this.store.appendRoundAndMessages(
          aiResponse.sessionId,
          round,
          assistantMessages,
        );
        const session = await this.refreshSessionSummary(updatedSession);

        await this.logger
          .session(aiResponse.sessionId)
          .info('session.created', {
            sessionId: aiResponse.sessionId,
            workspace: request.workspace,
            prompt: request.prompt,
            response: aiResponse.content,
            rawEvents: aiResponse.rawEvents,
          });
        await this.logger.framework.info('session.create.completed', {
          sessionId: aiResponse.sessionId,
          workspace: request.workspace,
        });

        this.emitTurnEvent(turn, {
          type: 'done',
          session: toSessionView(session),
        });
      })
      .catch((error: unknown) => {
        void this.logger.framework.error('session.create.failed', {
          sessionId: turn.sessionId,
          error,
        });
        this.emitTurnEvent(turn, {
          type: 'failed',
          error:
            error instanceof Error ? error.message : 'Session creation failed',
        });
      });
  }

  private finishContinueSession(
    request: ContinueSessionRequest,
    result: Promise<AiRunResult>,
    turn: RunningTurn,
    workspace: string,
  ): void {
    result
      .then(async (aiResponse) => {
        const currentSession = await this.store.getSession(
          aiResponse.sessionId,
        );
        const round = this.createNextRound(currentSession, aiResponse);
        const assistantMessages = createAssistantMessages(aiResponse, round);
        const updatedSession = await this.store.appendRoundAndMessages(
          aiResponse.sessionId,
          round,
          assistantMessages,
        );
        const session = await this.refreshSessionSummary(updatedSession);

        await this.logger
          .session(aiResponse.sessionId)
          .info('session.continued', {
            sessionId: aiResponse.sessionId,
            workspace,
            prompt: request.prompt,
            response: aiResponse.content,
            rawEvents: aiResponse.rawEvents,
          });
        await this.logger.framework.info('session.continue.completed', {
          sessionId: aiResponse.sessionId,
          workspace,
        });

        this.emitTurnEvent(turn, {
          type: 'done',
          session: toSessionView(session),
        });
      })
      .catch((error: unknown) => {
        void this.logger.framework.error('session.continue.failed', {
          sessionId: turn.sessionId,
          error,
        });
        this.emitTurnEvent(turn, {
          type: 'failed',
          error:
            error instanceof Error
              ? error.message
              : 'Session continuation failed',
        });
      });
  }

  private async refreshSessionSummary(
    session: ChatSession,
  ): Promise<ChatSession> {
    try {
      const summary = await this.aiModel.summarizeConversation({
        workspace: session.workspace,
        prompt: createSummaryPrompt(session),
      });

      return this.store.updateSessionSummary(session.id, {
        title: summary.title,
        summary: summary.progress,
      });
    } catch (error) {
      void this.logger.session(session.id).warn('session.summary.failed', {
        sessionId: session.id,
        error,
      });

      return session;
    }
  }

  private createNextRound(
    session: ChatSession | undefined,
    aiResponse: AiResponse,
  ): ChatRound | undefined {
    const lastRound = session?.rounds?.at(-1);
    const nextRoundNumber = (lastRound?.round ?? 0) + 1;

    return this.createRound(aiResponse, nextRoundNumber);
  }

  private createRound(
    aiResponse: AiResponse,
    roundNumber: number,
  ): ChatRound | undefined {
    if (!aiResponse.gitDiff) {
      return undefined;
    }

    const beforeDiff = aiResponse.gitDiff.beforeDiff;
    const afterDiff = aiResponse.gitDiff.afterDiff;
    const diff = this.diffService.createRoundDiff(beforeDiff, afterDiff);

    return {
      round: roundNumber,
      beforeDiff,
      afterDiff,
      diff,
      hasChanges: this.diffService.hasChanges(diff),
      createdAt: new Date().toISOString(),
    };
  }
}

export class SessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`);
    this.name = 'SessionNotFoundError';
  }
}

export class SessionBusyError extends Error {
  constructor(sessionId: string) {
    super(`Session is already running: ${sessionId}`);
    this.name = 'SessionBusyError';
  }
}

function handleAiRunEvent(
  event: AiRunEvent,
  emit: (event: TurnStreamEvent) => void,
): void {
  if (event.type === 'delta') {
    emit({ type: 'delta', text: event.text });
    return;
  }

  if (event.type === 'raw') {
    emit({ type: 'raw', event: event.event });
  }
}

function createMessage(
  role: ChatMessage['role'],
  content: string,
  kind?: ChatMessage['kind'],
  round?: number,
): ChatMessage {
  return {
    id: randomUUID(),
    role,
    ...(kind ? { kind } : {}),
    ...(round ? { round } : {}),
    content,
    createdAt: new Date().toISOString(),
  };
}

function createAssistantMessages(
  aiResponse: { content: string; trace?: string },
  round?: ChatRound,
): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const trace = aiResponse.trace?.trim() || 'TRAEX run completed.';
  const content = aiResponse.content.trim();

  messages.push(createMessage('assistant', trace, 'trace'));

  if (content) {
    messages.push(
      createMessage('assistant', content, 'response', round?.round),
    );
  }

  return messages;
}

function toSessionView(session: ChatSession): ChatSessionView {
  return {
    ...session,
    rounds: session.rounds?.map(({ round, hasChanges, createdAt }) => ({
      round,
      hasChanges,
      createdAt,
    })),
  };
}

function createTitle(prompt: string): string {
  const compact = prompt.replace(/\s+/g, ' ').trim();

  if (compact.length <= 48) {
    return compact || 'Untitled session';
  }

  return `${compact.slice(0, 45)}...`;
}

function createSummaryPrompt(session: ChatSession): string {
  const recentMessages = selectRecentTurnMessages(
    session.messages.filter((message) => message.kind !== 'trace'),
  );
  const transcript = recentMessages
    .map(
      (message) =>
        `${message.role === 'user' ? '用户' : '助手'}：${message.content}`,
    )
    .join('\n\n');

  return [
    '请根据下面的对话历史生成当前会话摘要。只输出 JSON，不要输出 Markdown 或解释。',
    '',
    '要求：',
    '1. title：对话标题，30 个中文字符以内。',
    '2. progress：当前进展，200 个中文字符以内，说明已经讨论/完成到哪里、下一步关键上下文。',
    '3. 只基于给定历史，不要补充未知事实。',
    '',
    `工作区：${session.workspace}`,
    '',
    '对话历史：',
    transcript || '无',
    '',
    '输出格式：{"title":"...","progress":"..."}',
  ].join('\n');
}

function selectRecentTurnMessages(messages: ChatMessage[]): ChatMessage[] {
  let userTurns = 0;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') {
      userTurns += 1;

      if (userTurns === 4) {
        return messages.slice(index);
      }
    }
  }

  return messages;
}
