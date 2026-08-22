import type { AiModel, ChatSession } from '../../types.js';
import type { AppLogger } from '../../infrastructure/logging/AppLogger.js';
import type { JsonSessionStore } from '../../infrastructure/store/JsonSessionStore.js';
import { createSummaryPrompt } from './transcripts.js';

export class SessionSummaryService {
  constructor(
    private readonly aiModel: AiModel,
    private readonly store: JsonSessionStore,
    private readonly logger: AppLogger,
  ) {}

  async refreshSessionSummary(session: ChatSession): Promise<ChatSession> {
    try {
      const summary = await this.aiModel.summarizeConversation({
        workspace: session.workspace,
        prompt: createSummaryPrompt(session),
      });

      return this.store.updateSessionSummary(session.id, {
        title: summary.title,
        summary: summary.progress,
      });
    } catch (error) {
      void this.logger.session(session.id).warn('session.summary.failed', {
        sessionId: session.id,
        error,
      });

      return session;
    }
  }
}
