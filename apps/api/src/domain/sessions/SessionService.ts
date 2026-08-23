import {
  AiModel,
  AiRunEvent,
  AiRunResult,
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

export type { TurnStreamEvent } from "../turns/turnEvents.js";

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
  ) {}

  async listSessions(): Promise<ChatSession[]> {
    return this.store.listSessions();
  }

  async listSessionViews(): Promise<ChatSessionView[]> {
    const sessions = await this.store.listSessions();

    return sessions.map((session) =>
      toSessionView(session, this.turnRegistry.getRunningTurnIdForSession(session.id)),
    );
  }

  async getSession(sessionId: string): Promise<ChatSession | undefined> {
    return this.store.getSession(sessionId);
  }

  async getSessionView(sessionId: string): Promise<ChatSessionView | undefined> {
    const session = await this.store.getSession(sessionId);

    return session
      ? toSessionView(session, this.turnRegistry.getRunningTurnIdForSession(session.id))
      : undefined;
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

    if (review.hasChanges && !review.atomicReview) {
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
    runningTurn = this.turnRegistry.createRunningTurn(sessionId);
    const summaryPromise = this.refreshSessionSummaryFromUserInput(createdSession, runningTurn);
    bufferedEvents.forEach((event) => this.turnRegistry.emitTurnEvent(runningTurn!, event));
    this.finishCreateSession(request, run.result, runningTurn, summaryPromise);

    return {
      session: toSessionView(createdSession, runningTurn.id),
      turnId: runningTurn.id,
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
    const runningTurn = this.turnRegistry.createRunningTurn(sessionId);
    const summaryPromise = this.refreshSessionSummaryFromUserInput(updatedSession, runningTurn);
    const run = this.aiModel.continueSessionStream(
      {
        sessionId,
        workspace: session.workspace,
        prompt: request.prompt,
      },
      (event) => {
        handleAiRunEvent(event, (streamEvent) =>
          this.turnRegistry.emitTurnEvent(runningTurn, streamEvent),
        );
      },
    );

    this.finishContinueSession(request, run.result, runningTurn, session.workspace, summaryPromise);

    return {
      session: toSessionView(updatedSession, runningTurn.id),
      turnId: runningTurn.id,
    };
  }

  hasRunningTurn(turnId: string): boolean {
    return this.turnRegistry.hasRunningTurn(turnId);
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
      .catch((error: unknown) => {
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
      .catch((error: unknown) => {
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

  private refreshSessionSummaryFromUserInput(
    session: ChatSession,
    turn?: RunningTurn,
  ): Promise<ChatSession> {
    return this.sessionSummaryService.refreshSessionSummary(session).then((updatedSession) => {
      if (turn && !turn.completed && updatedSession !== session) {
        this.turnRegistry.emitTurnEvent(turn, {
          type: "session.updated",
          session: toSessionView(updatedSession, turn.id),
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

    return latestSession ? toSessionView(latestSession) : undefined;
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

function handleAiRunEvent(event: AiRunEvent, emit: (event: TurnStreamEvent) => void): void {
  if (event.type === "delta") {
    emit({ type: "delta", text: event.text });
    return;
  }

  if (event.type === "raw") {
    emit({ type: "raw", event: event.event });
  }
}
