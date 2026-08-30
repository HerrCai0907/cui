import { randomUUID } from "node:crypto";
import {
  AiModel,
  AiModelPreferences,
  AiRunEvent,
  AiRunResult,
  AiRunCancelledError,
  ChatRound,
  ChatSession,
  ChatSessionListItem,
  ChatSessionView,
  QueuedPrompt,
  SessionListPage,
} from "../../types.js";
import { JsonSessionStore } from "../../infrastructure/store/JsonSessionStore.js";
import { AppLogger } from "../../infrastructure/logging/AppLogger.js";
import { createAssistantMessages, createMessage } from "./sessionMessages.js";
import { createTitle } from "./sessionTitles.js";
import { toSessionListItem, toSessionView } from "./sessionViews.js";
import {
  createRoundInputTranscript,
  createSessionInputTranscript,
  getRoundAssistantOutput,
  getRoundExecutionTrace,
} from "./transcripts.js";
import { TurnRegistry, type RunningTurn } from "../turns/TurnRegistry.js";
import type { TurnStreamEvent } from "../turns/turnEvents.js";
import { RoundService } from "../reviews/RoundService.js";
import { AtomicReviewService } from "../reviews/AtomicReviewService.js";
import { SessionSummaryService } from "./SessionSummaryService.js";
import { TurnCompletionService } from "./TurnCompletionService.js";
import type {
  ContinueSessionRequestContract,
  CreateShellSessionRequestContract,
  CreateSessionRequestContract,
  RunShellCommandRequestContract,
  UpdateSessionRequestContract,
} from "../../contracts/apiSchemas.js";
import { GitDiffService } from "../../infrastructure/diff/GitDiffService.js";
import {
  ShellCommandRunner,
  type ShellCommandResult,
} from "../../infrastructure/shell/ShellCommandRunner.js";
import { formatRawEvents } from "../../infrastructure/ai/traexEvents.js";
import { assertExistingDirectory } from "../paths/pathValidation.js";

export type { TurnStreamEvent } from "../turns/turnEvents.js";

export type CreateSessionRequest = CreateSessionRequestContract;

export type ContinueSessionRequest = ContinueSessionRequestContract;

export type CreateShellSessionRequest = CreateShellSessionRequestContract;

export type RunShellCommandRequest = RunShellCommandRequestContract;

export type UpdateSessionRequest = UpdateSessionRequestContract;

export type ListSessionViewsOptions = {
  page?: number;
  pageSize?: number;
};

export type SubmittedTurn = {
  session: ChatSessionView;
} & (
  | {
      disposition: "started";
      turnId: string;
    }
  | {
      disposition: "queued";
      queuedPromptId: string;
    }
);

type QueuedPromptInput =
  | {
      mode: "chat";
      prompt: string;
      models?: AiModelPreferences;
    }
  | {
      mode: "shell";
      prompt: string;
    };

export class SessionService {
  private readonly turnRegistry = new TurnRegistry();
  private readonly sessionOperationQueues = new Map<string, Promise<void>>();

  constructor(
    private readonly aiModel: AiModel,
    private readonly store: JsonSessionStore,
    private readonly logger = new AppLogger(),
    private readonly roundService = new RoundService(),
    private readonly atomicReviewService = new AtomicReviewService(aiModel, logger),
    private readonly sessionSummaryService = new SessionSummaryService(aiModel, store, logger),
    private readonly turnCompletionService = new TurnCompletionService(
      store,
      logger,
      roundService,
      atomicReviewService,
    ),
    private readonly gitDiffService = new GitDiffService(),
    private readonly shellCommandRunner = new ShellCommandRunner(),
  ) {}

  async listSessions(): Promise<ChatSession[]> {
    return this.store.listSessions();
  }

  async listSessionViews(
    options: ListSessionViewsOptions = {},
  ): Promise<SessionListPage<ChatSessionListItem>> {
    const page = await this.store.listSessionIndexEntries(options);
    const branchByWorkspace = new Map<string, Promise<string | undefined>>();

    return {
      ...page,
      sessions: await Promise.all(
        page.sessions.map(async (session) =>
          toSessionListItem(session, {
            gitBranch: await this.getWorkspaceBranch(session.workspace, branchByWorkspace),
            runningTurnId: this.turnRegistry.getRunningTurnIdForSession(session.id),
          }),
        ),
      ),
    };
  }

