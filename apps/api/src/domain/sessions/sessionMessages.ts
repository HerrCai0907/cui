import { randomUUID } from "node:crypto";
import type { AiResponse, ChatMessage, ChatRound } from "../../types.js";

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
