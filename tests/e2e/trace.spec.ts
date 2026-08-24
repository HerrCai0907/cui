import { expect, test } from "@playwright/test";

import { currentWorkspace, mockSession, mockSessions, showExecutionTraceTypes } from "./helpers";

test("renders updated todo list items in the execution trace", async ({ page }) => {
  const traceEvents = [
    {
      type: "thread.started",
      thread_id: "01a02bcd-24e4-7193-a9d9-f7f2c58ae3e0",
    },
    { type: "turn.started" },
    {
      type: "item.started",
      item: {
        id: "item_0",
        type: "todo_list",
        items: [
          { text: "A", completed: false },
          { text: "B", completed: false },
        ],
      },
    },
    {
      type: "item.completed",
      item: {
        id: "item_1",
        type: "agent_message",
        text: "已添加两个 todo task：A、B。现在我把它们改成 C、D。",
      },
    },
    {
      type: "item.updated",
      item: {
        id: "item_0",
        type: "todo_list",
        items: [
          { text: "C", completed: false },
          { text: "D", completed: false },
        ],
      },
    },
    {
      type: "item.completed",
      item: {
        id: "item_2",
        type: "agent_message",
        text: "已把 todo task 改成 C、D。接着标记 C 完成。",
      },
    },
    {
      type: "item.updated",
      item: {
        id: "item_0",
        type: "todo_list",
        items: [
          { text: "C", completed: true },
          { text: "D", completed: false },
        ],
      },
    },
    {
      type: "item.completed",
      item: {
        id: "item_0",
        type: "todo_list",
        items: [
          { text: "C", completed: true },
          { text: "D", completed: false },
        ],
      },
    },
  ];
  const session = {
    id: "session-trace-todo",
    workspace: currentWorkspace,
    title: "Trace todo session",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    messages: [
      {
        id: "trace-message-1",
        role: "assistant",
        kind: "trace",
        content: traceEvents.map((event) => JSON.stringify(event)).join("\n"),
        createdAt: "2026-08-22T00:00:00.000Z",
      },
    ],
    rounds: [],
  };

  await showExecutionTraceTypes(page, ["todo_list"]);
  await mockSessions(page, [session]);
  await mockSession(page, session);

  await page.goto("/");
  await page.getByText("Show execution trace").click();

  const todoPanel = page.getByLabel("Todo list");

  await expect(todoPanel).toBeVisible();
  await expect(todoPanel.getByText("1/2 done")).toBeVisible();
  await expect(todoPanel.locator("li.is-completed", { hasText: "C" })).toBeVisible();
  await expect(todoPanel.locator("li:not(.is-completed)", { hasText: "D" })).toBeVisible();
  await expect(page.locator(".trace-event-todo")).toHaveCount(0);
  await expect(page.getByText("updated / 0/2 done")).toHaveCount(0);
  await expect(page.getByText("Unknown item")).toHaveCount(0);
});