  async getSession(sessionId: string): Promise<ChatSession | undefined> {
    return this.store.getSession(sessionId);
  }

  async getSessionView(sessionId: string): Promise<ChatSessionView | undefined> {
    const session = await this.store.getSession(sessionId);

    return session ? this.toSessionView(session) : undefined;
  }

  async updateSession(sessionId: string, request: UpdateSessionRequest): Promise<ChatSessionView> {
    const session = await this.store.getSession(sessionId);

    if (!session) {
      throw new SessionNotFoundError(sessionId);
    }

    const doneAt = request.done ? new Date().toISOString() : undefined;
    const updatedSession = await this.store.updateSessionDoneAt(sessionId, doneAt);

    return this.toSessionView(updatedSession);
  }

  async getRoundReview(
    sessionId: string,
    round: number,
    options: { includeAtomicReview?: boolean; models?: AiModelPreferences } = {},
  ): Promise<ChatRound | undefined> {
    const session = await this.store.getSession(sessionId);

    if (!session) {
      return undefined;
    }

    let review = session.rounds?.find((current) => current.round === round);

    if (!review) {
      return undefined;
    }

    review = this.roundService.refreshRoundDiff(review);

    if ((options.includeAtomicReview ?? true) && review.hasChanges && !review.atomicReview) {
      const atomicReview = await this.atomicReviewService.createAtomicDiffReview({
        sessionId,
        workspace: session.workspace,
        prompt: createRoundInputTranscript(session, round),
        aiResponse: {
          sessionId,
          content: getRoundAssistantOutput(session, round),
          trace: getRoundExecutionTrace(session, round),
          rawEvents: [],
        },
        round: review,
        models: options.models,
      });

      review = await this.store.updateRoundAtomicReview(sessionId, round, atomicReview);
      review = this.roundService.refreshRoundDiff(review);
    }

    return review;
  }

  async createSession(request: CreateSessionRequest): Promise<ChatSession> {
    const workspace = await assertExistingDirectory(request.workspace);

    await this.logger.framework.info("session.create.started", {
      workspace,
      promptLength: request.prompt.length,
    });
    const aiResponse = await this.aiModel.createSession({
      workspace,
      prompt: request.prompt,
      models: request.models,
    });
    const sessionId = aiResponse.sessionId;
    const now = new Date().toISOString();
    const userMessage = createMessage("user", request.prompt);
    const round = this.roundService.createRound(aiResponse, 1);
    const assistantMessages = createAssistantMessages(aiResponse, round);
    const session: ChatSession = {
      id: sessionId,
      workspace,
      title: createTitle(request.prompt),
      summary: "",
      createdAt: now,
      updatedAt: now,
      messages: [userMessage, ...assistantMessages],
      ...(round ? { rounds: [round] } : {}),
    };

    await this.logger.session(sessionId).info("session.created", {
      sessionId,
      workspace,
      prompt: request.prompt,
      response: aiResponse.content,
      rawEvents: aiResponse.rawEvents,
    });
    await this.logger.framework.info("session.create.completed", {
      sessionId,
      workspace,
    });

    const createdSession = await this.store.createSession(session);
    if (round?.hasChanges) {
      this.scheduleAtomicReview({
        sessionId,
        workspace,
        prompt: request.prompt,
        aiResponse,
        round,
        models: request.models,
      });
    }

    return this.sessionSummaryService.refreshSessionSummary(createdSession, request.models);
  }

  async beginCreateSession(request: CreateSessionRequest): Promise<SubmittedTurn> {
    const workspace = await assertExistingDirectory(request.workspace);
    const normalizedRequest = { ...request, workspace };

    await this.logger.framework.info("session.create.started", {
      workspace,
      promptLength: request.prompt.length,
    });
    const bufferedEvents: TurnStreamEvent[] = [];
    let runningTurn: RunningTurn | undefined;
    const run = this.aiModel.createSessionStream(normalizedRequest, (event) => {
      handleAiRunEvent(event, (streamEvent) => {
        if (runningTurn) {
          this.turnRegistry.emitTurnEvent(runningTurn, streamEvent);
        } else {
          bufferedEvents.push(streamEvent);
        }
      });
    });
    const sessionId = await run.sessionId;

    if (this.turnRegistry.isSessionActive(sessionId)) {
      throw new SessionBusyError(sessionId);
    }

    const now = new Date().toISOString();
    const userMessage = createMessage("user", request.prompt);
    const session: ChatSession = {
      id: sessionId,
      workspace,
      title: createTitle(request.prompt),
      summary: "",
      createdAt: now,
      updatedAt: now,
      messages: [userMessage],
    };

    const createdSession = await this.store.createSession(session);
    runningTurn = this.turnRegistry.createRunningTurn(sessionId, run.cancel);
    const summaryPromise = this.refreshSessionSummaryFromUserInput(
      createdSession,
      runningTurn,
      request.models,
    );
    bufferedEvents.forEach((event) => this.turnRegistry.emitTurnEvent(runningTurn!, event));
    this.finishCreateSession(normalizedRequest, run.result, runningTurn, summaryPromise);

    return {
      disposition: "started",
      session: await this.toSessionView(createdSession, runningTurn.id),
      turnId: runningTurn.id,
    };
  }

