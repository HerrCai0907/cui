import { expect, test } from "@playwright/test";

import {
  createSubmittedRunResponse,
  currentWorkspace,
  emitRunEvent,
  mockRpcMethod,
  mockSession,
  mockSessionById,
  mockSessions,
} from "./helpers";

type CreateRunRpcRequest =
  | { type: "assistant_response"; input: { prompt: string } }
  | { type: "shell_command"; input: { command: string } };

function readCreateRunRequest(params: unknown): CreateRunRpcRequest {
  return (params as { request: CreateRunRpcRequest }).request;
}

function readSubmittedPrompt(request: CreateRunRpcRequest) {
  return request.type === "shell_command" ? request.input.command : request.input.prompt;
}

function createCompletedTraceEvent(id: string, text: string) {
  return {
    type: "item.completed",
    item: {
      id,
      type: "agent_message",
      text,
    },
  };
}

test("keeps only the running session blocked while another run is active", async ({ page }) => {
  const sessionOne = {
    id: "session-1",
    workspace: currentWorkspace,
    title: "Running session",
    createdAt: "2026-08-22T00:00:01.000Z",
    updatedAt: "2026-08-22T00:00:01.000Z",
    messages: [],
    rounds: [],
  };
  const sessionTwo = {
    id: "session-2",
    workspace: currentWorkspace,
    title: "Other session",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    messages: [
      {
        id: "message-2",
        role: "assistant",
        kind: "response",
        content: "Available session",
        createdAt: "2026-08-22T00:00:00.000Z",
      },
    ],
    rounds: [],
  };
  const startedSessionOne = {
    ...sessionOne,
    messages: [
      {
        id: "message-1",
        role: "user",
        content: "Run a long task",
        createdAt: "2026-08-22T00:00:00.000Z",
      },
    ],
    currentRound: 0,
    isRunning: true,
    runningRunId: "run-1",
  };
  let sessionStarted = false;

  await mockSessions(page, () => [sessionStarted ? startedSessionOne : sessionOne, sessionTwo]);
  await mockSessionById(page, "session-1", () => (sessionStarted ? startedSessionOne : sessionOne));
  await mockSession(page, sessionTwo);
  await mockRpcMethod(page, "sessions.createRun", () => {
    sessionStarted = true;
    return createSubmittedRunResponse(startedSessionOne, "run-1");
  });

  await page.goto("/");
  await page.getByPlaceholder("Continue this session...").fill("Run a long task");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect(page.getByText("Waiting for the AI harness...")).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop generation" })).toBeEnabled();

  await page.getByRole("button", { name: "Other session" }).click();

  await expect(page.getByRole("heading", { name: "Other session" })).toBeVisible();
  await expect(page.getByText("Available session")).toBeVisible();
  await expect(page.getByText("Waiting for the AI harness...")).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();

  await page.getByRole("button", { name: "New session", exact: true }).click();

  await expect(page.getByRole("heading", { name: "New session" })).toBeVisible();
  await expect(page.getByPlaceholder("Start with an initial prompt...")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();

  await page.getByRole("button", { name: "Running session" }).click();

  await expect(page.getByRole("heading", { name: "Running session" })).toBeVisible();
  await expect(page.getByText("Waiting for the AI harness...")).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop generation" })).toBeEnabled();
});

test("stops a running session and restores the send button", async ({ page }) => {
  const initialSession = {
    id: "session-1",
    workspace: currentWorkspace,
    title: "Running session",
    createdAt: "2026-08-22T00:00:01.000Z",
    updatedAt: "2026-08-22T00:00:01.000Z",
    messages: [],
    rounds: [],
    currentRound: 0,
    isRunning: false,
  };
  const startedSession = {
    ...initialSession,
    messages: [
      {
        id: "message-1",
        role: "user",
        content: "Run a long task",
        createdAt: "2026-08-22T00:00:00.000Z",
      },
    ],
    isRunning: true,
    runningRunId: "run-1",
  };
  const stoppedSession = {
    ...startedSession,
    isRunning: false,
    runningRunId: undefined,
  };
  let running = false;
  let stopRequests = 0;

  await mockSessions(page, () => [running ? startedSession : stoppedSession]);
  await mockSessionById(page, "session-1", () => (running ? startedSession : stoppedSession));
  await mockRpcMethod(page, "sessions.createRun", () => {
    running = true;
    return createSubmittedRunResponse(startedSession, "run-1");
  });
  await mockRpcMethod(page, "runs.cancel", async () => {
    stopRequests += 1;
    running = false;
    await emitRunEvent(page, "run-1", { type: "run.cancelled" });
    return { status: "ok" };
  });

  await page.goto("/");
  await page.getByPlaceholder("Continue this session...").fill("Run a long task");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect(page.getByRole("button", { name: "Stop generation" })).toBeVisible();
  await emitRunEvent(page, "run-1", {
    type: "run.trace",
    event: {
      type: "item.completed",
      item: {
        id: "item-stop",
        type: "agent_message",
        text: "Trace before stop.",
      },
    },
  });
  await expect(page.getByText("Hide execution trace")).toBeVisible();
  await expect(page.getByText("Trace before stop.")).toBeVisible();

  await page.getByRole("button", { name: "Stop generation" }).click();

  await expect.poll(() => stopRequests).toBe(1);
  await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();
  await expect(page.getByText("Waiting for the AI harness...")).not.toBeVisible();
  await expect(page.getByText("Show execution trace")).toBeVisible();
  await expect(page.getByText("1 event / 1 message")).toBeVisible();
  await expect(page.getByText("Trace before stop.")).not.toBeVisible();

  await page.getByText("Show execution trace").click();
  await expect(page.getByText("Trace before stop.")).toBeVisible();
});

test("keeps streamed execution trace visible when a run fails", async ({ page }) => {
  const initialSession = {
    id: "session-1",
    workspace: currentWorkspace,
    title: "Failing session",
    createdAt: "2026-08-22T00:00:01.000Z",
    updatedAt: "2026-08-22T00:00:01.000Z",
    messages: [],
    rounds: [],
    currentRound: 0,
    isRunning: false,
  };
  const startedSession = {
    ...initialSession,
    messages: [
      {
        id: "message-1",
        role: "user",
        content: "Run until failure",
        createdAt: "2026-08-22T00:00:00.000Z",
      },
    ],
    isRunning: true,
    runningRunId: "run-1",
  };
  const failedSession = {
    ...startedSession,
    isRunning: false,
    runningRunId: undefined,
  };
  let running = false;

  await mockSessions(page, () => [running ? startedSession : failedSession]);
  await mockSessionById(page, "session-1", () => (running ? startedSession : failedSession));
  await mockRpcMethod(page, "sessions.createRun", () => {
    running = true;
    return createSubmittedRunResponse(startedSession, "run-1");
  });

  await page.goto("/");
  await page.getByPlaceholder("Continue this session...").fill("Run until failure");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect(page.getByRole("button", { name: "Stop generation" })).toBeVisible();

  running = false;
  await emitRunEvent(page, "run-1", {
    type: "run.trace",
    event: {
      type: "item.completed",
      item: {
        id: "item-failure",
        type: "agent_message",
        text: "Trace before failure.",
      },
    },
  });
  await emitRunEvent(page, "run-1", {
    type: "run.failed",
    error: "TraeX command produced no output for 1000ms",
  });

  await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();
  await expect(page.getByText("Waiting for the AI harness...")).not.toBeVisible();
  await expect(page.getByText(/Show execution trace|Hide execution trace/)).toBeVisible();
  await expect(page.getByText("1 event / 1 message")).toBeVisible();

  if (await page.getByText("Show execution trace").isVisible()) {
    await page.getByText("Show execution trace").click();
  }
  await expect(page.getByText("Trace before failure.")).toBeVisible();
});

test("queues a prompt while a session is running and sends it after stop", async ({ page }) => {
  const initialSession = {
    id: "session-1",
    workspace: currentWorkspace,
    title: "Running session",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    messages: [],
    rounds: [],
    currentRound: 0,
    isRunning: false,
  };
  const firstRunningSession = {
    ...initialSession,
    messages: [
      {
        id: "message-1",
        role: "user",
        content: "Run a long task",
        createdAt: "2026-08-22T00:00:00.000Z",
      },
    ],
    isRunning: true,
    runningRunId: "run-1",
  };
  const stoppedSession = {
    ...firstRunningSession,
    isRunning: false,
    runningRunId: undefined,
  };
  const queuedSession = {
    ...firstRunningSession,
    queuedPrompts: [
      {
        id: "queued-1",
        mode: "chat",
        prompt: "Queued follow-up",
        createdAt: "2026-08-22T00:00:01.000Z",
      },
    ],
  };
  const secondRunningSession = {
    ...stoppedSession,
    messages: [
      ...stoppedSession.messages,
      {
        id: "message-trace",
        role: "assistant",
        kind: "trace",
        content: JSON.stringify({
          type: "item.completed",
          item: {
            id: "item-stop",
            type: "agent_message",
            text: "Trace before stop.",
          },
        }),
        createdAt: "2026-08-22T00:00:01.000Z",
      },
      {
        id: "message-2",
        role: "user",
        content: "Queued follow-up",
        createdAt: "2026-08-22T00:00:01.000Z",
      },
    ],
    isRunning: true,
    runningRunId: "queued-1",
  };
  let visibleSession = initialSession;
  const prompts: string[] = [];

  await mockSessions(page, () => [visibleSession]);
  await mockSessionById(page, "session-1", () => visibleSession);
  await mockRpcMethod(page, "sessions.createRun", (params) => {
    const body = (params as { request: { input: { prompt: string } } }).request;

    prompts.push(body.input.prompt);
    visibleSession = prompts.length === 1 ? firstRunningSession : queuedSession;
    return prompts.length === 1
      ? createSubmittedRunResponse(visibleSession, "run-1")
      : createSubmittedRunResponse(visibleSession, "queued-1", { status: "queued" });
  });
  await mockRpcMethod(page, "runs.cancel", async () => {
    visibleSession = secondRunningSession;
    return { status: "ok" };
  });

  await page.goto("/");
  await page.getByPlaceholder("Continue this session...").fill("Run a long task");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect(page.getByRole("button", { name: "Stop generation" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();
  await emitRunEvent(page, "run-1", {
    type: "run.trace",
    event: {
      type: "item.completed",
      item: {
        id: "item-stop",
        type: "agent_message",
        text: "Trace before stop.",
      },
    },
  });
  await expect(page.getByText("Trace before stop.")).toBeVisible();

  await page.getByPlaceholder("Continue this session...").fill("Queued follow-up");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByPlaceholder("Continue this session...")).toHaveValue("");
  await expect(page.getByRole("region", { name: "Queued prompts" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Queued prompts" })).toContainText(
    "Queued follow-up",
  );
  await expect.poll(() => prompts).toEqual(["Run a long task", "Queued follow-up"]);

  await page.getByRole("button", { name: "Stop generation" }).click();

  await expect.poll(() => prompts).toEqual(["Run a long task", "Queued follow-up"]);
  await expect(page.getByRole("region", { name: "Queued prompts" })).not.toBeVisible();
  await expect(page.getByText("Queued follow-up")).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop generation" })).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator("[data-message-id]")
        .evaluateAll((messages) =>
          messages.map((message) => message.getAttribute("data-message-id")),
        ),
    )
    .toEqual(["message-1", "message-trace", "message-2"]);
  await page.getByText("Show execution trace").click();
  await expect(page.getByText("Trace before stop.")).toBeVisible();
});

test("edits a queued prompt by withdrawing it and later queued prompts", async ({ page }) => {
  const queuedPromptOne = {
    id: "queued-1",
    mode: "chat",
    prompt: "Keep first queued",
    createdAt: "2026-08-22T00:00:01.000Z",
  };
  const queuedPromptTwo = {
    id: "queued-2",
    mode: "shell",
    prompt: "printf old",
    createdAt: "2026-08-22T00:00:02.000Z",
  };
  const queuedPromptThree = {
    id: "queued-3",
    mode: "chat",
    prompt: "Old third",
    createdAt: "2026-08-22T00:00:03.000Z",
  };
  const initialSession = {
    id: "session-1",
    workspace: currentWorkspace,
    title: "Running session",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    messages: [
      {
        id: "message-1",
        role: "user",
        content: "Run a long task",
        createdAt: "2026-08-22T00:00:00.000Z",
      },
    ],
    rounds: [],
    queuedPrompts: [queuedPromptOne, queuedPromptTwo, queuedPromptThree],
    currentRound: 0,
    isRunning: true,
    runningRunId: "run-1",
  };
  const withdrawnSession = {
    ...initialSession,
    queuedPrompts: [queuedPromptOne],
  };
  const firstResubmittedSession = {
    ...withdrawnSession,
    queuedPrompts: [
      queuedPromptOne,
      {
        id: "queued-2-edited",
        mode: "shell",
        prompt: "printf edited",
        createdAt: "2026-08-22T00:00:04.000Z",
      },
    ],
  };
  const secondResubmittedSession = {
    ...firstResubmittedSession,
    queuedPrompts: [
      ...firstResubmittedSession.queuedPrompts,
      {
        id: "queued-3-edited",
        mode: "chat",
        prompt: "Edited third",
        createdAt: "2026-08-22T00:00:05.000Z",
      },
    ],
  };
  let visibleSession = initialSession;
  const withdrawnPromptIds: string[] = [];
  const submittedPrompts: Array<{ type: string; prompt: string }> = [];

  await mockSessions(page, () => [visibleSession]);
  await mockSessionById(page, "session-1", () => visibleSession);
  await mockRpcMethod(page, "sessions.withdrawQueuedPrompts", () => {
    withdrawnPromptIds.push("queued-2");
    visibleSession = withdrawnSession;
    return {
      session: withdrawnSession,
      queuedPrompts: [queuedPromptTwo, queuedPromptThree],
    };
  });
  await mockRpcMethod(page, "sessions.createRun", (params) => {
    const body = (
      params as {
        request:
          | { type: "assistant_response"; input: { prompt: string } }
          | { type: "shell_command"; input: { command: string } };
      }
    ).request;
    const submittedPrompt = body.type === "shell_command" ? body.input.command : body.input.prompt;

    submittedPrompts.push({
      type: body.type,
      prompt: submittedPrompt,
    });
    visibleSession =
      submittedPrompts.length === 1 ? firstResubmittedSession : secondResubmittedSession;
    return createSubmittedRunResponse(
      visibleSession,
      submittedPrompts.length === 1 ? "queued-2-edited" : "queued-3-edited",
      {
        status: "queued",
        type: body.type,
      },
    );
  });

  await page.goto("/");

  await expect(page.getByRole("region", { name: "Queued prompts" })).toContainText(
    "Keep first queued",
  );
  await expect(page.getByRole("region", { name: "Queued prompts" })).toContainText("printf old");
  await expect(page.getByRole("region", { name: "Queued prompts" })).toContainText("Old third");

  await page.getByRole("button", { name: "Edit queued prompt 2" }).click();

  await expect.poll(() => withdrawnPromptIds).toEqual(["queued-2"]);
  await expect(page.getByPlaceholder("Run a shell command...")).toHaveValue("printf old");
  await expect(page.getByRole("region", { name: "Queued prompts" })).toContainText(
    "Keep first queued",
  );
  await expect(page.getByRole("region", { name: "Queued prompts" })).not.toContainText(
    "printf old",
  );
  await expect(page.getByRole("region", { name: "Queued prompts" })).not.toContainText("Old third");

  await page.getByPlaceholder("Run a shell command...").fill("printf edited");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect
    .poll(() => submittedPrompts)
    .toEqual([
      {
        type: "shell_command",
        prompt: "printf edited",
      },
    ]);
  await expect(page.getByPlaceholder("Continue this session...")).toHaveValue("Old third");

  await page.getByPlaceholder("Continue this session...").fill("Edited third");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect
    .poll(() => submittedPrompts)
    .toEqual([
      {
        type: "shell_command",
        prompt: "printf edited",
      },
      {
        type: "assistant_response",
        prompt: "Edited third",
      },
    ]);
  await expect(page.getByPlaceholder("Continue this session...")).toHaveValue("");
  await expect(page.getByRole("region", { name: "Queued prompts" })).toContainText(
    "Keep first queued",
  );
  await expect(page.getByRole("region", { name: "Queued prompts" })).toContainText("printf edited");
  await expect(page.getByRole("region", { name: "Queued prompts" })).toContainText("Edited third");
});

test("queues a prompt while a session is running and sends it after completion", async ({
  page,
}) => {
  const initialSession = {
    id: "session-1",
    workspace: currentWorkspace,
    title: "Running session",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    messages: [],
    rounds: [],
    currentRound: 0,
    isRunning: false,
  };
  const firstRunningSession = {
    ...initialSession,
    messages: [
      {
        id: "message-1",
        role: "user",
        content: "Run a long task",
        createdAt: "2026-08-22T00:00:00.000Z",
      },
    ],
    isRunning: true,
    runningRunId: "run-1",
  };
  const firstCompletedSession = {
    ...firstRunningSession,
    messages: [
      ...firstRunningSession.messages,
      {
        id: "message-2",
        role: "assistant",
        kind: "response",
        content: "First response.",
        createdAt: "2026-08-22T00:00:01.000Z",
      },
    ],
    currentRound: 1,
    isRunning: false,
    runningRunId: undefined,
  };
  const queuedSession = {
    ...firstRunningSession,
    queuedPrompts: [
      {
        id: "queued-1",
        mode: "chat",
        prompt: "Queued follow-up",
        createdAt: "2026-08-22T00:00:02.000Z",
      },
    ],
  };
  const secondRunningSession = {
    ...firstCompletedSession,
    messages: [
      ...firstCompletedSession.messages,
      {
        id: "message-3",
        role: "user",
        content: "Queued follow-up",
        createdAt: "2026-08-22T00:00:02.000Z",
      },
    ],
    isRunning: true,
    runningRunId: "queued-1",
  };
  let visibleSession = initialSession;
  const prompts: string[] = [];

  await mockSessions(page, () => [visibleSession]);
  await mockSessionById(page, "session-1", () => visibleSession);
  await mockRpcMethod(page, "sessions.createRun", (params) => {
    const body = readCreateRunRequest(params);

    prompts.push(readSubmittedPrompt(body));
    visibleSession = prompts.length === 1 ? firstRunningSession : queuedSession;
    return prompts.length === 1
      ? createSubmittedRunResponse(visibleSession, "run-1")
      : createSubmittedRunResponse(visibleSession, "queued-1", { status: "queued" });
  });

  await page.goto("/");
  await page.getByPlaceholder("Continue this session...").fill("Run a long task");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect(page.getByRole("button", { name: "Stop generation" })).toBeVisible();
  await page.getByPlaceholder("Continue this session...").fill("Queued follow-up");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("region", { name: "Queued prompts" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Queued prompts" })).toContainText(
    "Queued follow-up",
  );
  await expect.poll(() => prompts).toEqual(["Run a long task", "Queued follow-up"]);

  visibleSession = secondRunningSession;
  await emitRunEvent(page, "run-1", { type: "run.succeeded", session: firstCompletedSession });

  await expect.poll(() => prompts).toEqual(["Run a long task", "Queued follow-up"]);
  await expect(page.getByRole("region", { name: "Queued prompts" })).not.toBeVisible();
  await expect(page.getByText("Queued follow-up")).toBeVisible();
});

test("restores streamed execution trace after switching back to a running session", async ({
  page,
}) => {
  const runningSession = {
    id: "session-1",
    workspace: currentWorkspace,
    title: "Running session",
    createdAt: "2026-08-22T00:00:01.000Z",
    updatedAt: "2026-08-22T00:00:01.000Z",
    messages: [
      {
        id: "message-1",
        role: "user",
        content: "Run a long task",
        createdAt: "2026-08-22T00:00:00.000Z",
      },
    ],
    rounds: [],
    currentRound: 0,
    isRunning: true,
    runningRunId: "run-1",
  };
  const otherSession = {
    id: "session-2",
    workspace: currentWorkspace,
    title: "Other session",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    messages: [
      {
        id: "message-2",
        role: "assistant",
        kind: "response",
        content: "Available session",
        createdAt: "2026-08-22T00:00:00.000Z",
      },
    ],
    rounds: [],
    currentRound: 1,
    isRunning: false,
  };

  await mockSessions(page, [runningSession, otherSession]);
  await mockSessionById(page, "session-1", runningSession);
  await mockSession(page, otherSession);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Running session" })).toBeVisible();
  await page.getByRole("button", { name: "Other session" }).click();
  await expect(page.getByRole("heading", { name: "Other session" })).toBeVisible();

  await emitRunEvent(page, "run-1", {
    type: "run.trace",
    event: createCompletedTraceEvent("item-hidden", "Hidden trace event."),
  });
  await expect(page.getByText("Show execution trace")).not.toBeVisible();

  await page.getByRole("button", { name: "Running session" }).click();
  await page.getByText("Show execution trace").click();

  await expect(page.getByText("Assistant message")).toBeVisible();
  await expect(page.getByText("Hidden trace event.")).toBeVisible();
});

test("highlights running and unread sidebar sessions", async ({ page }) => {
  const runningSession = {
    id: "session-1",
    workspace: currentWorkspace,
    title: "Running session",
    createdAt: "2026-08-22T00:00:01.000Z",
    updatedAt: "2026-08-22T00:00:01.000Z",
    messages: [
      {
        id: "message-1",
        role: "user",
        content: "Run a long task",
        createdAt: "2026-08-22T00:00:00.000Z",
      },
    ],
    rounds: [],
    currentRound: 0,
    isRunning: true,
    runningRunId: "run-1",
  };
  const completedSession = {
    ...runningSession,
    updatedAt: "2026-08-22T00:00:01.000Z",
    messages: [
      ...runningSession.messages,
      {
        id: "message-2",
        role: "assistant",
        kind: "response",
        content: "Finished while hidden.",
        createdAt: "2026-08-22T00:00:01.000Z",
      },
    ],
    currentRound: 1,
    isRunning: false,
    runningRunId: undefined,
  };
  const otherSession = {
    id: "session-2",
    workspace: currentWorkspace,
    title: "Other session",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    messages: [
      {
        id: "message-3",
        role: "assistant",
        kind: "response",
        content: "Other session response.",
        createdAt: "2026-08-22T00:00:00.000Z",
      },
    ],
    rounds: [],
    currentRound: 1,
    isRunning: false,
  };
  let sessionListRequests = 0;
  let runCompleted = false;

  await page.addInitScript(() => {
    (
      window as Window & {
        CuiAndroid?: {
          notifySessionCompleted: (sessionId: string, sessionTitle: string) => void;
        };
        __sessionCompletionNotifications?: Array<{ sessionId: string; sessionTitle: string }>;
      }
    ).__sessionCompletionNotifications = [];
    (
      window as Window & {
        CuiAndroid?: {
          notifySessionCompleted: (sessionId: string, sessionTitle: string) => void;
        };
        __sessionCompletionNotifications?: Array<{ sessionId: string; sessionTitle: string }>;
      }
    ).CuiAndroid = {
      notifySessionCompleted: (sessionId, sessionTitle) => {
        (
          window as Window & {
            __sessionCompletionNotifications?: Array<{
              sessionId: string;
              sessionTitle: string;
            }>;
          }
        ).__sessionCompletionNotifications?.push({ sessionId, sessionTitle });
      },
    };
  });

  await mockSessions(page, () => {
    sessionListRequests += 1;
    return [runCompleted ? completedSession : runningSession, otherSession];
  });
  await mockSessionById(page, "session-1", () =>
    runCompleted ? completedSession : runningSession,
  );
  await mockSession(page, otherSession);

  await page.goto("/");
  const runningButton = page.getByRole("button", { name: "Running session" });
  const otherButton = page.getByRole("button", { name: "Other session" });

  await expect(runningButton).toHaveClass(/is-running-session/);
  await expect(runningButton).not.toHaveClass(/is-unread-session/);
  await otherButton.click();
  await expect(page.getByRole("heading", { name: "Other session" })).toBeVisible();
  await expect(runningButton).toHaveClass(/is-running-session/);
  await expect(runningButton).not.toHaveClass(/is-unread-session/);
  await page.evaluate(() => localStorage.setItem("cui:session-last-seen-round:v1:session-1", "0"));
  runCompleted = true;
  await emitRunEvent(page, "run-1", { type: "run.succeeded", session: completedSession });
  await expect.poll(() => sessionListRequests).toBeGreaterThan(1);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __sessionCompletionNotifications?: Array<{
                sessionId: string;
                sessionTitle: string;
              }>;
            }
          ).__sessionCompletionNotifications,
      ),
    )
    .toEqual([{ sessionId: "session-1", sessionTitle: "Running session" }]);
  await expect(runningButton).not.toHaveClass(/is-running-session/);
  await expect(runningButton).toHaveClass(/is-unread-session/);
  await runningButton.click();
  await expect(runningButton).not.toHaveClass(/is-running-session/);
  await expect(runningButton).not.toHaveClass(/is-unread-session/);
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("cui:session-last-seen-round:v1:session-1")),
    )
    .toBe("1");
});

