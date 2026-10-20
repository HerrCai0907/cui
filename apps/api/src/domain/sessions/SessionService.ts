import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AiModel,
  AiModelPreferences,
  AiRunEvent,
  AiRunResult,
  AiRunCancelledError,
  AiHarness,
  ChatMessage,
  ChatRound,
  DiffFilePage,
  ChatSessionMessagesPage,
  ChatSession,
  ChatSessionListItem,
  ChatSessionView,
  QueuedPrompt,
  RoundReview,
  SessionListPage,
} from "../../types.js";
import type {
  ListRunEventsOptions,
  PersistedRunStreamEvent,
  SessionStore,
  StoredRunStreamEvent,
} from "../../infrastructure/store/SessionStore.js";
import { AppLogger } from "../../infrastructure/logging/AppLogger.js";
import { createMessage, formatNormalModelLabel } from "./sessionMessages.js";
import {
  createSessionMessagesPage,
  toSessionListItem,
  toSessionView,
  type SessionMessageWindowOptions,
} from "./sessionViews.js";
import {
  createRoundInputTranscript,
  createSessionInputTranscript,
  getRoundAssistantOutput,
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
  GetSessionMessagesQueryContract,
  GetSessionQueryContract,
  UpdateSessionRequestContract,
} from "../../contracts/apiSchemas.js";
import { GitDiffService } from "../../infrastructure/diff/GitDiffService.js";
import {
  DiffArtifactService,
  type DiffPageOptions,
} from "../../infrastructure/diff/DiffArtifactService.js";
import {
  ShellCommandRunner,
  type ShellCommandResult,
} from "../../infrastructure/shell/ShellCommandRunner.js";
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

export type GetSessionViewOptions = GetSessionQueryContract;

export type GetSessionMessagesOptions = GetSessionMessagesQueryContract;

const SESSION_MESSAGE_WINDOW_LIMIT = 2;

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

type PreparedAssistantRunInput =
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
      bindAiThreadId: boolean;
      aiHarness?: AiHarness;
      cleanup?: () => Promise<void>;
    };

function toSessionMessageWindowOptions(
  options: GetSessionViewOptions,
): SessionMessageWindowOptions | undefined {
  if (
    options.messageWindow === undefined &&
    options.messageLimit === undefined &&
    options.traceMessageTypes === undefined
  ) {
    return undefined;
  }

  return {
    window: options.messageWindow,
    limit: options.messageLimit,
    traceMessageTypes: options.traceMessageTypes,
  };
}

export class SessionService {
  private readonly runRegistry: RunRegistry;
  private readonly sessionOperationQueues = new Map<string, Promise<void>>();
  private readonly diffArtifacts: DiffArtifactService;

  constructor(
    private readonly aiModel: AiModel,
    private readonly store: SessionStore,
    private readonly logger = new AppLogger(),
    private readonly roundService = new RoundService(),
    private readonly atomicReviewService = new AtomicReviewService(aiModel, logger, store),
    diffArtifactService = new DiffArtifactService(store.getArtifactDirectoryPath()),
    private readonly sessionSummaryService = new SessionSummaryService(aiModel, store, logger),
    private readonly runCompletionService = new RunCompletionService(
      store,
      logger,
      roundService,
      atomicReviewService,
      diffArtifactService ?? new DiffArtifactService(store.getArtifactDirectoryPath()),
    ),
    private readonly gitDiffService = new GitDiffService(),
    private readonly shellCommandRunner = new ShellCommandRunner(),
  ) {
    this.diffArtifacts = diffArtifactService;
    this.runRegistry = new RunRegistry(store);
  }

  async listSessions(): Promise<ChatSession[]> {
    return this.store.listSessions();
  }

  async listSessionViews(
    options: ListSessionViewsOptions = {},
  ): Promise<SessionListPage<ChatSessionListItem>> {
    const page = await this.store.listSessionIndexEntries(options);
    const gitInfoByWorkspace = new Map<
      string,
      ReturnType<GitDiffService["captureWorkspaceGitInfo"]>
    >();

    return {
      ...page,
      sessions: await Promise.all(
        page.sessions.map(async (session) => {
          const gitInfo = await this.getWorkspaceGitInfo(session.workspace, gitInfoByWorkspace);

          return toSessionListItem(session, {
            gitBranch: gitInfo.branch,
            gitCommitSha: gitInfo.commitSha,
            runningRunId: this.runRegistry.getRunningRunIdForSession(session.id),
          });
        }),
      ),
    };
  }

