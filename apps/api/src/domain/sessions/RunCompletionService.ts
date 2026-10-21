import type { AiModelPreferences, AiRunResult, ChatRound, ChatSession } from "../../types.js";
import type {
  PersistedRunStreamEvent,
  SessionStore,
} from "../../infrastructure/store/SessionStore.js";
import type { AppLogger } from "../../infrastructure/logging/AppLogger.js";
import { DiffArtifactService } from "../../infrastructure/diff/DiffArtifactService.js";
import { AtomicReviewService } from "../reviews/AtomicReviewService.js";
import { RoundService } from "../reviews/RoundService.js";
import {
  createAssistantMessages,
  createMessage,
  formatNormalModelLabel,
} from "./sessionMessages.js";
import { toSessionView } from "./sessionViews.js";
import { createSessionInputTranscript } from "./transcripts.js";

export class RunCompletionService {
  constructor(
    private readonly store: SessionStore,
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

    const model = formatNormalModelLabel(input.models);
    const traceMessage = await this.createExecutionTraceMessage(input.aiResponse.traceRunId, model);
    const assistantMessages = [
      ...(traceMessage ? [traceMessage] : []),
      ...createAssistantMessages(input.aiResponse, round, model),
    ];
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

  private async createExecutionTraceMessage(runId: string | undefined, model: string | undefined) {
    if (!runId) {
      return createMessage("assistant", "TRAEX run completed.", "trace", undefined, model);
    }

    const events = await this.listAllRunEvents(runId);
    const traceLines = events.flatMap(({ event }) => {
      if (event.type !== "run.trace") {
        return [];
      }

      const line = JSON.stringify(event.event);

      return line === undefined ? [] : [line];
    });

    return createMessage(
      "assistant",
      traceLines.length > 0 ? traceLines.join("\n") : "TRAEX run completed.",
      "trace",
      undefined,
      model,
    );
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
      responseLength: input.aiResponse.content.length,
      rawEventCount: input.aiResponse.rawEventCount,
      traceRunId: input.aiResponse.traceRunId,
    });
    await this.logger.framework.info("run.assistant.completed", {
      sessionId: input.aiResponse.sessionId,
      workspace: input.workspace,
    });
  }
}