test("stays on new session when a background run completes", async ({ page }) => {
  const runningSession = {
    id: "session-1",
    workspace: currentWorkspace,
    title: "Running session",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    messages: [
      {
        id: "message-1",
        role: "user",
        content: "Run a long task",
        createdAt: "2026-08-22T00:00:00.000Z",
      },
    ],
    rounds: [],
    currentRound: 0,
    isRunning: true,
    runningRunId: "run-1",
  };
  const completedSession = {
    ...runningSession,
    updatedAt: "2026-08-22T00:00:01.000Z",
    messages: [
      ...runningSession.messages,
      {
        id: "message-2",
        role: "assistant",
        kind: "response",
        content: "Finished while on new session.",
        createdAt: "2026-08-22T00:00:01.000Z",
      },
    ],
    currentRound: 1,
    isRunning: false,
    runningRunId: undefined,
  };
  let runCompleted = false;

  await mockSessions(page, () => [runCompleted ? completedSession : runningSession]);
  await mockSessionById(page, "session-1", () =>
    runCompleted ? completedSession : runningSession,
  );

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Running session" })).toBeVisible();
  await page.getByRole("button", { name: "New session", exact: true }).click();
  await expect(page.getByRole("heading", { name: "New session" })).toBeVisible();

  runCompleted = true;
  await emitRunEvent(page, "run-1", { type: "run.succeeded", session: completedSession });

  await expect(page.getByRole("heading", { name: "New session" })).toBeVisible();
  await expect(page.getByText("Finished while on new session.")).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Running session" })).not.toHaveClass(
    /is-running-session/,
  );
});