  async getSession(sessionId: string): Promise<ChatSession | undefined> {
    return this.store.getSession(sessionId);
  }

  async getSessionView(
    sessionId: string,
    options: GetSessionViewOptions = {},
  ): Promise<ChatSessionView | undefined> {
    const session = await this.store.getSession(sessionId);

    return session
      ? this.toSessionView(session, undefined, toSessionMessageWindowOptions(options))
      : undefined;
  }

  async getSessionMessages(
    sessionId: string,
    options: GetSessionMessagesOptions = {},
  ): Promise<ChatSessionMessagesPage | undefined> {
    const session = await this.store.getSession(sessionId);

    return session
      ? createSessionMessagesPage(session.messages, {
          beforeMessageId: options.beforeMessageId,
          limit: options.limit,
          traceMessageTypes: options.traceMessageTypes,
        })
      : undefined;
  }

  async createSessionContainer(request: CreateSessionRequest): Promise<ChatSessionView> {
    const workspace = await assertExistingDirectory(request.workspace);
    const now = new Date().toISOString();
    const sessionId = randomUUID();
    const origin = request.origin ?? "chat";
    const session: ChatSession = {
      id: sessionId,
      origin,
      ...(request.models ? { models: request.models } : {}),
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
    let session = await this.store.getSession(sessionId);

    if (!session) {
      throw new SessionNotFoundError(sessionId);
    }

    if (request.done !== undefined) {
      const doneAt = request.done ? new Date().toISOString() : undefined;

      session = await this.store.updateSessionDoneAt(sessionId, doneAt);
    }

    if (request.models !== undefined) {
      session = await this.store.updateSessionModels(sessionId, request.models);
    }

    return this.toWindowedSessionView(session);
  }

  async withdrawQueuedPrompts(
    sessionId: string,
    queuedPromptId: string,
  ): Promise<{ session: ChatSessionView; queuedPrompts: QueuedPrompt[] }> {
    const result = await this.enqueueSessionOperation(sessionId, () =>
      this.store.truncateQueuedPromptsFrom(sessionId, queuedPromptId),
    );

    if (!result) {
      throw new SessionNotFoundError(sessionId);
    }

    if (result.removedPrompts.length === 0) {
      throw new QueuedPromptNotFoundError(sessionId, queuedPromptId);
    }

    await this.logger.framework.info("session.prompt.withdrawn", {
      sessionId,
      queuedPromptId,
      count: result.removedPrompts.length,
    });

    return {
      session: await this.toWindowedSessionView(result.session),
      queuedPrompts: result.removedPrompts,
    };
  }

  async getRoundReview(sessionId: string, round: number): Promise<RoundReview | undefined> {
    const session = await this.store.getSession(sessionId);

    if (!session) {
      return undefined;
    }

    let review = session.rounds?.find((current) => current.round === round);

    if (!review) {
      return undefined;
    }

    review = this.roundService.refreshRoundDiff(review);
    const diffSummary = await this.diffArtifacts.getRoundDiffSummary({
      sessionId,
      round,
      diff: review.diff,
    });
    const atomicReview = await this.diffArtifacts.createAtomicReviewView({
      sessionId,
      round,
      review: review.atomicReview,
    });
    const {
      beforeDiff: _beforeDiff,
      afterDiff: _afterDiff,
      diff: _diff,
      ...lightweightReview
    } = review;

    return {
      ...lightweightReview,
      ...(diffSummary ? { diffSummary } : {}),
      ...(atomicReview ? { atomicReview } : {}),
    };
  }

  async getRoundDiffFilePage(
    sessionId: string,
    round: number,
    fileId: string,
    options: DiffPageOptions = {},
  ): Promise<DiffFilePage | undefined> {
    const session = await this.store.getSession(sessionId);

    if (!session) {
      return undefined;
    }

    const review = session.rounds?.find((current) => current.round === round);

    if (!review) {
      return undefined;
    }

    const refreshedReview = this.roundService.refreshRoundDiff(review);

    return this.diffArtifacts.getRoundDiffFilePage({
      sessionId,
      round,
      fileId,
      diff: refreshedReview.diff,
      options,
    });
  }

  async getAtomicReviewItemDiffFilePage(
    sessionId: string,
    round: number,
    itemId: string,
    fileId: string,
    options: DiffPageOptions = {},
  ): Promise<DiffFilePage | undefined> {
    const session = await this.store.getSession(sessionId);

    if (!session) {
      return undefined;
    }

    const review = session.rounds?.find((current) => current.round === round);
    const item =
      review?.atomicReview?.status === "ready"
        ? review.atomicReview.items.find((current) => current.id === itemId)
        : undefined;

    if (!item) {
      return undefined;
    }

    return this.diffArtifacts.getAtomicReviewItemDiffFilePage({
      sessionId,
      round,
      itemId,
      fileId,
      itemDiff: item.diff,
      options,
    });
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
          models: request.models ?? session.models,
        });
      }

      return this.startAssistantRun(session, {
        prompt: request.input.prompt,
        models: request.models ?? session.models,
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
          traceRunId: review.traceRunId,
          rawEventCount: 0,
        },
        round: this.roundService.refreshRoundDiff(review),
        models: request.models,
      })
      .then(async (atomicReview) => {
        const persistedReview = await this.diffArtifacts.persistAtomicReview({
          sessionId,
          round,
          review: atomicReview,
        });

        await this.store.updateRoundAtomicReview(sessionId, round, persistedReview);
        const updatedSession = await this.getExistingSession(sessionId, "round.review.not_found");

        this.runRegistry.emitRunEvent(runningRun, {
          type: "run.succeeded",
          session: await this.toWindowedSessionView(updatedSession),
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

    return (await this.store.hasQueuedPrompt(runId)) || (await this.store.hasRunEvents(runId));
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

  subscribeToRunEvents(runId: string, onEvent: (event: StoredRunStreamEvent) => void): () => void {
    return this.runRegistry.subscribeToRunEvents(runId, onEvent);
  }

  listRunEvents(runId: string, options?: ListRunEventsOptions): Promise<PersistedRunStreamEvent[]> {
    return this.store.listRunEvents(runId, options);
  }

  async resumeQueuedPrompts(): Promise<void> {
    const sessionIds = await this.store.listQueuedSessionIds();

    sessionIds.forEach((sessionId) => this.scheduleNextQueuedPrompt(sessionId));
  }

  private async startAssistantRun(
    session: ChatSession,
    request: AssistantRunInput,
    options: StartRunOptions = {},
  ): Promise<SubmittedRun> {
    const workspace = await assertExistingDirectory(session.workspace);
    const runSession = request.models
      ? await this.store.updateSessionModels(session.id, request.models)
      : session;
    const userMessage = createMessage("user", request.prompt);
    const updatedSession = await this.store.appendMessages(runSession.id, [userMessage]);
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
    const runInput = await this.createChatRunInput(updatedSession, request, workspace);
    const run =
      runInput.kind === "continue"
        ? this.aiModel.continueSessionStream(runInput.input, onAiRunEvent)
        : this.aiModel.createSessionStream(runInput.input, onAiRunEvent);
    const runResult =
      runInput.kind === "create" && runInput.cleanup
        ? run.result.finally(() => {
            void runInput.cleanup?.().catch((error: unknown) => {
              void this.logger
                .session(runSession.id)
                .warn("session.harness_switch.cleanup_failed", {
                  sessionId: runSession.id,
                  error,
                });
            });
          })
        : run.result;

    if (runInput.kind === "create") {
      void run.sessionId.catch(() => undefined);
    }

    runningRun = this.runRegistry.createRunningRun(
      runSession.id,
      "assistant_response",
      run.cancel,
      {
        runId: options.runId,
        createdAt: options.createdAt,
      },
    );
    const inputSummaryPromise = this.refreshSessionSummary(
      updatedSession,
      runningRun,
      request.models,
    );

    bufferedEvents.forEach((event) => this.runRegistry.emitRunEvent(runningRun!, event));
    this.finishAssistantRun(request, runResult, runningRun, workspace, inputSummaryPromise, {
      bindAiThreadId: runInput.kind === "create" ? runInput.bindAiThreadId : false,
      aiHarness: runInput.kind === "create" ? runInput.aiHarness : undefined,
    });

    return toRunningSubmittedRun(
      runningRun,
      await this.toWindowedSessionView(updatedSession, runningRun.id),
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
      await this.toWindowedSessionView(updatedSession, shellRun.run.id),
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
      session: await this.toWindowedSessionView(updatedSession),
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
    inputSummaryPromise: Promise<ChatSession>,
    options: { bindAiThreadId?: boolean; aiHarness?: AiHarness } = {},
  ): void {
    result
      .then(async (aiResponse) => {
        if (options.bindAiThreadId && options.aiHarness !== "dsh") {
          await this.store.updateSessionAiThreadId(
            run.sessionId,
            aiResponse.sessionId,
            options.aiHarness,
          );
        }

        await this.runRegistry.flushRunEvents(run);
        const session = await this.runCompletionService.completeRun({
          workspace,
          prompt: request.prompt,
          aiResponse: {
            ...aiResponse,
            sessionId: run.sessionId,
            traceRunId: run.id,
          },
          models: request.models,
        });
        const completedSession = await this.store.getSession(run.sessionId);
        const completedSessionView = completedSession
          ? await this.toWindowedSessionView(completedSession, run.id)
          : session;

        this.runRegistry.emitRunEvent(run, {
          type: "session.updated",
          session: completedSessionView,
        });
        await inputSummaryPromise;
        const summaryBaseSession = (await this.store.getSession(run.sessionId)) ?? completedSession;
        const latestSession = summaryBaseSession
          ? await this.refreshSessionSummary(summaryBaseSession, run, request.models)
          : undefined;

        this.runRegistry.emitRunEvent(run, {
          type: "run.succeeded",
          session: latestSession
            ? await this.toWindowedSessionView(latestSession, run.id)
            : completedSessionView,
        });
        this.scheduleNextQueuedPrompt(run.sessionId);
      })
      .catch(async (error: unknown) => {
        if (error instanceof AiRunCancelledError) {
          void this.logger.framework.info("run.assistant.cancelled", {
            sessionId: run.sessionId,
          });
          await this.flushInterruptedRunEvents(run, "session.cancelled_trace.persist_failed");
          this.runRegistry.emitRunEvent(run, { type: "run.cancelled" });
          this.scheduleNextQueuedPrompt(run.sessionId);
          return;
        }

        void this.logger.framework.error("run.assistant.failed", {
          sessionId: run.sessionId,
          error,
        });
        await this.flushInterruptedRunEvents(run, "session.failed_trace.persist_failed");
        this.runRegistry.emitRunEvent(run, {
          type: "run.failed",
          error: error instanceof Error ? error.message : "Assistant run failed",
        });
        this.scheduleNextQueuedPrompt(run.sessionId);
      });
  }

  private async createChatRunInput(
    session: ChatSession,
    request: AssistantRunInput,
    workspace: string,
  ): Promise<PreparedAssistantRunInput> {
    const aiThreadId = session.aiThreadId;
    const targetHarness = this.resolveTargetHarness(session, request.models);

    if (aiThreadId && targetHarness !== "dsh" && this.canResumeAiThread(session, targetHarness)) {
      const models = this.createHarnessRunModels(session, request.models, targetHarness);

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

    const bridgeInput = aiThreadId
      ? await this.createHarnessSwitchInput(session, request.prompt)
      : undefined;

    return {
      kind: "create",
      input: {
        workspace,
        prompt: bridgeInput?.prompt ?? createSessionInputTranscript(session, request.prompt),
        models: this.createHarnessRunModels(session, request.models, targetHarness),
      },
      bindAiThreadId: targetHarness !== "dsh",
      aiHarness: targetHarness,
      cleanup: bridgeInput?.cleanup,
    };
  }

  private resolveTargetHarness(
    session: ChatSession,
    models: AiModelPreferences | undefined,
  ): AiHarness {
    return models?.harness ?? session.aiHarness ?? "traex";
  }

  private canResumeAiThread(session: ChatSession, targetHarness: AiHarness): boolean {
    return (session.aiHarness ?? "traex") === targetHarness;
  }

  private createHarnessRunModels(
    session: ChatSession,
    models: AiModelPreferences | undefined,
    targetHarness: AiHarness,
  ): AiModelPreferences | undefined {
    if (!models && !session.aiHarness) {
      return undefined;
    }

    return {
      ...models,
      ...(models?.harness || session.aiHarness ? { harness: targetHarness } : {}),
    };
  }

  private async createHarnessSwitchInput(
    session: ChatSession,
    currentPrompt: string,
  ): Promise<{ prompt: string; cleanup: () => Promise<void> }> {
    const directory = await mkdtemp(join(tmpdir(), "cui-session-history-"));
    const transcriptPath = join(directory, "history.txt");

    await writeFile(transcriptPath, createSessionInputTranscript(session, currentPrompt), "utf8");

    return {
      prompt: createHarnessSwitchPrompt(transcriptPath),
      cleanup: () => rm(directory, { force: true, recursive: true }),
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

        const sessionView = await this.toWindowedSessionView(updatedSession);

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

  private refreshSessionSummary(
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
            session: await this.toWindowedSessionView(updatedSession, run.id),
          });
        }

        return updatedSession;
      });
  }

  private async flushInterruptedRunEvents(run: RunningRun, failureLogEvent: string): Promise<void> {
    try {
      await this.runRegistry.flushRunEvents(run);
      await this.persistInterruptedTraceMessage(run);
    } catch (error) {
      void this.logger.session(run.sessionId).warn(failureLogEvent, {
        sessionId: run.sessionId,
        error,
      });
    }
  }

  private async persistInterruptedTraceMessage(run: RunningRun): Promise<void> {
    const session = await this.store.getSession(run.sessionId);

    if (!session || hasPersistedRunAssistantMessage(session, run, "trace")) {
      return;
    }

    const events = await this.listAllRunEvents(run.id);
    const traceMessage = createInterruptedTraceMessage(session, events);

    if (!traceMessage) {
      return;
    }

    await this.store.appendMessages(run.sessionId, [traceMessage]);
  }

  private async toSessionView(
    session: ChatSession,
    runningRunId = this.runRegistry.getRunningRunIdForSession(session.id),
    messages?: SessionMessageWindowOptions,
  ): Promise<ChatSessionView> {
    const gitInfo = await this.getWorkspaceGitInfo(session.workspace);
    const visibleSession = await this.applyPersistedRunningRunMessages(session, runningRunId);

    return toSessionView(visibleSession, {
      gitBranch: gitInfo.branch,
      gitCommitSha: gitInfo.commitSha,
      messages,
      runningRunId,
    });
  }

  private async toWindowedSessionView(
    session: ChatSession,
    runningRunId = this.runRegistry.getRunningRunIdForSession(session.id),
  ): Promise<ChatSessionView> {
    return this.toSessionView(session, runningRunId, {
      window: "tail",
      limit: SESSION_MESSAGE_WINDOW_LIMIT,
    });
  }

  private async applyPersistedRunningRunMessages(
    session: ChatSession,
    runningRunId: string | undefined,
  ): Promise<ChatSession> {
    if (!runningRunId) {
      return session;
    }

    const run = this.runRegistry.getRunningRun(runningRunId);

    if (!run || run.completed) {
      return session;
    }

    await run.persistence;
    const events = await this.listAllRunEvents(runningRunId);
    const overlay = createRunningRunMessageOverlay(session, run, events);

    if (overlay.length === 0) {
      return session;
    }

    return {
      ...session,
      messages: mergeRunningRunMessageOverlay(session.messages, run, overlay),
    };
  }

  private async listAllRunEvents(runId: string): Promise<PersistedRunStreamEvent[]> {
    const events: PersistedRunStreamEvent[] = [];
    let afterSeq = 0;

    while (true) {
      const page = await this.store.listRunEvents(runId, { afterSeq, limit: 1000 });

      if (page.length === 0) {
        return events;
      }

      events.push(...page);
      afterSeq = page.at(-1)!.id;
    }
  }

  private async getWorkspaceGitInfo(
    workspace: string,
    cache?: Map<string, ReturnType<GitDiffService["captureWorkspaceGitInfo"]>>,
  ): Promise<Awaited<ReturnType<GitDiffService["captureWorkspaceGitInfo"]>>> {
    const cachedInfo = cache?.get(workspace);

    if (cachedInfo) {
      return cachedInfo;
    }

    const gitInfo = this.gitDiffService.captureWorkspaceGitInfo(workspace);
    cache?.set(workspace, gitInfo);

    return gitInfo;
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

function createInterruptedTraceMessage(
  session: ChatSession,
  events: PersistedRunStreamEvent[],
): ChatMessage | undefined {
  const traceLines = events.flatMap(({ event }) => {
    if (event.type !== "run.trace") {
      return [];
    }

    const line = JSON.stringify(event.event);

    return line === undefined ? [] : [line];
  });

  if (traceLines.length === 0) {
    return undefined;
  }

  return createMessage(
    "assistant",
    traceLines.join("\n"),
    "trace",
    undefined,
    formatNormalModelLabel(session.models),
  );
}

export class QueuedPromptNotFoundError extends Error {
  constructor(sessionId: string, queuedPromptId: string) {
    super(`Queued prompt not found: ${sessionId}:${queuedPromptId}`);
    this.name = "QueuedPromptNotFoundError";
  }
}

export class RoundReviewNotFoundError extends Error {
  constructor(sessionId: string, round: number) {
    super(`Round review not found: ${sessionId}:${round}`);
    this.name = "RoundReviewNotFoundError";
  }
}

function createRunningRunMessageOverlay(
  session: ChatSession,
  run: RunningRun,
  events: PersistedRunStreamEvent[],
): ChatMessage[] {
  const hasPersistedTrace = hasPersistedRunAssistantMessage(session, run, "trace");
  const hasPersistedResponse = hasPersistedRunAssistantMessage(session, run, "response");
  const traceLines: string[] = [];
  let responseContent = "";
  let firstTraceCreatedAt: string | undefined;
  let firstResponseCreatedAt: string | undefined;

  for (const { event, createdAt } of events) {
    if (!hasPersistedTrace && event.type === "run.trace") {
      traceLines.push(JSON.stringify(event.event));
      firstTraceCreatedAt ??= createdAt;
    }

    if (!hasPersistedResponse && event.type === "run.output.delta" && event.text) {
      responseContent += event.text;
      firstResponseCreatedAt ??= createdAt;
    }
  }

  const messages: ChatMessage[] = [];
  const model = formatNormalModelLabel(session.models);

  if (traceLines.length > 0) {
    messages.push({
      id: `stream-${run.id}-trace`,
      role: "assistant",
      kind: "trace",
      ...(model ? { model } : {}),
      content: traceLines.join("\n"),
      createdAt: firstTraceCreatedAt ?? run.createdAt,
    });
  }

  if (responseContent) {
    messages.push({
      id: `stream-${run.id}-response`,
      role: "assistant",
      kind: "response",
      ...(model ? { model } : {}),
      content: responseContent,
      createdAt: firstResponseCreatedAt ?? run.createdAt,
    });
  }

  return messages;
}

function mergeRunningRunMessageOverlay(
  messages: ChatMessage[],
  run: RunningRun,
  overlay: ChatMessage[],
): ChatMessage[] {
  const traceMessage = overlay.find((message) => message.kind === "trace");
  const responseMessage = overlay.find((message) => message.kind === "response");

  if (!traceMessage) {
    return responseMessage ? [...messages, responseMessage] : messages;
  }

  const persistedResponseIndex = messages.findIndex(
    (message) =>
      message.role === "assistant" &&
      message.kind === "response" &&
      !message.id.startsWith("stream-") &&
      message.createdAt >= run.createdAt,
  );
  const insertionIndex = persistedResponseIndex === -1 ? messages.length : persistedResponseIndex;
  const nextMessages = [
    ...messages.slice(0, insertionIndex),
    traceMessage,
    ...messages.slice(insertionIndex),
  ];

  return responseMessage ? [...nextMessages, responseMessage] : nextMessages;
}

function hasPersistedRunAssistantMessage(
  session: ChatSession,
  run: RunningRun,
  kind: "response" | "trace",
): boolean {
  return session.messages.some(
    (message) =>
      message.role === "assistant" &&
      message.kind === kind &&
      !message.id.startsWith("stream-") &&
      message.createdAt >= run.createdAt,
  );
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

function createHarnessSwitchPrompt(transcriptPath: string): string {
  return [
    "系统提示：",
    "你正在接手一个已经存在的 CUI session，这次请求需要在新的 AI harness 中继续处理。",
    `临时历史文件路径: ${transcriptPath}`,
    "请先读取这个文件，把它作为当前 session 的完整历史上下文。",
    "文件末尾包含当前用户最新请求。不要要求用户重新提供历史，也不要只总结历史；请直接继续完成最新请求。",
  ].join("\n");
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
