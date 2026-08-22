import type { AiRunResult, ChatSession } from '../../types.js';
import type { JsonSessionStore } from '../../infrastructure/store/JsonSessionStore.js';
import type { AppLogger } from '../../infrastructure/logging/AppLogger.js';
import { AtomicReviewService } from '../reviews/AtomicReviewService.js';
import { RoundService } from '../reviews/RoundService.js';
import { createAssistantMessages } from './sessionMessages.js';
import { toSessionView } from './sessionViews.js';
import { createSessionInputTranscript } from './transcripts.js';
import { SessionSummaryService } from './SessionSummaryService.js';

export type TurnCompletionKind = 'create' | 'continue';

export class TurnCompletionService {
  constructor(
    private readonly store: JsonSessionStore,
    private readonly logger: AppLogger,
    private readonly roundService: RoundService,
    private readonly atomicReviewService: AtomicReviewService,
    private readonly sessionSummaryService: SessionSummaryService,
  ) {}

  async completeTurn(input: {
    kind: TurnCompletionKind;
    workspace: string;
    prompt: string;
    aiResponse: AiRunResult;
  }) {
    const currentSession = await this.store.getSession(input.aiResponse.sessionId);
    const round = this.roundService.createNextRound(
      currentSession,
      input.aiResponse,
    );

    if (round?.hasChanges) {
      round.atomicReview =
        await this.atomicReviewService.createAtomicDiffReview({
          sessionId: input.aiResponse.sessionId,
          workspace: input.workspace,
          prompt: createSessionInputTranscript(currentSession, input.prompt),
          aiResponse: input.aiResponse,
          round,
        });
    }

    const assistantMessages = createAssistantMessages(input.aiResponse, round);
    const updatedSession = await this.store.appendRoundAndMessages(
      input.aiResponse.sessionId,
      round,
      assistantMessages,
    );
    const session =
      await this.sessionSummaryService.refreshSessionSummary(updatedSession);

    await this.logCompletedTurn(input);

    return toSessionView(session);
  }

  private async logCompletedTurn(input: {
    kind: TurnCompletionKind;
    workspace: string;
    prompt: string;
    aiResponse: AiRunResult;
  }): Promise<void> {
    const sessionEvent =
      input.kind === 'create' ? 'session.created' : 'session.continued';
    const frameworkEvent =
      input.kind === 'create'
        ? 'session.create.completed'
        : 'session.continue.completed';

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
