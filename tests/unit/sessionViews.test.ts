import assert from "node:assert/strict";
import test from "node:test";
import {
  createSessionMessagesPage,
  toSessionView,
} from "../../apps/api/src/domain/sessions/sessionViews.js";
import type { ChatMessage, ChatSession } from "../../apps/api/src/types.js";

test("toSessionView can return only the latest message window", () => {
  const view = toSessionView(createSession(5), {
    messages: {
      window: "tail",
      limit: 2,
    },
  });

  assert.deepEqual(
    view.messages.map((message) => message.id),
    ["message-4", "message-5"],
  );
  assert.deepEqual(view.messagePageInfo, {
    total: 5,
    returned: 2,
    hasMoreBefore: true,
    hasMoreAfter: false,
    oldestMessageId: "message-4",
    newestMessageId: "message-5",
  });
});

test("createSessionMessagesPage returns messages before a cursor", () => {
  const page = createSessionMessagesPage(createMessages(5), {
    beforeMessageId: "message-4",
    limit: 2,
  });

  assert.deepEqual(
    page.messages.map((message) => message.id),
    ["message-2", "message-3"],
  );
  assert.deepEqual(page.pageInfo, {
    total: 5,
    returned: 2,
    hasMoreBefore: true,
    hasMoreAfter: true,
    oldestMessageId: "message-2",
    newestMessageId: "message-3",
  });
});

test("createSessionMessagesPage returns an empty page for an unknown cursor", () => {
  const page = createSessionMessagesPage(createMessages(3), {
    beforeMessageId: "missing-message",
    limit: 2,
  });

  assert.deepEqual(page.messages, []);
  assert.deepEqual(page.pageInfo, {
    total: 3,
    returned: 0,
    hasMoreBefore: false,
    hasMoreAfter: true,
  });
});

function createSession(messageCount: number): ChatSession {
  return {
    id: "session-1",
    workspace: "/workspace",
    title: "Session title",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    messages: createMessages(messageCount),
  };
}

function createMessages(count: number): ChatMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `message-${index + 1}`,
    role: index % 2 === 0 ? "user" : "assistant",
    content: `message ${index + 1}`,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
  }));
}