test("configures execution trace message visibility", async ({ page }) => {
  const traceEvents = [
    {
      type: "item.completed",
      item: {
        id: "item_assistant",
        type: "agent_message",
        text: "Visible assistant trace.",
      },
    },
    {
      type: "item.completed",
      item: {
        id: "item_command",
        type: "command_execution",
        command: "npm test -- --runInBand",
        status: "completed",
        exit_code: 0,
      },
    },
  ];
  const session = {
    id: "session-trace-config",
    workspace: currentWorkspace,
    title: "Trace config session",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    messages: [
      {
        id: "trace-message-config",
        role: "assistant",
        kind: "trace",
        content: traceEvents.map((event) => JSON.stringify(event)).join("\n"),
        createdAt: "2026-08-22T00:00:00.000Z",
      },
    ],
    rounds: [],
  };

  await mockSessions(page, [session]);
  await mockSession(page, session);

  await page.goto("/");
  await page.getByText("Show execution trace").click();

  await expect(page.getByText("Visible assistant trace.")).toBeVisible();
  await expect(page.getByText("npm test -- --runInBand")).not.toBeVisible();

  await page.getByRole("button", { name: "Config", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Execution Trace" })).toBeVisible();
  await expect(page.getByLabel("Assistant Message")).toBeChecked();
  await expect(page.getByLabel("Command Execution")).not.toBeChecked();

  await page.locator(".config-toggle-row", { hasText: "Command Execution" }).click();
  await expect(page.getByLabel("Command Execution")).toBeChecked();
  await page.getByRole("button", { name: "Trace config session" }).click();

  await expect(page.getByText("Visible assistant trace.")).toBeVisible();
  await expect(page.getByText("npm test -- --runInBand")).toBeVisible();
});

test("renders command execution output collapsed without a command label prefix", async ({
  page,
}) => {
  const traceEvents = [
    {
      type: "item.completed",
      item: {
        id: "item_command",
        type: "command_execution",
        command: "npm test -- --runInBand",
        status: "completed",
        exit_code: 0,
        aggregated_output: "suite passed\nall tests passed",
      },
    },
  ];
  const session = {
    id: "session-trace-command",
    workspace: currentWorkspace,
    title: "Trace command session",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    messages: [
      {
        id: "trace-message-command",
        role: "assistant",
        kind: "trace",
        content: traceEvents.map((event) => JSON.stringify(event)).join("\n"),
        createdAt: "2026-08-22T00:00:00.000Z",
      },
    ],
    rounds: [],
  };

  await showExecutionTraceTypes(page, ["command_execution"]);
  await mockSessions(page, [session]);
  await mockSession(page, session);

  await page.goto("/");
  await page.getByText("Show execution trace").click();

  const commandRow = page.locator(".trace-event", {
    hasText: "npm test -- --runInBand",
  });
  await expect(commandRow.locator(".trace-event-header strong")).toHaveText(
    "npm test -- --runInBand",
  );
  await expect(page.getByText("Command: npm test -- --runInBand")).toHaveCount(0);
  await expect(commandRow.locator("pre")).not.toBeVisible();

  await commandRow.getByText("Output").click();

  await expect(commandRow.locator("pre")).toBeVisible();
  await expect(commandRow.locator("pre")).toContainText("suite passed");
});

test("renders reasoning collapsed and file changes as file paths", async ({ page }) => {
  const traceEvents = [
    {
      type: "item.completed",
      item: {
        id: "item_reasoning",
        type: "reasoning",
        text: "Detailed private reasoning text.",
      },
    },
    {
      type: "item.completed",
      item: {
        id: "item_file_change",
        type: "file_change",
        changes: [
          {
            path: "/data01/home/caicongcong/botmux/ROG/library/runtime/src/scheduler.rs",
            kind: "update",
          },
        ],
        status: "completed",
      },
    },
  ];
  const session = {
    id: "session-trace-reasoning-file-change",
    workspace: currentWorkspace,
    title: "Trace reasoning and file change session",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    messages: [
      {
        id: "trace-message-reasoning-file-change",
        role: "assistant",
        kind: "trace",
        content: traceEvents.map((event) => JSON.stringify(event)).join("\n"),
        createdAt: "2026-08-22T00:00:00.000Z",
      },
    ],
    rounds: [],
  };

  await showExecutionTraceTypes(page, ["reasoning", "file_change"]);
  await mockSessions(page, [session]);
  await mockSession(page, session);

  await page.goto("/");
  await page.getByText("Show execution trace").click();

  const reasoningRow = page.locator(".trace-event", { hasText: "Reasoning" });
  await expect(reasoningRow.locator("pre")).not.toBeVisible();

  await reasoningRow.getByText("Details").click();

  await expect(reasoningRow.locator("pre")).toBeVisible();
  await expect(reasoningRow.locator("pre")).toContainText("Detailed private reasoning text.");
  await expect(
    page.getByText(
      "File Change: /data01/home/caicongcong/botmux/ROG/library/runtime/src/scheduler.rs",
    ),
  ).toBeVisible();
  await expect(page.getByText('"originalType": "file_change"')).toHaveCount(0);
  await expect(
    page.locator(".trace-event-header strong", { hasText: /^File Change$/ }),
  ).toHaveCount(0);
});
