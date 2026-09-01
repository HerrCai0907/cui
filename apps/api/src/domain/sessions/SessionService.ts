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
import { createMessage } from "./sessionMessages.js";
import { toSessionListItem, toSessionView } from "./sessionViews.js";
import {
  createRoundInputTranscript,
  createSessionInputTranscript,
  getRoundAssistantOutput,
  getRoundExecutionTrace,
} from "./transcripts.js";
import { RunRegistry, type RunningRun } from "../runs/RunRegistry.js";
import type { RunStreamEvent } from "../runs/runEvents.js";
import { RoundService } from "../reviews/RoundService.js";
import { AtomicReviewService } from "../reviews/AtomicReviewService.js";
import { SessionSummaryService } from "./SessionSummaryService.js";
import { RunCompletionService } from "./RunCompletionService.js";
import type {
  CreateRunRequestContract,
  CreateSessionRequestContract,
  CreateRoundReviewRunRequestContract,
  UpdateSessionRequestContract,
} from "../../contracts/apiSchemas.js";
import { GitDiffService } from "../../infrastructure/diff/GitDiffService.js";
import {
  ShellCommandRunner,
  type ShellCommandResult,
} from "../../infrastructure/shell/ShellCommandRunner.js";
import { formatRawEvents } from "../../infrastructure/ai/traexEvents.js";
import { assertExistingDirectory } from "../paths/pathValidation.js";

export type { RunStreamEvent } from "../runs/runEvents.js";

export type CreateSessionRequest = CreateSessionRequestContract;

export type CreateRunRequest = CreateRunRequestContract;

export type CreateRoundReviewRunRequest = CreateRoundReviewRunRequestContract;

export type UpdateSessionRequest = UpdateSessionRequestContract;

export type ListSessionViewsOptions = {
  page?: number;
  pageSize?: number;
};

export type SubmittedRun = {
  run: {
    id: string;
    sessionId: string;
    type: "assistant_response" | "shell_command" | "round_review";
    status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
    createdAt?: string;
  };
  session: ChatSessionView;
};

function toRunningSubmittedRun(run: RunningRun, session: ChatSessionView): SubmittedRun {
  return {
    run: {
      id: run.id,
      sessionId: run.sessionId,
      type: run.type,
      status: "running",
      createdAt: run.createdAt,
    },
    session,
  };
}

function toQueuedSubmittedRun(input: {
  queuedPrompt: QueuedPrompt;
  session: ChatSessionView;
}): SubmittedRun {
  return {
    run: {
      id: input.queuedPrompt.id,
      sessionId: input.session.id,
      type: input.queuedPrompt.mode === "shell" ? "shell_command" : "assistant_response",
      status: "queued",
      createdAt: input.queuedPrompt.createdAt,
    },
    session: input.session,
  };
}

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

type AssistantRunInput = {
  prompt: string;
  models?: AiModelPreferences;
};

type ShellCommandRunInput = {
  command: string;
};

type StartRunOptions = {
  runId?: string;
  createdAt?: string;
};

export class SessionService {
  private readonly runRegistry = new RunRegistry();
  private readonly sessionOperationQueues = new Map<string, Promise<void>>();