  async beginCreateShellSession(request: CreateShellSessionRequest): Promise<SubmittedTurn> {
    const workspace = await assertExistingDirectory(request.workspace);

    await this.logger.framework.info("shell.session.create.started", {
      workspace,
      commandLength: request.command.length,
    });

    const sessionId = randomUUID();
    const now = new Date().toISOString();
    const userMessage = createMessage("user", request.command);
    const session: ChatSession = {
      id: sessionId,
      workspace,
      title: createShellTitle(request.command),
      summary: "Shell session",
      createdAt: now,
      updatedAt: now,
      messages: [userMessage],
    };

    const createdSession = await this.store.createSession(session);
    const shellRun = this.startShellRun({
      sessionId,
      workspace,
      command: request.command,
    });

    await this.logger.framework.info("shell.session.create.accepted", {
      sessionId,
      workspace,
    });

    return {
      disposition: "started",
      session: await this.toSessionView(createdSession, shellRun.turn.id),
      turnId: shellRun.turn.id,
    };
  }

  async continueSession(sessionId: string, request: ContinueSessionRequest): Promise<ChatSession> {
    await this.logger.framework.info("session.continue.started", {
      sessionId,
      promptLength: request.prompt.length,
    });
    const session = await this.store.getSession(sessionId);

    if (!session) {
      await this.logger.framework.warn("session.continue.not_found", {
        sessionId,
      });
      throw new SessionNotFoundError(sessionId);
    }

    const workspace = await assertExistingDirectory(session.workspace);
    const aiResponse = await this.aiModel.continueSession({
      sessionId,
      workspace,
      prompt: request.prompt,
      models: request.models,
    });
    const userMessage = createMessage("user", request.prompt);
    const round = this.roundService.createNextRound(session, aiResponse);
    const reviewPrompt = round?.hasChanges
      ? createSessionInputTranscript(session, request.prompt)
      : undefined;
    const assistantMessages = createAssistantMessages(aiResponse, round);

    await this.logger.session(sessionId).info("session.continued", {
      sessionId,
      workspace,
      prompt: request.prompt,
      response: aiResponse.content,
      rawEvents: aiResponse.rawEvents,
    });
    await this.logger.framework.info("session.continue.completed", {
      sessionId,
      workspace,
    });

    const updatedSession = await this.store.appendRoundAndMessages(sessionId, round, [
      userMessage,
      ...assistantMessages,
    ]);
    if (round?.hasChanges && reviewPrompt) {
      this.scheduleAtomicReview({
        sessionId,
        workspace,
        prompt: reviewPrompt,
        aiResponse,
        round,
        models: request.models,
      });
    }

    return this.sessionSummaryService.refreshSessionSummary(updatedSession, request.models);
  }

  async beginContinueSession(
    sessionId: string,
    request: ContinueSessionRequest,
  ): Promise<SubmittedTurn> {
    const submittedTurn = await this.enqueueSessionOperation(sessionId, async () => {
      await this.logger.framework.info("session.continue.started", {
        sessionId,
        promptLength: request.prompt.length,
      });
      const session = await this.getExistingSession(sessionId, "session.continue.not_found");

      if (this.shouldQueuePrompt(session)) {
        return this.enqueuePrompt(sessionId, {
          mode: "chat",
          prompt: request.prompt,
          models: request.models,
        });
      }

      return this.startContinueSession(session, request);
    });

    if (submittedTurn.disposition === "queued") {
      this.scheduleNextQueuedPrompt(sessionId);
    }

    return submittedTurn;
  }

