import type { AiModelPreferences, AiRunResult, ChatRound, ChatSession } from "../../types.js";
import type { JsonSessionStore } from "../../infrastructure/store/JsonSessionStore.js";
import type { AppLogger } from "../../infrastructure/logging/AppLogger.js";
import { DiffArtifactService } from "../../infrastructure/diff/DiffArtifactService.js";
import { AtomicReviewService } from "../reviews/AtomicReviewService.js";
import { RoundService } from "../reviews/RoundService.js";
import { createAssistantMessages } from "./sessionMessages.js";
import { toSessionView } from "./sessionViews.js";
import { createSessionInputTranscript } from "./transcripts.js";

export class RunCompletionService {
  constructor(
    private readonly store: JsonSessionStore,
    private readonly logger: AppLogger,
    private readonly roundService: RoundService,
    private readonly atomicReviewService: AtomicReviewService,
    private readonly diffArtifactService = new DiffArtifactService(),
  ) {}

  async completeRun(input: {
    workspace: string;
    prompt: string;
    aiResponse: AiRunResult;
    models?: AiModelPreferences;
  }) {
    const currentSession = await this.store.getSession(input.aiResponse.sessionId);
    let round = this.roundService.createNextRound(currentSession, input.aiResponse);
    const reviewPrompt = round?.hasChanges
      ? createSessionInputTranscript(currentSession, input.prompt)
      : undefined;

    if (round?.hasChanges) {
      round = {
        ...round,
        diffSummary: await this.diffArtifactService.persistRoundDiff({
          sessionId: input.aiResponse.sessionId,
          round: round.round,
          diff: round.diff,
        }),
      };
    }

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

    await this.logCompletedRun(input);

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
      .then(async (atomicReview) => {
        const persistedReview = await this.diffArtifactService.persistAtomicReview({
          sessionId: input.sessionId,
          round: input.round.round,
          review: atomicReview,
        });

        return this.store.updateRoundAtomicReview(
          input.sessionId,
          input.round.round,
          persistedReview,
        );
      })
      .catch((error: unknown) =>
        this.logger.session(input.sessionId).warn("round.review.persist_failed", {
          sessionId: input.sessionId,
          round: input.round.round,
          error,
        }),
      );
  }

  private async logCompletedRun(input: {
    workspace: string;
    prompt: string;
    aiResponse: AiRunResult;
  }): Promise<void> {
    await this.logger.session(input.aiResponse.sessionId).info("run.assistant.completed", {
      sessionId: input.aiResponse.sessionId,
      workspace: input.workspace,
      prompt: input.prompt,
      response: input.aiResponse.content,
      rawEvents: input.aiResponse.rawEvents,
    });
    await this.logger.framework.info("run.assistant.completed", {
      sessionId: input.aiResponse.sessionId,
      workspace: input.workspace,
    });
  }
}