  constructor(
    private readonly aiModel: AiModel,
    private readonly store: JsonSessionStore,
    private readonly logger = new AppLogger(),
    private readonly roundService = new RoundService(),
    private readonly atomicReviewService = new AtomicReviewService(aiModel, logger),
    private readonly sessionSummaryService = new SessionSummaryService(aiModel, store, logger),
    private readonly runCompletionService = new RunCompletionService(
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
            runningRunId: this.runRegistry.getRunningRunIdForSession(session.id),
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

  async createSessionContainer(request: CreateSessionRequest): Promise<ChatSessionView> {
    const workspace = await assertExistingDirectory(request.workspace);
    const now = new Date().toISOString();
    const sessionId = randomUUID();
    const origin = request.origin ?? "chat";
    const session: ChatSession = {
      id: sessionId,
      origin,
      workspace,
      title: request.title ?? "Untitled session",
      summary: origin === "shell" ? "Shell session" : "",
      createdAt: now,
      updatedAt: now,
      messages: [],
    };

    const createdSession = await this.store.createSession(session);

    await this.logger.framework.info("session.container.created", {
      sessionId,
      workspace,
      origin,
    });

    return this.toSessionView(createdSession);
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

  async getRoundReview(sessionId: string, round: number): Promise<ChatRound | undefined> {
    const session = await this.store.getSession(sessionId);

    if (!session) {
      return undefined;
    }

    let review = session.rounds?.find((current) => current.round === round);

    if (!review) {
      return undefined;
    }

    review = this.roundService.refreshRoundDiff(review);

    return review;
  }

  private async submitAssistantRun(
    sessionId: string,
    request: Extract<CreateRunRequest, { type: "assistant_response" }>,
  ): Promise<SubmittedRun> {
    const submittedRun = await this.enqueueSessionOperation(sessionId, async () => {
      await this.logger.framework.info("run.assistant.started", {
        sessionId,
        promptLength: request.input.prompt.length,
      });
      const session = await this.getExistingSession(sessionId, "run.assistant.not_found");

      if (this.shouldQueuePrompt(session)) {
        return this.enqueuePrompt(sessionId, {
          mode: "chat",
          prompt: request.input.prompt,
          models: request.models,
        });
      }

      return this.startAssistantRun(session, {
        prompt: request.input.prompt,
        models: request.models,
      });
    });

    if (submittedRun.run.status === "queued") {
      this.scheduleNextQueuedPrompt(sessionId);
    }

    return submittedRun;
  }

  private async submitShellCommandRun(
    sessionId: string,
    request: Extract<CreateRunRequest, { type: "shell_command" }>,
  ): Promise<SubmittedRun> {
    const submittedRun = await this.enqueueSessionOperation(sessionId, async () => {
      await this.logger.framework.info("shell.command.started", {
        sessionId,
        commandLength: request.input.command.length,
      });
      const session = await this.getExistingSession(sessionId, "shell.command.not_found");

      if (this.shouldQueuePrompt(session)) {
        return this.enqueuePrompt(sessionId, {
          mode: "shell",
          prompt: request.input.command,
        });
      }

      return this.startShellCommandRun(session, {
        command: request.input.command,
      });
    });

    if (submittedRun.run.status === "queued") {
      this.scheduleNextQueuedPrompt(sessionId);
    }

    return submittedRun;
  }

  async createRun(sessionId: string, request: CreateRunRequest): Promise<SubmittedRun> {
    if (request.type === "shell_command") {
      return this.submitShellCommandRun(sessionId, request);
    }

    return this.submitAssistantRun(sessionId, request);
  }

  async createRoundReviewRun(
    sessionId: string,
    round: number,
    request: CreateRoundReviewRunRequest,
  ): Promise<SubmittedRun> {
    const session = await this.getExistingSession(sessionId, "round.review.not_found");
    const review = session.rounds?.find((current) => current.round === round);

    if (!review) {
      throw new RoundReviewNotFoundError(sessionId, round);
    }

    if (this.runRegistry.isSessionActive(sessionId)) {
      throw new SessionBusyError(sessionId);
    }

    const runningRun = this.runRegistry.createRunningRun(sessionId, "round_review", () => {
      // Atomic review generation is not currently cancellable.
    });

    void this.atomicReviewService
      .createAtomicDiffReview({
        sessionId,
        workspace: session.workspace,
        prompt: createRoundInputTranscript(session, round),
        aiResponse: {
          sessionId,
          content: getRoundAssistantOutput(session, round),
          trace: getRoundExecutionTrace(session, round),
          rawEvents: [],
        },
        round: this.roundService.refreshRoundDiff(review),
        models: request.models,
      })
      .then(async (atomicReview) => {
        await this.store.updateRoundAtomicReview(sessionId, round, atomicReview);
        const updatedSession = await this.getExistingSession(sessionId, "round.review.not_found");

        this.runRegistry.emitRunEvent(runningRun, {
          type: "run.succeeded",
          session: await this.toSessionView(updatedSession),
        });
      })
      .catch((error: unknown) => {
        void this.logger.framework.error("round.review.failed", {
          sessionId,
          round,
          error,
        });
        this.runRegistry.emitRunEvent(runningRun, {
          type: "run.failed",
          error: error instanceof Error ? error.message : "Round review failed",
        });
      });

    return toRunningSubmittedRun(runningRun, await this.toSessionView(session, runningRun.id));
  }

  async hasKnownRun(runId: string): Promise<boolean> {
    if (this.runRegistry.hasRunningRun(runId)) {
      return true;
    }

    const sessions = await this.store.listSessions();

    return sessions.some((session) =>
      session.queuedPrompts?.some((queuedPrompt) => queuedPrompt.id === runId),
    );
  }

  async cancelRun(runId: string): Promise<void> {
    const run = this.runRegistry.getRunningRun(runId);

    if (!run) {
      throw new RunNotFoundError(runId);
    }

    run.cancel();
    await Promise.race([run.completion, delay(5000)]);
  }

  subscribeToRun(runId: string, onEvent: (event: RunStreamEvent) => void): () => void {
    return this.runRegistry.subscribeToRun(runId, onEvent);
  }

  async resumeQueuedPrompts(): Promise<void> {
    const sessions = await this.store.listSessions();

    sessions
      .filter((session) => (session.queuedPrompts?.length ?? 0) > 0)
      .forEach((session) => this.scheduleNextQueuedPrompt(session.id));
  }

  private async startAssistantRun(
    session: ChatSession,
    request: AssistantRunInput,
    options: StartRunOptions = {},
  ): Promise<SubmittedRun> {
    const workspace = await assertExistingDirectory(session.workspace);
    const userMessage = createMessage("user", request.prompt);
    const updatedSession = await this.store.appendMessages(session.id, [userMessage]);
    const bufferedEvents: RunStreamEvent[] = [];
    let runningRun: RunningRun | undefined;
    const onAiRunEvent = (event: AiRunEvent) => {
      handleAiRunEvent(event, (streamEvent) => {
        if (runningRun) {
          this.runRegistry.emitRunEvent(runningRun, streamEvent);
        } else {
          bufferedEvents.push(streamEvent);
        }
      });
    };
    const runInput = this.createChatRunInput(session, request, workspace);
    const run =
      runInput.kind === "continue"
        ? this.aiModel.continueSessionStream(runInput.input, onAiRunEvent)
        : this.aiModel.createSessionStream(runInput.input, onAiRunEvent);

    if (runInput.kind === "create") {
      void run.sessionId.catch(() => undefined);
    }

    runningRun = this.runRegistry.createRunningRun(session.id, "assistant_response", run.cancel, {
      runId: options.runId,
      createdAt: options.createdAt,
    });
    const summaryPromise = this.refreshSessionSummaryFromUserInput(
      updatedSession,
      runningRun,
      request.models,
    );

    bufferedEvents.forEach((event) => this.runRegistry.emitRunEvent(runningRun!, event));
    this.finishAssistantRun(request, run.result, runningRun, workspace, summaryPromise, {
      bindAiThreadId: runInput.kind === "create",
    });

    return toRunningSubmittedRun(
      runningRun,
      await this.toSessionView(updatedSession, runningRun.id),
    );
  }

  private async startShellCommandRun(
    session: ChatSession,
    request: ShellCommandRunInput,
    options: StartRunOptions = {},
  ): Promise<SubmittedRun> {
    const workspace = await assertExistingDirectory(session.workspace);
    const userMessage = createMessage("user", request.command);
    const updatedSession = await this.store.appendMessages(session.id, [userMessage]);
    const shellRun = this.startShellRun({
      sessionId: session.id,
      workspace,
      command: request.command,
      runId: options.runId,
      createdAt: options.createdAt,
    });

    return toRunningSubmittedRun(
      shellRun.run,
      await this.toSessionView(updatedSession, shellRun.run.id),
    );
  }

  private async enqueuePrompt(sessionId: string, input: QueuedPromptInput): Promise<SubmittedRun> {
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

    return toQueuedSubmittedRun({
      queuedPrompt,
      session: await this.toSessionView(updatedSession),
    });
  }

  private scheduleNextQueuedPrompt(sessionId: string): void {
    void this.enqueueSessionOperation(sessionId, async () => {
      if (this.runRegistry.isSessionActive(sessionId)) {
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
      const runOptions = {
        runId: queuedPrompt.id,
        createdAt: queuedPrompt.createdAt,
      };

      if (queuedPrompt.mode === "shell") {
        await this.startShellCommandRun(session, { command: queuedPrompt.prompt }, runOptions);
        return;
      }

      await this.startAssistantRun(
        session,
        {
          prompt: queuedPrompt.prompt,
          models: queuedPrompt.models,
        },
        runOptions,
      );
    }).catch((error: unknown) => {
      void this.logger.framework.error("session.queue.failed", {
        sessionId,
        error,
      });
    });
  }

  private shouldQueuePrompt(session: ChatSession): boolean {
    return this.runRegistry.isSessionActive(session.id) || (session.queuedPrompts?.length ?? 0) > 0;
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

  private finishAssistantRun(
    request: AssistantRunInput,
    result: Promise<AiRunResult>,
    run: RunningRun,
    workspace: string,
    summaryPromise: Promise<ChatSession>,
    options: { bindAiThreadId?: boolean } = {},
  ): void {
    result
      .then(async (aiResponse) => {
        if (options.bindAiThreadId) {
          await this.store.updateSessionAiThreadId(
            run.sessionId,
            aiResponse.sessionId,
            request.models?.harness,
          );
        }

        const session = await this.runCompletionService.completeRun({
          workspace,
          prompt: request.prompt,
          aiResponse: {
            ...aiResponse,
            sessionId: run.sessionId,
          },
          models: request.models,
        });
        const latestSession =
          (await this.waitForInputSummary(summaryPromise, run.sessionId)) ?? session;

        this.runRegistry.emitRunEvent(run, {
          type: "run.succeeded",
          session: latestSession,
        });
        this.scheduleNextQueuedPrompt(run.sessionId);
      })
      .catch(async (error: unknown) => {
        if (error instanceof AiRunCancelledError) {
          void this.logger.framework.info("run.assistant.cancelled", {
            sessionId: run.sessionId,
          });
          await this.persistCancelledTrace(run);
          this.runRegistry.emitRunEvent(run, { type: "run.cancelled" });
          this.scheduleNextQueuedPrompt(run.sessionId);
          return;
        }

        void this.logger.framework.error("run.assistant.failed", {
          sessionId: run.sessionId,
          error,
        });
        this.runRegistry.emitRunEvent(run, {
          type: "run.failed",
          error: error instanceof Error ? error.message : "Assistant run failed",
        });
        this.scheduleNextQueuedPrompt(run.sessionId);
      });
  }

  private createChatRunInput(
    session: ChatSession,
    request: AssistantRunInput,
    workspace: string,
  ):
    | {
        kind: "continue";
        input: {
          sessionId: string;
          workspace: string;
          prompt: string;
          models?: AiModelPreferences;
        };
      }
    | {
        kind: "create";
        input: {
          workspace: string;
          prompt: string;
          models?: AiModelPreferences;
        };
      } {
    const aiThreadId = session.aiThreadId;

    if (aiThreadId) {
      const models = {
        ...request.models,
        ...(session.aiHarness ? { harness: session.aiHarness } : {}),
      };

      return {
        kind: "continue",
        input: {
          sessionId: aiThreadId,
          workspace,
          prompt: request.prompt,
          models,
        },
      };
    }

    return {
      kind: "create",
      input: {
        workspace,
        prompt: createSessionInputTranscript(session, request.prompt),
        models: request.models,
      },
    };
  }

  private startShellRun(input: {
    sessionId: string;
    workspace: string;
    command: string;
    runId?: string;
    createdAt?: string;
  }): {
    run: RunningRun;
  } {
    let run: RunningRun | undefined;
    const bufferedEvents: RunStreamEvent[] = [];
    const emit = (event: RunStreamEvent) => {
      if (run) {
        this.runRegistry.emitRunEvent(run, event);
      } else {
        bufferedEvents.push(event);
      }
    };
    const shellRun = this.shellCommandRunner.run(input.command, {
      cwd: input.workspace,
      onEvent: (event) => {
        if (event.type === "started") {
          emit({
            type: "run.trace",
            event: createShellTraceEvent("item.started", input.command, {
              status: "in_progress",
            }),
          });
          return;
        }

        emit({ type: "run.output.delta", text: event.text });
      },
    });

    run = this.runRegistry.createRunningRun(input.sessionId, "shell_command", shellRun.cancel, {
      runId: input.runId,
      createdAt: input.createdAt,
    });
    bufferedEvents.forEach((event) => this.runRegistry.emitRunEvent(run!, event));
    this.finishShellRun(input, shellRun.result, run);

    return { run };
  }

  private finishShellRun(
    input: {
      sessionId: string;
      workspace: string;
      command: string;
    },
    result: Promise<ShellCommandResult>,
    run: RunningRun,
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

        this.runRegistry.emitRunEvent(run, {
          type: "run.trace",
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

        this.runRegistry.emitRunEvent(run, {
          type: "run.succeeded",
          session: sessionView,
        });
        this.scheduleNextQueuedPrompt(run.sessionId);
      })
      .catch((error: unknown) => {
        void this.logger.framework.error("shell.command.failed", {
          sessionId: input.sessionId,
          error,
        });
        this.runRegistry.emitRunEvent(run, {
          type: "run.failed",
          error: error instanceof Error ? error.message : "Shell command failed",
        });
        this.scheduleNextQueuedPrompt(run.sessionId);
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
    run?: RunningRun,
    models?: AiModelPreferences,
  ): Promise<ChatSession> {
    return this.sessionSummaryService
      .refreshSessionSummary(session, models)
      .then(async (updatedSession) => {
        if (run && !run.completed && updatedSession !== session) {
          this.runRegistry.emitRunEvent(run, {
            type: "session.updated",
            session: await this.toSessionView(updatedSession, run.id),
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

  private async persistCancelledTrace(run: RunningRun): Promise<void> {
    const rawEvents = run.events.flatMap(({ event }) =>
      event.type === "run.trace" ? [event.event] : [],
    );

    if (rawEvents.length === 0) {
      return;
    }

    try {
      await this.store.appendMessages(run.sessionId, [
        createMessage("assistant", formatRawEvents(rawEvents), "trace"),
      ]);
    } catch (error) {
      void this.logger.session(run.sessionId).warn("session.cancelled_trace.persist_failed", {
        sessionId: run.sessionId,
        error,
      });
    }
  }

  private async toSessionView(
    session: ChatSession,
    runningRunId = this.runRegistry.getRunningRunIdForSession(session.id),
  ): Promise<ChatSessionView> {
    return toSessionView(session, {
      gitBranch: await this.getWorkspaceBranch(session.workspace),
      runningRunId,
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

export class RunNotFoundError extends Error {
  constructor(runId: string) {
    super(`Run not found: ${runId}`);
    this.name = "RunNotFoundError";
  }
}

export class RoundReviewNotFoundError extends Error {
  constructor(sessionId: string, round: number) {
    super(`Round review not found: ${sessionId}:${round}`);
    this.name = "RoundReviewNotFoundError";
  }
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

function handleAiRunEvent(event: AiRunEvent, emit: (event: RunStreamEvent) => void): void {
  if (event.type === "delta") {
    emit({ type: "run.output.delta", text: event.text });
    return;
  }

  if (event.type === "raw") {
    emit({ type: "run.trace", event: event.event });
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