  async beginRunShellCommand(
    sessionId: string,
    request: RunShellCommandRequest,
  ): Promise<SubmittedTurn> {
    const submittedTurn = await this.enqueueSessionOperation(sessionId, async () => {
      await this.logger.framework.info("shell.command.started", {
        sessionId,
        commandLength: request.command.length,
      });
      const session = await this.getExistingSession(sessionId, "shell.command.not_found");

      if (this.shouldQueuePrompt(session)) {
        return this.enqueuePrompt(sessionId, {
          mode: "shell",
          prompt: request.command,
        });
      }

      return this.startRunShellCommand(session, request);
    });

    if (submittedTurn.disposition === "queued") {
      this.scheduleNextQueuedPrompt(sessionId);
    }

    return submittedTurn;
  }

  hasRunningTurn(turnId: string): boolean {
    return this.turnRegistry.hasRunningTurn(turnId);
  }

  async cancelRunningTurn(sessionId: string): Promise<void> {
    const turn = this.turnRegistry.getRunningTurnForSession(sessionId);

    if (!turn) {
      throw new SessionNotRunningError(sessionId);
    }

    turn.cancel();
    await Promise.race([turn.completion, delay(5000)]);
  }

  subscribeToTurn(turnId: string, onEvent: (event: TurnStreamEvent) => void): () => void {
    return this.turnRegistry.subscribeToTurn(turnId, onEvent);
  }

  async resumeQueuedPrompts(): Promise<void> {
    const sessions = await this.store.listSessions();

    sessions
      .filter((session) => (session.queuedPrompts?.length ?? 0) > 0)
      .forEach((session) => this.scheduleNextQueuedPrompt(session.id));
  }

  private async startContinueSession(
    session: ChatSession,
    request: ContinueSessionRequest,
  ): Promise<SubmittedTurn> {
    const workspace = await assertExistingDirectory(session.workspace);
    const userMessage = createMessage("user", request.prompt);
    const updatedSession = await this.store.appendMessages(session.id, [userMessage]);
    const bufferedEvents: TurnStreamEvent[] = [];
    let runningTurn: RunningTurn | undefined;
    const run = this.aiModel.continueSessionStream(
      {
        sessionId: session.id,
        workspace,
        prompt: request.prompt,
        models: request.models,
      },
      (event) => {
        handleAiRunEvent(event, (streamEvent) => {
          if (runningTurn) {
            this.turnRegistry.emitTurnEvent(runningTurn, streamEvent);
          } else {
            bufferedEvents.push(streamEvent);
          }
        });
      },
    );

    runningTurn = this.turnRegistry.createRunningTurn(session.id, run.cancel);
    const summaryPromise = this.refreshSessionSummaryFromUserInput(
      updatedSession,
      runningTurn,
      request.models,
    );

    bufferedEvents.forEach((event) => this.turnRegistry.emitTurnEvent(runningTurn!, event));
    this.finishContinueSession(request, run.result, runningTurn, workspace, summaryPromise);

    return {
      disposition: "started",
      session: await this.toSessionView(updatedSession, runningTurn.id),
      turnId: runningTurn.id,
    };
  }

  private async startRunShellCommand(
    session: ChatSession,
    request: RunShellCommandRequest,
  ): Promise<SubmittedTurn> {
    const workspace = await assertExistingDirectory(session.workspace);
    const userMessage = createMessage("user", request.command);
    const updatedSession = await this.store.appendMessages(session.id, [userMessage]);
    const shellRun = this.startShellRun({
      sessionId: session.id,
      workspace,
      command: request.command,
    });

    return {
      disposition: "started",
      session: await this.toSessionView(updatedSession, shellRun.turn.id),
      turnId: shellRun.turn.id,
    };
  }

  private async enqueuePrompt(sessionId: string, input: QueuedPromptInput): Promise<SubmittedTurn> {
    const queuedPrompt: QueuedPrompt = {
      id: randomUUID(),
      mode: input.mode,
      prompt: input.prompt,
      createdAt: new Date().toISOString(),
      ...(input.mode === "chat" && input.models ? { models: input.models } : {}),
    };
    const updatedSession = await this.store.enqueuePrompt(sessionId, queuedPrompt);

    await this.logger.framework.info("session.prompt.queued", {
      sessionId,
      queuedPromptId: queuedPrompt.id,
      mode: queuedPrompt.mode,
    });

    return {
      disposition: "queued",
      queuedPromptId: queuedPrompt.id,
      session: await this.toSessionView(updatedSession),
    };
  }

