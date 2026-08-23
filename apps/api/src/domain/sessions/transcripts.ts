import type { ChatMessage, ChatSession } from "../../types.js";
import { createMessage } from "./sessionMessages.js";

export function createSummaryPrompt(session: ChatSession): string {
  const recentMessages = selectRecentTurnMessages(
    session.messages.filter((message) => message.kind !== "trace"),
  );
  const transcript = recentMessages
    .map((message) => `${message.role === "user" ? "用户" : "助手"}：${message.content}`)
    .join("\n\n");

  return [
    "请根据下面的对话历史生成当前会话摘要。只输出 JSON，不要输出 Markdown 或解释。",
    "",
    "要求：",
    "1. title：对话标题，30 个中文字符以内。",
    "2. progress：当前进展，200 个中文字符以内，说明已经讨论/完成到哪里、下一步关键上下文。",
    "3. 只基于给定历史，不要补充未知事实。",
    "",
    `工作区：${session.workspace}`,
    "",
    "对话历史：",
    transcript || "无",
    "",
    '输出格式：{"title":"...","progress":"..."}',
  ].join("\n");
}

export function createSessionInputTranscript(
  session: ChatSession | undefined,
  currentPrompt: string,
): string {
  const messages = [...(session?.messages ?? [])];
  const hasCurrentPrompt = messages.some(
    (message) => message.role === "user" && message.content === currentPrompt,
  );

  if (!hasCurrentPrompt) {
    messages.push(createMessage("user", currentPrompt));
  }

  const transcript = messages
    .filter((message) => message.kind !== "trace")
    .map((message) => {
      const role = message.role === "user" ? "用户" : "助手";

      return `${role}：${message.content}`;
    })
    .join("\n\n");

  return transcript || currentPrompt;
}

export function createRoundInputTranscript(session: ChatSession, round: number): string {
  const responseIndex = findRoundResponseIndex(session, round);
  const messages =
    responseIndex === -1 ? session.messages : session.messages.slice(0, responseIndex);
  const transcript = messages
    .filter((message) => message.kind !== "trace")
    .map((message) => {
      const role = message.role === "user" ? "用户" : "助手";

      return `${role}：${message.content}`;
    })
    .join("\n\n");

  return transcript || getRoundUserInput(session, round);
}

export function getRoundExecutionTrace(session: ChatSession, round: number): string {
  const responseIndex = findRoundResponseIndex(session, round);
  const searchEnd = responseIndex === -1 ? session.messages.length : responseIndex;

  for (let index = searchEnd - 1; index >= 0; index -= 1) {
    const message = session.messages[index];

    if (message.kind === "trace") {
      return message.content;
    }

    if (message.kind === "response") {
      break;
    }
  }

  return "";
}

export function getRoundAssistantOutput(session: ChatSession, round: number): string {
  const responseIndex = findRoundResponseIndex(session, round);

  return responseIndex === -1 ? "" : session.messages[responseIndex].content;
}

function getRoundUserInput(session: ChatSession, round: number): string {
  const responseIndex = findRoundResponseIndex(session, round);
  const searchEnd = responseIndex === -1 ? session.messages.length : responseIndex;

  for (let index = searchEnd - 1; index >= 0; index -= 1) {
    const message = session.messages[index];

    if (message.role === "user") {
      return message.content;
    }
  }

  return "";
}

function findRoundResponseIndex(session: ChatSession, round: number): number {
  return session.messages.findIndex(
    (message) =>
      message.role === "assistant" && message.kind === "response" && message.round === round,
  );
}

function selectRecentTurnMessages(messages: ChatMessage[]): ChatMessage[] {
  let userTurns = 0;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") {
      userTurns += 1;

      if (userTurns === 4) {
        return messages.slice(index);
      }
    }
  }

  return messages;
}
