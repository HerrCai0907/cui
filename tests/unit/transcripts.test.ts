import assert from "node:assert/strict";
import test from "node:test";
import { createSummaryPrompt } from "../../apps/api/src/domain/sessions/transcripts.js";
import type { ChatMessage, ChatSession } from "../../apps/api/src/types.js";

test("createSummaryPrompt grows summary history from three to eight turns", () => {
  const prompt = createSummaryPrompt(createSession(8));

  assert.match(prompt, /用户：user 1/);
  assert.match(prompt, /助手：assistant 1/);
  assert.match(prompt, /用户：user 8/);
  assert.match(prompt, /助手：assistant 8/);
});

test("createSummaryPrompt resets to the latest three turns after eight turns", () => {
  const prompt = createSummaryPrompt(createSession(9));

  assert.doesNotMatch(prompt, /用户：user 1/);
  assert.doesNotMatch(prompt, /助手：assistant 6/);
  assert.match(prompt, /用户：user 7/);
  assert.match(prompt, /助手：assistant 7/);
  assert.match(prompt, /用户：user 9/);
  assert.match(prompt, /助手：assistant 9/);
});

test("createSummaryPrompt appends new turns within the refreshed cache window", () => {
  const nineTurnPrompt = createSummaryPrompt(createSession(9));
  const tenTurnPrompt = createSummaryPrompt(createSession(10));
  const expectedSharedWindow = [
    "用户：user 7",
    "助手：assistant 7",
    "用户：user 8",
    "助手：assistant 8",
    "用户：user 9",
    "助手：assistant 9",
  ].join("\n\n");

  assert.match(nineTurnPrompt, new RegExp(escapeRegExp(expectedSharedWindow)));
  assert.match(tenTurnPrompt, new RegExp(escapeRegExp(expectedSharedWindow)));
  assert.match(tenTurnPrompt, /用户：user 10/);
  assert.match(tenTurnPrompt, /助手：assistant 10/);
});

test("createSummaryPrompt excludes execution trace messages", () => {
  const prompt = createSummaryPrompt({
    ...createSession(3),
    messages: [
      ...createTurn(1),
      message("assistant", "hidden execution trace", "trace"),
      ...createTurn(2),
      ...createTurn(3),
    ],
  });

  assert.doesNotMatch(prompt, /hidden execution trace/);
  assert.match(prompt, /用户：user 1/);
  assert.match(prompt, /助手：assistant 3/);
});

function createSession(turnCount: number): ChatSession {
  return {
    id: "session-1",
    workspace: "/workspace",
    title: "Session title",
    summary: "",
    createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T00:00:00.000Z",
    messages: Array.from({ length: turnCount }, (_, index) => createTurn(index + 1)).flat(),
  };
}

function createTurn(turn: number): ChatMessage[] {
  return [message("user", `user ${turn}`), message("assistant", `assistant ${turn}`, "response")];
}

function message(
  role: ChatMessage["role"],
  content: string,
  kind?: ChatMessage["kind"],
): ChatMessage {
  return {
    id: `${role}-${content}`,
    role,
    ...(kind ? { kind } : {}),
    content,
    createdAt: "2026-08-29T00:00:00.000Z",
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
