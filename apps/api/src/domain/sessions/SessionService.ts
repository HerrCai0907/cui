import { randomUUID } from "node:crypto";
import {
  AiModel,
  AiRunEvent,
  AiRunResult,
  AiRunCancelledError,
  ChatRound,
  ChatSession,
  ChatSessionView,
} from "../../types.js";
import { JsonSessionStore } from "../../infrastructure/store/JsonSessionStore.js";
import { AppLogger } from "../../infrastructure/logging/AppLogger.js";
import { createAssistantMessages, createMessage } from "./sessionMessages.js";
import { createTitle } from "./sessionTitles.js";
import { toSessionView } from "./sessionViews.js";
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

export type { TurnStreamEvent } from "../turns/turnEvents.js";

export type CreateSessionRequest = CreateSessionRequestContract;

export type ContinueSessionRequest = ContinueSessionRequestContract;

export type CreateShellSessionRequest = CreateShellSessionRequestContract;

export type RunShellCommandRequest = RunShellCommandRequestContract;

export type UpdateSessionRequest = UpdateSessionRequestContract;

export type SubmittedTurn = {
  session: ChatSessionView;
  turnId: string;
};

export class SessionService {
  private readonly turnRegistry = new TurnRegistry();

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

  async listSessionViews(): Promise<ChatSessionView[]> {
    const sessions = await this.store.listSessions();
    const branchByWorkspace = new Map<string, Promise<string | undefined>>();

    return Promise.all(
      sessions.map(async (session) =>
        toSessionView(session, {
          gitBranch: await this.getWorkspaceBranch(session.workspace, branchByWorkspace),
          runningTurnId: this.turnRegistry.getRunningTurnIdForSession(session.id),
        }),
      ),
    );
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
    options: { includeAtomicReview?: boolean } = {},
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
      });

      review = await this.store.updateRoundAtomicReview(sessionId, round, atomicReview);
      review = this.roundService.refreshRoundDiff(review);
    }

    return review;
  }

  async createSession(request: CreateSessionRequest): Promise<ChatSession> {
    await this.logger.framework.info("session.create.started", {
      workspace: request.workspace,
      promptLength: request.prompt.length,
    });
    const aiResponse = await this.aiModel.createSession({
      workspace: request.workspace,
      prompt: request.prompt,
    });
    const sessionId = aiResponse.sessionId;
    const now = new Date().toISOString();
    const userMessage = createMessage("user", request.prompt);
    const round = this.roundService.createRound(aiResponse, 1);
    const assistantMessages = createAssistantMessages(aiResponse, round);
    const session: ChatSession = {
      id: sessionId,
      workspace: request.workspace,
      title: createTitle(request.prompt),
      summary: "",
      createdAt: now,
      updatedAt: now,
      messages: [userMessage, ...assistantMessages],
      ...(round ? { rounds: [round] } : {}),
    };

    await this.logger.session(sessionId).info("session.created", {
      sessionId,
      workspace: request.workspace,
      prompt: request.prompt,
      response: aiResponse.content,
      rawEvents: aiResponse.rawEvents,
    });
    await this.logger.framework.info("session.create.completed", {
      sessionId,
      workspace: request.workspace,
    });

    const createdSession = await this.store.createSession(session);
    if (round?.hasChanges) {
      this.scheduleAtomicReview({
        sessionId,
        workspace: request.workspace,
        prompt: request.prompt,
        aiResponse,
        round,
      });
    }

    return this.sessionSummaryService.refreshSessionSummary(createdSession);
  }

  async beginCreateSession(request: CreateSessionRequest): Promise<SubmittedTurn> {
    await this.logger.framework.info("session.create.started", {
      workspace: request.workspace,
      promptLength: request.prompt.length,
    });
    const bufferedEvents: TurnStreamEvent[] = [];
    let runningTurn: RunningTurn | undefined;
    const run = this.aiModel.createSessionStream(request, (event) => {
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
      workspace: request.workspace,
      title: createTitle(request.prompt),
      summary: "",
      createdAt: now,
      updatedAt: now,
      messages: [userMessage],
    };

    const createdSession = await this.store.createSession(session);
    runningTurn = this.turnRegistry.createRunningTurn(sessionId, run.cancel);
    const summaryPromise = this.refreshSessionSummaryFromUserInput(createdSession, runningTurn);
    bufferedEvents.forEach((event) => this.turnRegistry.emitTurnEvent(runningTurn!, event));
    this.finishCreateSession(request, run.result, runningTurn, summaryPromise);

    return {
      session: await this.toSessionView(createdSession, runningTurn.id),
      turnId: runningTurn.id,
    };
  }

  async beginCreateShellSession(request: CreateShellSessionRequest): Promise<SubmittedTurn> {
    await this.logger.framework.info("shell.session.create.started", {
      workspace: request.workspace,
      commandLength: request.command.length,
    });

    const sessionId = randomUUID();
    const now = new Date().toISOString();
    const userMessage = createMessage("user", request.command);
    const session: ChatSession = {
      id: sessionId,
      workspace: request.workspace,
      title: createShellTitle(request.command),
      summary: "Shell session",
      createdAt: now,
      updatedAt: now,
      messages: [userMessage],
    };

    const createdSession = await this.store.createSession(session);
    const shellRun = this.startShellRun({
      sessionId,
      workspace: request.workspace,
      command: request.command,
    });

    await this.logger.framework.info("shell.session.create.accepted", {
      sessionId,
      workspace: request.workspace,
    });

    return {
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

    const aiResponse = await this.aiModel.continueSession({
      sessionId,
      workspace: session.workspace,
      prompt: request.prompt,
    });
    const userMessage = createMessage("user", request.prompt);
    const round = this.roundService.createNextRound(session, aiResponse);
    const reviewPrompt = round?.hasChanges
      ? createSessionInputTranscript(session, request.prompt)
      : undefined;
    const assistantMessages = createAssistantMessages(aiResponse, round);

    await this.logger.session(sessionId).info("session.continued", {
      sessionId,
      workspace: session.workspace,
      prompt: request.prompt,
      response: aiResponse.content,
      rawEvents: aiResponse.rawEvents,
    });
    await this.logger.framework.info("session.continue.completed", {
      sessionId,
      workspace: session.workspace,
    });

    const updatedSession = await this.store.appendRoundAndMessages(sessionId, round, [
      userMessage,
      ...assistantMessages,
    ]);
    if (round?.hasChanges && reviewPrompt) {
      this.scheduleAtomicReview({
        sessionId,
        workspace: session.workspace,
        prompt: reviewPrompt,
        aiResponse,
        round,
      });
    }

    return this.sessionSummaryService.refreshSessionSummary(updatedSession);
  }

  async beginContinueSession(
    sessionId: string,
    request: ContinueSessionRequest,
  ): Promise<SubmittedTurn> {
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

    if (this.turnRegistry.isSessionActive(sessionId)) {
      throw new SessionBusyError(sessionId);
    }

    const userMessage = createMessage("user", request.prompt);
    const updatedSession = await this.store.appendMessages(sessionId, [userMessage]);
    const bufferedEvents: TurnStreamEvent[] = [];
    let runningTurn: RunningTurn | undefined;
    const run = this.aiModel.continueSessionStream(
      {
        sessionId,
        workspace: session.workspace,
        prompt: request.prompt,
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
    runningTurn = this.turnRegistry.createRunningTurn(sessionId, run.cancel);
    const summaryPromise = this.refreshSessionSummaryFromUserInput(updatedSession, runningTurn);
    bufferedEvents.forEach((event) => this.turnRegistry.emitTurnEvent(runningTurn!, event));

    this.finishContinueSession(request, run.result, runningTurn, session.workspace, summaryPromise);

    return {
      session: await this.toSessionView(updatedSession, runningTurn.id),
      turnId: runningTurn.id,
    };
  }

  async beginRunShellCommand(
    sessionId: string,
    request: RunShellCommandRequest,
  ): Promise<SubmittedTurn> {
    await this.logger.framework.info("shell.command.started", {
      sessionId,
      commandLength: request.command.length,
    });
    const session = await this.store.getSession(sessionId);

    if (!session) {
      await this.logger.framework.warn("shell.command.not_found", {
        sessionId,
      });
      throw new SessionNotFoundError(sessionId);
    }

    if (this.turnRegistry.isSessionActive(sessionId)) {
      throw new SessionBusyError(sessionId);
    }

    const userMessage = createMessage("user", request.command);
    const updatedSession = await this.store.appendMessages(sessionId, [userMessage]);
    const shellRun = this.startShellRun({
      sessionId,
      workspace: session.workspace,
      command: request.command,
    });

    return {
      session: await this.toSessionView(updatedSession, shellRun.turn.id),
      turnId: shellRun.turn.id,
    };
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
        });
        const latestSession =
          (await this.waitForInputSummary(summaryPromise, turn.sessionId)) ?? session;

        this.turnRegistry.emitTurnEvent(turn, {
          type: "done",
          session: latestSession,
        });
      })
      .catch(async (error: unknown) => {
        if (error instanceof AiRunCancelledError) {
          void this.logger.framework.info("session.create.cancelled", {
            sessionId: turn.sessionId,
          });
          await this.persistCancelledTrace(turn);
          this.turnRegistry.emitTurnEvent(turn, { type: "cancelled" });
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
        });
        const latestSession =
          (await this.waitForInputSummary(summaryPromise, turn.sessionId)) ?? session;

        this.turnRegistry.emitTurnEvent(turn, {
          type: "done",
          session: latestSession,
        });
      })
      .catch(async (error: unknown) => {
        if (error instanceof AiRunCancelledError) {
          void this.logger.framework.info("session.continue.cancelled", {
            sessionId: turn.sessionId,
          });
          await this.persistCancelledTrace(turn);
          this.turnRegistry.emitTurnEvent(turn, { type: "cancelled" });
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
      });
  }

  private refreshSessionSummaryFromUserInput(
    session: ChatSession,
    turn?: RunningTurn,
  ): Promise<ChatSession> {
    return this.sessionSummaryService
      .refreshSessionSummary(session)
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