test("clears stale sidebar running state from refreshed session data", async ({ page }) => {
  const initialSession = {
    id: "session-1",
    workspace: currentWorkspace,
    title: "Stale running session",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    messages: [],
    rounds: [],
    currentRound: 0,
    isRunning: false,
  };
  const startedSession = {
    ...initialSession,
    updatedAt: "2026-08-22T00:00:01.000Z",
    messages: [
      {
        id: "message-1",
        role: "user",
        content: "Run without a terminal stream event",
        createdAt: "2026-08-22T00:00:01.000Z",
      },
    ],
    isRunning: true,
    runningRunId: "run-1",
  };
  const completedSession = {
    ...startedSession,
    updatedAt: "2026-08-22T00:00:02.000Z",
    messages: [
      ...startedSession.messages,
      {
        id: "message-2",
        role: "assistant",
        kind: "response",
        content: "Finished from refreshed session data.",
        createdAt: "2026-08-22T00:00:02.000Z",
      },
    ],
    currentRound: 1,
    isRunning: false,
    runningRunId: undefined,
  };
  let runSubmitted = false;
  let sessionListRequests = 0;

  await mockSessions(page, () => {
    sessionListRequests += 1;
    return [runSubmitted ? completedSession : initialSession];
  });
  await mockRpcMethod(page, "sessions.createRun", () => {
    runSubmitted = true;
    return createSubmittedRunResponse(startedSession, "run-1");
  });

  await page.goto("/");
  const sessionButton = page.getByRole("button", { name: "Stale running session" });

  await expect(sessionButton).not.toHaveClass(/is-running-session/);
  await page
    .getByPlaceholder("Continue this session...")
    .fill("Run without a terminal stream event");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect.poll(() => sessionListRequests).toBeGreaterThan(1);
  await expect(sessionButton).not.toHaveClass(/is-running-session/);
  await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();
});

