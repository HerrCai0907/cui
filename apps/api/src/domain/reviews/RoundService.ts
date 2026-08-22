import type { AiResponse, ChatRound, ChatSession } from '../../types.js';
import { GitDiffService } from '../../infrastructure/diff/GitDiffService.js';

export class RoundService {
  constructor(private readonly diffService = new GitDiffService()) {}

  createNextRound(
    session: ChatSession | undefined,
    aiResponse: AiResponse,
  ): ChatRound | undefined {
    const lastRound = session?.rounds?.at(-1);
    const nextRoundNumber = (lastRound?.round ?? 0) + 1;

    return this.createRound(aiResponse, nextRoundNumber);
  }

  createRound(
    aiResponse: AiResponse,
    roundNumber: number,
  ): ChatRound | undefined {
    if (!aiResponse.gitDiff) {
      return undefined;
    }

    const beforeDiff = aiResponse.gitDiff.beforeDiff;
    const afterDiff = aiResponse.gitDiff.afterDiff;
    const diff = this.diffService.createRoundDiff(beforeDiff, afterDiff);

    return {
      round: roundNumber,
      beforeDiff,
      afterDiff,
      diff,
      hasChanges: this.diffService.hasChanges(diff),
      createdAt: new Date().toISOString(),
    };
  }

  refreshRoundDiff(round: ChatRound): ChatRound {
    const diff = this.diffService.createRoundDiff(
      round.beforeDiff,
      round.afterDiff,
    );

    return {
      ...round,
      diff,
      hasChanges: this.diffService.hasChanges(diff),
    };
  }
}
