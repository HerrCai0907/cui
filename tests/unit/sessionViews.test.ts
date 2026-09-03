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

test("createSessionMessagesPage filters trace content by message type", () => {
  const page = createSessionMessagesPage(
    [
      createMessages(1)[0],
      {
        id: "trace-message",
        role: "assistant",
        kind: "trace",
        content: [
          JSON.stringify({
            type: "item.completed",
            item: { id: "assistant", type: "agent_message", text: "visible assistant" },
          }),
          JSON.stringify({
            type: "item.completed",
            item: { id: "command", type: "command_execution", command: "hidden command" },
          }),
          JSON.stringify({
            type: "item.updated",
            item: { id: "todo", type: "todo_list", items: [{ text: "visible todo" }] },
          }),
          JSON.stringify({ type: "turn.completed" }),
          "plain stdout",
        ].join("\n"),
        createdAt: "2026-01-01T00:01:00.000Z",
      },
    ],
    {
      traceMessageTypes: ["assistant_message", "todo_list"],
    },
  );

  assert.deepEqual(page.messages[1]?.content.split("\n"), [
    JSON.stringify({
      type: "item.completed",
      item: { id: "assistant", type: "agent_message", text: "visible assistant" },
    }),
    JSON.stringify({
      type: "item.updated",
      item: { id: "todo", type: "todo_list", items: [{ text: "visible todo" }] },
    }),
  ]);
});

test("createSessionMessagesPage keeps full trace content when no trace filter is requested", () => {
  const traceContent = [
    JSON.stringify({
      type: "item.completed",
      item: { id: "assistant", type: "agent_message", text: "visible assistant" },
    }),
    JSON.stringify({
      type: "item.completed",
      item: { id: "command", type: "command_execution", command: "visible command" },
    }),
  ].join("\n");
  const page = createSessionMessagesPage([
    {
      id: "trace-message",
      role: "assistant",
      kind: "trace",
      content: traceContent,
      createdAt: "2026-01-01T00:01:00.000Z",
    },
  ]);

  assert.equal(page.messages[0]?.content, traceContent);
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