  private scheduleNextQueuedPrompt(sessionId: string): void {
    void this.enqueueSessionOperation(sessionId, async () => {
      if (this.turnRegistry.isSessionActive(sessionId)) {
        return;
      }

      const queuedPrompt = await this.store.shiftQueuedPrompt(sessionId);

      if (!queuedPrompt) {
        return;
      }

      await this.logger.framework.info("session.prompt.dequeued", {
        sessionId,
        queuedPromptId: queuedPrompt.id,
        mode: queuedPrompt.mode,
      });

      const session = await this.getExistingSession(sessionId, "session.queue.not_found");

      if (queuedPrompt.mode === "shell") {
        await this.startRunShellCommand(session, { command: queuedPrompt.prompt });
        return;
      }

      await this.startContinueSession(session, {
        prompt: queuedPrompt.prompt,
        models: queuedPrompt.models,
      });
    }).catch((error: unknown) => {
      void this.logger.framework.error("session.queue.failed", {
        sessionId,
        error,
      });
    });
  }

  private shouldQueuePrompt(session: ChatSession): boolean {
    return (
      this.turnRegistry.isSessionActive(session.id) || (session.queuedPrompts?.length ?? 0) > 0
    );
  }

  private async getExistingSession(
    sessionId: string,
    missingLogEvent: string,
  ): Promise<ChatSession> {
    const session = await this.store.getSession(sessionId);

    if (!session) {
      await this.logger.framework.warn(missingLogEvent, {
        sessionId,
      });
      throw new SessionNotFoundError(sessionId);
    }

    return session;
  }

  private finishCreateSession(
    request: CreateSessionRequest,
    result: Promise<AiRunResult>,
    turn: RunningTurn,
    summaryPromise: Promise<ChatSession>,
  ): void {
    result
      .then(async (aiResponse) => {
        const session = await this.turnCompletionService.completeTurn({
          kind: "create",
          workspace: request.workspace,
          prompt: request.prompt,
          aiResponse,
          models: request.models,
        });
        const latestSession =
          (await this.waitForInputSummary(summaryPromise, turn.sessionId)) ?? session;

        this.turnRegistry.emitTurnEvent(turn, {
          type: "done",
          session: latestSession,
        });
        this.scheduleNextQueuedPrompt(turn.sessionId);
      })
      .catch(async (error: unknown) => {
        if (error instanceof AiRunCancelledError) {
          void this.logger.framework.info("session.create.cancelled", {
            sessionId: turn.sessionId,
          });
          await this.persistCancelledTrace(turn);
          this.turnRegistry.emitTurnEvent(turn, { type: "cancelled" });
          this.scheduleNextQueuedPrompt(turn.sessionId);
          return;
        }

        void this.logger.framework.error("session.create.failed", {
          sessionId: turn.sessionId,
          error,
        });
        this.turnRegistry.emitTurnEvent(turn, {
          type: "failed",
          error: error instanceof Error ? error.message : "Session creation failed",
        });
        this.scheduleNextQueuedPrompt(turn.sessionId);
      });
  }

  private finishContinueSession(
    request: ContinueSessionRequest,
    result: Promise<AiRunResult>,
    turn: RunningTurn,
    workspace: string,
    summaryPromise: Promise<ChatSession>,
  ): void {
    result
      .then(async (aiResponse) => {
        const session = await this.turnCompletionService.completeTurn({
          kind: "continue",
          workspace,
          prompt: request.prompt,
          aiResponse,
          models: request.models,
        });
        const latestSession =
          (await this.waitForInputSummary(summaryPromise, turn.sessionId)) ?? session;

        this.turnRegistry.emitTurnEvent(turn, {
          type: "done",
          session: latestSession,
        });
        this.scheduleNextQueuedPrompt(turn.sessionId);
      })
      .catch(async (error: unknown) => {
        if (error instanceof AiRunCancelledError) {
          void this.logger.framework.info("session.continue.cancelled", {
            sessionId: turn.sessionId,
          });
          await this.persistCancelledTrace(turn);
          this.turnRegistry.emitTurnEvent(turn, { type: "cancelled" });
          this.scheduleNextQueuedPrompt(turn.sessionId);
          return;
        }

        void this.logger.framework.error("session.continue.failed", {
          sessionId: turn.sessionId,
          error,
        });
        this.turnRegistry.emitTurnEvent(turn, {
          type: "failed",
          error: error instanceof Error ? error.message : "Session continuation failed",
        });
        this.scheduleNextQueuedPrompt(turn.sessionId);
      });
  }