test("reconnects to a running run after page reload", async ({ page }) => {
  const runningSession = {
    id: "session-1",
    workspace: currentWorkspace,
    title: "Running session",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    messages: [
      {
        id: "message-1",
        role: "user",
        content: "Run a long task",
        createdAt: "2026-08-22T00:00:00.000Z",
      },
    ],
    rounds: [],
    currentRound: 0,
    isRunning: true,
    runningRunId: "run-1",
  };
  const completedSession = {
    ...runningSession,
    runningRunId: undefined,
    currentRound: 1,
    isRunning: false,
    messages: [
      ...runningSession.messages,
      {
        id: "message-2",
        role: "assistant",
        kind: "response",
        content: "Finished after reconnect.",
        createdAt: "2026-08-22T00:00:01.000Z",
      },
    ],
  };
  let runCompleted = false;
  const subscribedRuns: string[] = [];

  await mockSessions(page, () => {
    return [runCompleted ? completedSession : runningSession];
  });
  await mockSessionById(page, "session-1", () =>
    runCompleted ? completedSession : runningSession,
  );
  await mockRpcMethod(page, "runs.subscribe", async (params) => {
    const runId = String((params as { runId: string }).runId);

    subscribedRuns.push(runId);
    await emitRunEvent(page, runId, {
      type: "run.output.delta",
      text: "Recovered response",
    });
    runCompleted = true;
    await emitRunEvent(page, runId, {
      type: "run.succeeded",
      session: completedSession,
    });

    return { subscriptionId: `subscription-${runId}` };
  });

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Running session" })).toBeVisible();
  await expect(page.getByText("Finished after reconnect.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();
  await expect.poll(() => subscribedRuns).toContainEqual("run-1");
});

test("keeps replayed execution trace visible when reload receives a persisted response update", async ({
  page,
}) => {
  const runningSession = {
    id: "session-1",
    workspace: currentWorkspace,
    title: "Running trace session",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    messages: [
      {
        id: "message-1",
        role: "user",
        content: "Run a traced task",
        createdAt: "2026-08-22T00:00:00.000Z",
      },
    ],
    rounds: [],
    currentRound: 0,
    isRunning: true,
    runningRunId: "run-1",
  };
  const responseUpdatedSession = {
    ...runningSession,
    updatedAt: "2026-08-22T00:00:01.000Z",
    messages: [
      ...runningSession.messages,
      {
        id: "message-2",
        role: "assistant",
        kind: "response",
        content: "Persisted response after reload.",
        createdAt: "2026-08-22T00:00:01.000Z",
      },
    ],
    messagePageInfo: {
      total: 2,
      returned: 2,
      hasMoreBefore: false,
      hasMoreAfter: false,
      oldestMessageId: "message-1",
      newestMessageId: "message-2",
    },
  };

  await mockSessions(page, [runningSession]);
  await mockSessionById(page, "session-1", runningSession);
  await mockRpcMethod(page, "runs.subscribe", async (params) => {
    const runId = String((params as { runId: string }).runId);

    await emitRunEvent(page, runId, {
      type: "run.trace",
      event: createCompletedTraceEvent("trace-replayed", "Trace before reload."),
    });
    await emitRunEvent(page, runId, {
      type: "session.updated",
      session: responseUpdatedSession,
    });

    return { subscriptionId: `subscription-${runId}` };
  });

  await page.goto("/");

  const conversation = page.getByLabel("AI conversation");

  await expect(conversation.getByText("Persisted response after reload.")).toBeVisible();
  await expect(conversation.getByText("Trace before reload.")).toBeVisible();
});

test("applies summary updates without replacing streamed messages", async ({ page }) => {
  const initialSession = {
    id: "session-1",
    workspace: currentWorkspace,
    title: "Initial prompt",
    summary: "",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    messages: [
      {
        id: "message-1",
        role: "assistant",
        kind: "response",
        content: "Previous response.",
        createdAt: "2026-08-22T00:00:00.000Z",
      },
    ],
    rounds: [],
    currentRound: 0,
    isRunning: false,
  };
  const startedSession = {
    ...initialSession,
    messages: [
      ...initialSession.messages,
      {
        id: "message-2",
        role: "user",
        content: "Continue with a streamed summary test",
        createdAt: "2026-08-22T00:00:00.000Z",
      },
    ],
    isRunning: true,
    runningRunId: "run-1",
  };
  const summarizedSession = {
    ...startedSession,
    title: "Early summary title",
    summary: "Summary generated from the latest user input.",
    updatedAt: "2026-08-22T00:00:01.000Z",
  };
  let sessionListRequests = 0;

  await mockSessions(page, () => {
    sessionListRequests += 1;
    return sessionListRequests < 3 ? [initialSession] : [summarizedSession];
  });
  await mockRpcMethod(page, "sessions.createRun", () => {
    return createSubmittedRunResponse(startedSession, "run-1");
  });
  await mockSession(page, initialSession);

  await page.goto("/");
  await expect(page.getByText("Previous response.")).toBeVisible();
  await page
    .getByPlaceholder("Continue this session...")
    .fill("Continue with a streamed summary test");
  await page.getByRole("button", { name: "Send message" }).click();
  await emitRunEvent(page, "run-1", {
    type: "run.output.delta",
    text: "Streamed ",
  });
  await emitRunEvent(page, "run-1", {
    type: "session.updated",
    session: summarizedSession,
  });
  await emitRunEvent(page, "run-1", {
    type: "run.output.delta",
    text: "answer.",
  });

  const conversation = page.getByLabel("AI conversation");

  await expect(conversation.getByRole("heading", { name: "Early summary title" })).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: /Early summary title Summary generated from the latest user input\./,
    }),
  ).toBeVisible();
  await expect(conversation.getByText("Streamed answer.")).toBeVisible();
});

