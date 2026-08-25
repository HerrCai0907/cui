import type { AiModelPreferences, AiRunResult, ChatRound, ChatSession } from "../../types.js";
import type { JsonSessionStore } from "../../infrastructure/store/JsonSessionStore.js";
import type { AppLogger } from "../../infrastructure/logging/AppLogger.js";
import { AtomicReviewService } from "../reviews/AtomicReviewService.js";
import { RoundService } from "../reviews/RoundService.js";
import { createAssistantMessages } from "./sessionMessages.js";
import { toSessionView } from "./sessionViews.js";
import { createSessionInputTranscript } from "./transcripts.js";

export type TurnCompletionKind = "create" | "continue";

export class TurnCompletionService {
  constructor(
    private readonly store: JsonSessionStore,
    private readonly logger: AppLogger,
    private readonly roundService: RoundService,
    private readonly atomicReviewService: AtomicReviewService,
  ) {}

  async completeTurn(input: {
    kind: TurnCompletionKind;
    workspace: string;
    prompt: string;
    aiResponse: AiRunResult;
    models?: AiModelPreferences;
  }) {
    const currentSession = await this.store.getSession(input.aiResponse.sessionId);
    const round = this.roundService.createNextRound(currentSession, input.aiResponse);
    const reviewPrompt = round?.hasChanges
      ? createSessionInputTranscript(currentSession, input.prompt)
      : undefined;

    const assistantMessages = createAssistantMessages(input.aiResponse, round);
    const updatedSession = await this.store.appendRoundAndMessages(
      input.aiResponse.sessionId,
      round,
      assistantMessages,
    );

    if (round?.hasChanges && reviewPrompt) {
      this.scheduleAtomicReview({
        sessionId: input.aiResponse.sessionId,
        workspace: input.workspace,
        prompt: reviewPrompt,
        aiResponse: input.aiResponse,
        round,
        models: input.models,
      });
    }

    await this.logCompletedTurn(input);

    return toSessionView(updatedSession);
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

  private async logCompletedTurn(input: {
    kind: TurnCompletionKind;
    workspace: string;
    prompt: string;
    aiResponse: AiRunResult;
  }): Promise<void> {
    const sessionEvent = input.kind === "create" ? "session.created" : "session.continued";
    const frameworkEvent =
      input.kind === "create" ? "session.create.completed" : "session.continue.completed";

    await this.logger.session(input.aiResponse.sessionId).info(sessionEvent, {
      sessionId: input.aiResponse.sessionId,
      workspace: input.workspace,
      prompt: input.prompt,
      response: input.aiResponse.content,
      rawEvents: input.aiResponse.rawEvents,
    });
    await this.logger.framework.info(frameworkEvent, {
      sessionId: input.aiResponse.sessionId,
      workspace: input.workspace,
    });
  }
}