  private startShellRun(input: { sessionId: string; workspace: string; command: string }): {
    turn: RunningTurn;
  } {
    let turn: RunningTurn | undefined;
    const bufferedEvents: TurnStreamEvent[] = [];
    const emit = (event: TurnStreamEvent) => {
      if (turn) {
        this.turnRegistry.emitTurnEvent(turn, event);
      } else {
        bufferedEvents.push(event);
      }
    };
    const shellRun = this.shellCommandRunner.run(input.command, {
      cwd: input.workspace,
      onEvent: (event) => {
        if (event.type === "started") {
          emit({
            type: "raw",
            event: createShellTraceEvent("item.started", input.command, {
              status: "in_progress",
            }),
          });
          return;
        }

        emit({ type: "delta", text: event.text });
      },
    });

    turn = this.turnRegistry.createRunningTurn(input.sessionId, shellRun.cancel);
    bufferedEvents.forEach((event) => this.turnRegistry.emitTurnEvent(turn!, event));
    this.finishShellRun(input, shellRun.result, turn);

    return { turn };
  }

  private finishShellRun(
    input: {
      sessionId: string;
      workspace: string;
      command: string;
    },
    result: Promise<ShellCommandResult>,
    turn: RunningTurn,
  ): void {
    result
      .then(async (shellResult) => {
        const cancelled = shellResult.signal === "SIGTERM";
        const traceStatus = cancelled
          ? "cancelled"
          : shellResult.exitCode === 0
            ? "completed"
            : "failed";

        const startedTraceEvent = createShellTraceEvent("item.started", input.command, {
          status: "in_progress",
        });
        const completedTraceEvent = createShellTraceEvent("item.completed", input.command, {
          status: traceStatus,
          exitCode: shellResult.exitCode,
          output: shellResult.output,
        });

        this.turnRegistry.emitTurnEvent(turn, {
          type: "raw",
          event: completedTraceEvent,
        });

        const output = formatShellCommandOutput(input.command, shellResult);
        const traceMessage = createMessage(
          "assistant",
          [startedTraceEvent, completedTraceEvent].map((event) => JSON.stringify(event)).join("\n"),
          "trace",
        );
        const assistantMessage = createMessage("assistant", output, "response");
        const updatedSession = await this.store.appendMessages(input.sessionId, [
          traceMessage,
          assistantMessage,
        ]);

        await this.logger.session(input.sessionId).info("shell.command.completed", {
          sessionId: input.sessionId,
          workspace: input.workspace,
          command: input.command,
          exitCode: shellResult.exitCode,
          signal: shellResult.signal,
        });
        await this.logger.framework.info("shell.command.completed", {
          sessionId: input.sessionId,
          workspace: input.workspace,
        });

        const sessionView = await this.toSessionView(updatedSession);

        this.turnRegistry.emitTurnEvent(turn, {
          type: "done",
          session: sessionView,
        });
        this.scheduleNextQueuedPrompt(turn.sessionId);
      })
      .catch((error: unknown) => {
        void this.logger.framework.error("shell.command.failed", {
          sessionId: input.sessionId,
          error,
        });
        this.turnRegistry.emitTurnEvent(turn, {
          type: "failed",
          error: error instanceof Error ? error.message : "Shell command failed",
        });
        this.scheduleNextQueuedPrompt(turn.sessionId);
      });
  }

  private enqueueSessionOperation<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.sessionOperationQueues.get(sessionId) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const nextQueue = result.then(
      () => undefined,
      () => undefined,
    );

    this.sessionOperationQueues.set(sessionId, nextQueue);
    nextQueue.finally(() => {
      if (this.sessionOperationQueues.get(sessionId) === nextQueue) {
        this.sessionOperationQueues.delete(sessionId);
      }
    });