test("shows persisted assistant trace messages as soon as a run completes", async ({ page }) => {
  const initialSession = {
    id: "session-1",
    workspace: currentWorkspace,
    title: "Trace completion session",
    summary: "",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    messages: [],
    rounds: [],
    currentRound: 0,
    isRunning: false,
  };
  const startedSession = {
    ...initialSession,
    messages: [
      {
        id: "message-1",
        role: "user",
        content: "Show the completed trace",
        createdAt: "2026-08-22T00:00:00.000Z",
      },
    ],
    isRunning: true,
    runningRunId: "run-1",
  };
  const traceUpdatedSession = {
    id: "session-1",
    workspace: currentWorkspace,
    title: "Trace completion session",
    summary: "",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:01.000Z",
    messages: [
      {
        id: "message-2",
        role: "assistant",
        kind: "trace",
        content: JSON.stringify({
          type: "assistant_message",
          id: "assistant-message-1",
          phase: "completed",
          text: "Completed assistant trace.",
        }),
        createdAt: "2026-08-22T00:00:01.000Z",
      },
      {
        id: "message-3",
        role: "assistant",
        kind: "response",
        content: "Completed assistant response.",
        createdAt: "2026-08-22T00:00:01.000Z",
      },
    ],
    messagePageInfo: {
      total: 3,
      returned: 2,
      hasMoreBefore: true,
      hasMoreAfter: false,
      oldestMessageId: "message-2",
      newestMessageId: "message-3",
    },
    rounds: [],
    currentRound: 1,
    isRunning: true,
    runningRunId: "run-1",
  };

  await mockSessions(page, [initialSession]);
  await mockSession(page, initialSession);
  await mockRpcMethod(page, "sessions.createRun", () => {
    return createSubmittedRunResponse(startedSession, "run-1");
  });

  await page.goto("/");
  await page.getByPlaceholder("Continue this session...").fill("Show the completed trace");
  await page.getByRole("button", { name: "Send message" }).click();
  await emitRunEvent(page, "run-1", {
    type: "session.updated",
    session: traceUpdatedSession,
  });

  const conversation = page.getByLabel("AI conversation");

  await expect(conversation.getByText("Completed assistant response.")).toBeVisible();
  await expect(conversation.getByText("Show execution trace")).toBeVisible();
  await conversation.getByText("Show execution trace").click();
  await expect(conversation.getByText("Completed assistant trace.")).toBeVisible();
});
