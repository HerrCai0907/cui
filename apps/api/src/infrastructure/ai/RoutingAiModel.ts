import type { AiModel } from "../../domain/ai/AiModel.js";
import type {
  AiAtomicDiffReviewInput,
  AiContinueSessionInput,
  AiCreateSessionInput,
  AiHarness,
  AiModelPreferences,
  AiRunEvent,
} from "../../types.js";

/** Selects a backend once per operation; each backend owns its entire workflow. */
export class RoutingAiModel implements AiModel {
  constructor(private readonly backends: Record<AiHarness, AiModel>) {}

  listModels() {
    // Preserve the existing model-list API, which supplies TraeX model choices.
    return this.backends.traex.listModels();
  }

  createSession(input: AiCreateSessionInput) {
    return this.select(input.models).createSession(input);
  }

  continueSession(input: AiContinueSessionInput) {
    return this.select(input.models).continueSession(input);
  }

  createSessionStream(input: AiCreateSessionInput, onEvent: (event: AiRunEvent) => void) {
    return this.select(input.models).createSessionStream(input, onEvent);
  }

  continueSessionStream(input: AiContinueSessionInput, onEvent: (event: AiRunEvent) => void) {
    return this.select(input.models).continueSessionStream(input, onEvent);
  }

  summarizeConversation(input: AiCreateSessionInput) {
    return this.select(input.models).summarizeConversation(input);
  }

  createAtomicDiffReview(input: AiAtomicDiffReviewInput) {
    return this.select(input.models).createAtomicDiffReview(input);
  }

  private select(models: AiModelPreferences | undefined): AiModel {
    return this.backends[models?.harness ?? "traex"];
  }
}