    return result;
  }

  private refreshSessionSummaryFromUserInput(
    session: ChatSession,
    turn?: RunningTurn,
    models?: AiModelPreferences,
  ): Promise<ChatSession> {
    return this.sessionSummaryService
      .refreshSessionSummary(session, models)
      .then(async (updatedSession) => {
        if (turn && !turn.completed && updatedSession !== session) {
          this.turnRegistry.emitTurnEvent(turn, {
            type: "session.updated",
            session: await this.toSessionView(updatedSession, turn.id),
          });
        }

        return updatedSession;
      });
  }

  private async waitForInputSummary(
    summaryPromise: Promise<ChatSession>,
    sessionId: string,
  ): Promise<ChatSessionView | undefined> {
    await summaryPromise;

    const latestSession = await this.store.getSession(sessionId);

    return latestSession ? this.toSessionView(latestSession) : undefined;
  }

  private async persistCancelledTrace(turn: RunningTurn): Promise<void> {
    const rawEvents = turn.events.flatMap(({ event }) =>
      event.type === "raw" ? [event.event] : [],
    );

    if (rawEvents.length === 0) {
      return;
    }

    try {
      await this.store.appendMessages(turn.sessionId, [
        createMessage("assistant", formatRawEvents(rawEvents), "trace"),
      ]);
    } catch (error) {
      void this.logger.session(turn.sessionId).warn("session.cancelled_trace.persist_failed", {
        sessionId: turn.sessionId,
        error,
      });
    }
  }

  private async toSessionView(
    session: ChatSession,
    runningTurnId = this.turnRegistry.getRunningTurnIdForSession(session.id),
  ): Promise<ChatSessionView> {
    return toSessionView(session, {
      gitBranch: await this.getWorkspaceBranch(session.workspace),
      runningTurnId,
    });
  }

  private async getWorkspaceBranch(
    workspace: string,
    cache?: Map<string, Promise<string | undefined>>,
  ): Promise<string | undefined> {
    const cachedBranch = cache?.get(workspace);

    if (cachedBranch) {
      return cachedBranch;
    }

    const branch = this.gitDiffService.captureCurrentBranch(workspace);
    cache?.set(workspace, branch);

    return branch;
  }

  private scheduleAtomicReview(input: {
    sessionId: string;
    workspace: string;
    prompt: string;
    aiResponse: AiRunResult;
    round: ChatRound;
    models?: AiModelPreferences;
  }): void {
    void this.atomicReviewService
      .createAtomicDiffReview(input)
      .then((atomicReview) =>
        this.store.updateRoundAtomicReview(input.sessionId, input.round.round, atomicReview),
      )
      .catch((error: unknown) =>
        this.logger.session(input.sessionId).warn("round.review.persist_failed", {
          sessionId: input.sessionId,
          round: input.round.round,
          error,
        }),
      );
  }
}

export class SessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`);
    this.name = "SessionNotFoundError";
  }
}

export class SessionBusyError extends Error {
  constructor(sessionId: string) {
    super(`Session is already running: ${sessionId}`);
    this.name = "SessionBusyError";
  }
}

export class SessionNotRunningError extends Error {
  constructor(sessionId: string) {
    super(`Session is not running: ${sessionId}`);
    this.name = "SessionNotRunningError";
  }
}

function createShellTitle(command: string): string {
  return createTitle(`$ ${command}`);
}

function createShellTraceEvent(
  type: "item.started" | "item.completed",
  command: string,
  options: {
    status: string;
    exitCode?: number | null;
    output?: string;
  },
) {
  return {
    type,
    item: {
      id: `shell-${hashShellCommand(command)}`,
      type: "command_execution",
      command,
      status: options.status,
      ...(options.exitCode !== undefined ? { exit_code: options.exitCode } : {}),
      ...(options.output !== undefined ? { aggregated_output: options.output } : {}),
    },
  };
}

function formatShellCommandOutput(command: string, result: ShellCommandResult): string {
  const status =
    result.signal === "SIGTERM"
      ? "cancelled"
      : result.exitCode === 0
        ? "completed"
        : `failed with exit code ${result.exitCode ?? "unknown"}`;
  const output = result.output.trimEnd();

  return [`$ ${command}`, "", output || "(no output)", "", `Status: ${status}`].join("\n");
}

function hashShellCommand(command: string): string {
  let hash = 0;

  for (let index = 0; index < command.length; index += 1) {
    hash = (hash * 31 + command.charCodeAt(index)) >>> 0;
  }

  return hash.toString(16);
}

function handleAiRunEvent(event: AiRunEvent, emit: (event: TurnStreamEvent) => void): void {
  if (event.type === "delta") {
    emit({ type: "delta", text: event.text });
    return;
  }

  if (event.type === "raw") {
    emit({ type: "raw", event: event.event });
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
