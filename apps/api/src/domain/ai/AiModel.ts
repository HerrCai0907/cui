import type {
  AiAtomicDiffReviewInput,
  AiContinueSessionInput,
  AiCreateSessionInput,
  AiModelInfo,
  AiResponse,
  AiRun,
  AiRunEvent,
  AtomicDiffReview,
  ConversationSummary,
} from "../../types.js";

/** Common backend contract consumed by session services and HTTP routes. */
export interface AiModel {
  listModels(): Promise<AiModelInfo[]>;
  createSession(input: AiCreateSessionInput): Promise<AiResponse>;
  continueSession(input: AiContinueSessionInput): Promise<AiResponse>;
  createAtomicDiffReview(input: AiAtomicDiffReviewInput): Promise<AtomicDiffReview>;
  summarizeConversation(input: AiCreateSessionInput): Promise<ConversationSummary>;
  createSessionStream(input: AiCreateSessionInput, onEvent: (event: AiRunEvent) => void): AiRun;
  continueSessionStream(input: AiContinueSessionInput, onEvent: (event: AiRunEvent) => void): AiRun;
}
