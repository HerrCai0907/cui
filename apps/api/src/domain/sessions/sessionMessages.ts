import { randomUUID } from "node:crypto";
import type {
  AiModelPreferences,
  AiReasoningEffort,
  AiResponse,
  ChatMessage,
  ChatRound,
} from "../../types.js";

const REASONING_EFFORT_LABELS: Record<AiReasoningEffort, string> = {
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "XHigh",
  max: "Max",
  ultra: "Ultra",
};

export function createMessage(
  role: ChatMessage["role"],
  content: string,
  kind?: ChatMessage["kind"],
  round?: number,
  model?: string,
): ChatMessage {
  return {
    id: randomUUID(),
    role,
    ...(kind ? { kind } : {}),
    ...(round ? { round } : {}),
    ...(model ? { model } : {}),
    content,
    createdAt: new Date().toISOString(),
  };
}

export function createAssistantMessages(
  aiResponse: Pick<AiResponse, "content" | "trace">,
  round?: ChatRound,
  model?: string,
): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const trace = aiResponse.trace?.trim() || "TRAEX run completed.";
  const content = aiResponse.content.trim();

  messages.push(createMessage("assistant", trace, "trace", undefined, model));

  if (content) {
    messages.push(createMessage("assistant", content, "response", round?.round, model));
  }

  return messages;
}

export function formatNormalModelLabel(models: AiModelPreferences | undefined): string | undefined {
  if (!models) {
    return undefined;
  }

  return formatModelLabel(models.normal, models.reasoningEfforts?.normal);
}

export function formatModelLabel(
  model: string | undefined,
  reasoningEffort: AiReasoningEffort | undefined,
): string | undefined {
  const trimmedModel = model?.trim();
  const reasoningEffortLabel = reasoningEffort ? REASONING_EFFORT_LABELS[reasoningEffort] : "";

  if (!trimmedModel && !reasoningEffortLabel) {
    return undefined;
  }

  return [trimmedModel || "Harness default", reasoningEffortLabel].filter(Boolean).join(" / ");
}
