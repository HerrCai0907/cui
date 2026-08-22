import type {
  AiModel,
  AiResponse,
  AtomicDiffReview,
  ChatRound,
} from '../../types.js';
import type { AppLogger } from '../../infrastructure/logging/AppLogger.js';

export class AtomicReviewService {
  constructor(
    private readonly aiModel: AiModel,
    private readonly logger: AppLogger,
  ) {}

  async createAtomicDiffReview(input: {
    sessionId: string;
    workspace: string;
    prompt: string;
    aiResponse: AiResponse;
    round: ChatRound;
  }): Promise<AtomicDiffReview> {
    try {
      const review = await this.aiModel.createAtomicDiffReview({
        workspace: input.workspace,
        originalSessionId: input.sessionId,
        round: input.round.round,
        sessionInput: input.prompt,
        executionTrace: input.aiResponse.trace ?? '',
        assistantOutput: input.aiResponse.content,
        diff: input.round.diff,
      });

      await this.logger.session(input.sessionId).info('round.review.created', {
        sessionId: input.sessionId,
        round: input.round.round,
        status: review.status,
        itemCount: review.status === 'ready' ? review.items.length : 0,
      });

      return review;
    } catch (error) {
      await this.logger.session(input.sessionId).warn('round.review.failed', {
        sessionId: input.sessionId,
        round: input.round.round,
        error,
      });

      return {
        status: 'failed',
        generatedAt: new Date().toISOString(),
        error:
          error instanceof Error
            ? error.message
            : 'Failed to create atomic diff review',
      };
    }
  }
}
