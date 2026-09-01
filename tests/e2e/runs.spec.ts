import { expect, test } from "@playwright/test";

import {
  createSubmittedRunResponse,
  currentWorkspace,
  fulfillJson,
  mockSession,
  mockSessionById,
  mockSessions,
} from "./helpers";

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
  await page.route("**/api/v1/sessions/session-1/runs", async (route) => {
    sessionStarted = true;
    await fulfillJson(route, createSubmittedRunResponse(startedSessionOne, "run-1"));
  });
  await page.route("**/api/v1/runs/run-1/events", async () => {
    // Keep the stream open so session-1 remains blocked.
  });

  await page.goto("/");
  await page.getByPlaceholder("Continue this session...").fill("Run a long task");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect(page.getByText("Waiting for TRAEX...")).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop generation" })).toBeEnabled();

  await page.getByRole("button", { name: "Other session" }).click();

  await expect(page.getByRole("heading", { name: "Other session" })).toBeVisible();
  await expect(page.getByText("Available session")).toBeVisible();
  await expect(page.getByText("Waiting for TRAEX...")).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();

  await page.getByRole("button", { name: "New session", exact: true }).click();

  await expect(page.getByRole("heading", { name: "New session" })).toBeVisible();
  await expect(page.getByPlaceholder("Start with an initial prompt...")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();

  await page.getByRole("button", { name: "Running session" }).click();

  await expect(page.getByRole("heading", { name: "Running session" })).toBeVisible();
  await expect(page.getByText("Waiting for TRAEX...")).toBeVisible();
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

  await page.addInitScript(() => {
    class MockEventSource extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 2;
      readonly CONNECTING = 0;
      readonly OPEN = 1;
      readonly CLOSED = 2;
      readonly url: string;
      readonly withCredentials = false;
      readyState = MockEventSource.CONNECTING;
      onerror: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onopen: ((event: Event) => void) | null = null;

      constructor(url: string | URL) {
        super();
        this.url = String(url);

        (
          window as Window & {
            __cancelRun?: () => void;
            __emitTrace?: () => void;
          }
        ).__cancelRun = () => {
          this.dispatchEvent(
            new MessageEvent("run.cancelled", {
              data: JSON.stringify({
                type: "run.cancelled",
              }),
            }),
          );
        };
        (
          window as Window & {
            __cancelRun?: () => void;
            __emitTrace?: () => void;
          }
        ).__emitTrace = () => {
          this.dispatchEvent(
            new MessageEvent("run.trace", {
              data: JSON.stringify({
                type: "run.trace",
                event: {
                  type: "item.completed",
                  item: {
                    id: "item-stop",
                    type: "agent_message",
                    text: "Trace before stop.",
                  },
                },
              }),
            }),
          );
        };
      }

      close() {
        this.readyState = MockEventSource.CLOSED;
      }
    }

    window.EventSource = MockEventSource as typeof EventSource;
  });

  await mockSessions(page, () => [running ? startedSession : stoppedSession]);
  await mockSessionById(page, "session-1", () => (running ? startedSession : stoppedSession));
  await page.route("**/api/v1/sessions/session-1/runs", async (route) => {
    running = true;
    await fulfillJson(route, createSubmittedRunResponse(startedSession, "run-1"));
  });
  await page.route("**/api/v1/runs/run-1/cancellation", async (route) => {
    stopRequests += 1;
    running = false;
    await page.evaluate(() =>
      (
        window as Window & {
          __cancelRun?: () => void;
        }
      ).__cancelRun?.(),
    );
    await fulfillJson(route, {
      status: "ok",
    });
  });

  await page.goto("/");
  await page.getByPlaceholder("Continue this session...").fill("Run a long task");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect(page.getByRole("button", { name: "Stop generation" })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          typeof (
            window as Window & {
              __emitTrace?: () => void;
            }
          ).__emitTrace,
      ),
    )
    .toBe("function");
  await page.evaluate(() =>
    (
      window as Window & {
        __emitTrace?: () => void;
      }
    ).__emitTrace?.(),
  );
  await expect(page.getByText("Hide execution trace")).toBeVisible();
  await expect(page.getByText("Trace before stop.")).toBeVisible();

  await page.getByRole("button", { name: "Stop generation" }).click();

  await expect.poll(() => stopRequests).toBe(1);
  await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();
  await expect(page.getByText("Waiting for TRAEX...")).not.toBeVisible();
  await expect(page.getByText("Show execution trace")).toBeVisible();
  await expect(page.getByText("1 event / 1 message")).toBeVisible();
  await expect(page.getByText("Trace before stop.")).not.toBeVisible();

  await page.getByText("Show execution trace").click();
  await expect(page.getByText("Trace before stop.")).toBeVisible();
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

  await page.addInitScript(() => {
    const eventSources = new Map<string, EventTarget>();

    (
      window as Window & {
        __cancelRun?: (runId: string) => void;
        __emitTrace?: (runId: string) => void;
      }
    ).__cancelRun = (runId: string) => {
      eventSources.get(`/api/v1/runs/${runId}/events`)?.dispatchEvent(
        new MessageEvent("run.cancelled", {
          data: JSON.stringify({
            type: "run.cancelled",
          }),
        }),
      );
    };
    (
      window as Window & {
        __cancelRun?: (runId: string) => void;
        __emitTrace?: (runId: string) => void;
      }
    ).__emitTrace = (runId: string) => {
      eventSources.get(`/api/v1/runs/${runId}/events`)?.dispatchEvent(
        new MessageEvent("run.trace", {
          data: JSON.stringify({
            type: "run.trace",
            event: {
              type: "item.completed",
              item: {
                id: "item-stop",
                type: "agent_message",
                text: "Trace before stop.",
              },
            },
          }),
        }),
      );
    };

    class MockEventSource extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 2;
      readonly CONNECTING = 0;
      readonly OPEN = 1;
      readonly CLOSED = 2;
      readonly url: string;
      readonly withCredentials = false;
      readyState = MockEventSource.CONNECTING;
      onerror: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onopen: ((event: Event) => void) | null = null;

      constructor(url: string | URL) {
        super();
        this.url = String(url);
        this.readyState = MockEventSource.OPEN;
        eventSources.set(this.url, this);
      }

      close() {
        this.readyState = MockEventSource.CLOSED;
        eventSources.delete(this.url);
      }
    }

    window.EventSource = MockEventSource as typeof EventSource;
  });

  await mockSessions(page, () => [visibleSession]);
  await mockSessionById(page, "session-1", () => visibleSession);
  await page.route("**/api/v1/sessions/session-1/runs", async (route) => {
    const body = route.request().postDataJSON() as { input: { prompt: string } };

    prompts.push(body.input.prompt);
    visibleSession = prompts.length === 1 ? firstRunningSession : queuedSession;
    await fulfillJson(
      route,
      prompts.length === 1
        ? createSubmittedRunResponse(visibleSession, "run-1")
        : createSubmittedRunResponse(visibleSession, "queued-1", { status: "queued" }),
    );
  });
  await page.route("**/api/v1/runs/run-1/cancellation", async (route) => {
    visibleSession = secondRunningSession;
    await page.evaluate(() =>
      (
        window as Window & {
          __cancelRun?: (runId: string) => void;
        }
      ).__cancelRun?.("run-1"),
    );
    await fulfillJson(route, {
      status: "ok",
    });
  });

  await page.goto("/");
  await page.getByPlaceholder("Continue this session...").fill("Run a long task");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect(page.getByRole("button", { name: "Stop generation" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();
  await page.evaluate(() =>
    (
      window as Window & {
        __emitTrace?: (runId: string) => void;
      }
    ).__emitTrace?.("run-1"),
  );
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

  await page.addInitScript(() => {
    const eventSources = new Map<string, EventTarget>();

    (
      window as Window & {
        __completeRun?: (runId: string) => void;
      }
    ).__completeRun = (runId: string) => {
      eventSources.get(`/api/v1/runs/${runId}/events`)?.dispatchEvent(
        new MessageEvent("run.succeeded", {
          data: JSON.stringify({
            type: "run.succeeded",
            session: {
              id: "session-1",
              workspace: "/Users/bytedance/cui",
              title: "Running session",
              createdAt: "2026-08-22T00:00:00.000Z",
              updatedAt: "2026-08-22T00:00:01.000Z",
              messages: [
                {
                  id: "message-1",
                  role: "user",
                  content: "Run a long task",
                  createdAt: "2026-08-22T00:00:00.000Z",
                },
                {
                  id: "message-2",
                  role: "assistant",
                  kind: "response",
                  content: "First response.",
                  createdAt: "2026-08-22T00:00:01.000Z",
                },
              ],
              rounds: [],
              currentRound: 1,
              isRunning: false,
            },
          }),
        }),
      );
    };

    class MockEventSource extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 2;
      readonly CONNECTING = 0;
      readonly OPEN = 1;
      readonly CLOSED = 2;
      readonly url: string;
      readonly withCredentials = false;
      readyState = MockEventSource.CONNECTING;
      onerror: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onopen: ((event: Event) => void) | null = null;

      constructor(url: string | URL) {
        super();
        this.url = String(url);
        this.readyState = MockEventSource.OPEN;
        eventSources.set(this.url, this);
      }

      close() {
        this.readyState = MockEventSource.CLOSED;
        eventSources.delete(this.url);
      }
    }

    window.EventSource = MockEventSource as typeof EventSource;
  });

  await mockSessions(page, () => [visibleSession]);
  await mockSessionById(page, "session-1", () => visibleSession);
  await page.route("**/api/v1/sessions/session-1/runs", async (route) => {
    const body = route.request().postDataJSON() as { input: { prompt: string } };

    prompts.push(body.input.prompt);
    visibleSession = prompts.length === 1 ? firstRunningSession : queuedSession;
    await fulfillJson(
      route,
      prompts.length === 1
        ? createSubmittedRunResponse(visibleSession, "run-1")
        : createSubmittedRunResponse(visibleSession, "queued-1", { status: "queued" }),
    );
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
  await page.evaluate(() =>
    (
      window as Window & {
        __completeRun?: (runId: string) => void;
      }
    ).__completeRun?.("run-1"),
  );

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

  await page.addInitScript(() => {
    (
      window as Window & {
        __emitHiddenTrace?: () => void;
      }
    ).__emitHiddenTrace = undefined;

    class MockEventSource extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 2;
      readonly CONNECTING = 0;
      readonly OPEN = 1;
      readonly CLOSED = 2;
      readonly url: string;
      readonly withCredentials = false;
      readyState = MockEventSource.CONNECTING;
      onerror: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onopen: ((event: Event) => void) | null = null;

      constructor(url: string | URL) {
        super();
        this.url = String(url);
        this.readyState = MockEventSource.OPEN;

        (
          window as Window & {
            __emitHiddenTrace?: () => void;
          }
        ).__emitHiddenTrace = () => {
          this.dispatchEvent(
            new MessageEvent("run.trace", {
              data: JSON.stringify({
                type: "run.trace",
                event: {
                  type: "item.completed",
                  item: {
                    id: "item-hidden",
                    type: "agent_message",
                    text: "Hidden trace event.",
                  },
                },
              }),
            }),
          );
        };
      }

      close() {
        this.readyState = MockEventSource.CLOSED;
      }
    }

    window.EventSource = MockEventSource as typeof EventSource;
  });

  await mockSessions(page, [runningSession, otherSession]);
  await mockSessionById(page, "session-1", runningSession);
  await mockSession(page, otherSession);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Running session" })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          typeof (
            window as Window & {
              __emitHiddenTrace?: () => void;
            }
          ).__emitHiddenTrace,
      ),
    )
    .toBe("function");
  await page.getByRole("button", { name: "Other session" }).click();
  await expect(page.getByRole("heading", { name: "Other session" })).toBeVisible();

  await page.evaluate(() =>
    (
      window as Window & {
        __emitHiddenTrace?: () => void;
      }
    ).__emitHiddenTrace?.(),
  );
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
        __completeRun?: () => void;
      }
    ).__completeRun = undefined;

    class MockEventSource extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 2;
      readonly CONNECTING = 0;
      readonly OPEN = 1;
      readonly CLOSED = 2;
      readonly url: string;
      readonly withCredentials = false;
      readyState = MockEventSource.CONNECTING;
      onerror: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onopen: ((event: Event) => void) | null = null;

      constructor(url: string | URL) {
        super();
        this.url = String(url);
        this.readyState = MockEventSource.OPEN;

        (
          window as Window & {
            __completeRun?: () => void;
          }
        ).__completeRun = () => {
          this.dispatchEvent(new Event("open"));
          this.dispatchEvent(
            new MessageEvent("run.succeeded", {
              data: JSON.stringify({
                type: "run.succeeded",
                session: {
                  id: "session-1",
                  workspace: "/Users/bytedance/cui",
                  title: "Running session",
                  createdAt: "2026-08-22T00:00:00.000Z",
                  updatedAt: "2026-08-22T00:00:01.000Z",
                  messages: [
                    {
                      id: "message-1",
                      role: "user",
                      content: "Run a long task",
                      createdAt: "2026-08-22T00:00:00.000Z",
                    },
                    {
                      id: "message-2",
                      role: "assistant",
                      kind: "response",
                      content: "Finished while hidden.",
                      createdAt: "2026-08-22T00:00:01.000Z",
                    },
                  ],
                  rounds: [],
                  currentRound: 1,
                  isRunning: false,
                },
              }),
            }),
          );
        };
      }

      close() {
        this.readyState = MockEventSource.CLOSED;
      }
    }

    window.EventSource = MockEventSource as typeof EventSource;
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
  await page.evaluate(() =>
    (
      window as Window & {
        __completeRun?: () => void;
      }
    ).__completeRun?.(),
  );
  await expect.poll(() => sessionListRequests).toBeGreaterThan(1);
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

  await page.addInitScript(() => {
    (
      window as Window & {
        __completeRun?: () => void;
      }
    ).__completeRun = undefined;

    class MockEventSource extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 2;
      readonly CONNECTING = 0;
      readonly OPEN = 1;
      readonly CLOSED = 2;
      readonly url: string;
      readonly withCredentials = false;
      readyState = MockEventSource.CONNECTING;
      onerror: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onopen: ((event: Event) => void) | null = null;

      constructor(url: string | URL) {
        super();
        this.url = String(url);
        this.readyState = MockEventSource.OPEN;

        (
          window as Window & {
            __completeRun?: () => void;
          }
        ).__completeRun = () => {
          this.dispatchEvent(
            new MessageEvent("run.succeeded", {
              data: JSON.stringify({
                type: "run.succeeded",
                session: {
                  id: "session-1",
                  workspace: "/Users/bytedance/cui",
                  title: "Running session",
                  createdAt: "2026-08-22T00:00:00.000Z",
                  updatedAt: "2026-08-22T00:00:01.000Z",
                  messages: [
                    {
                      id: "message-1",
                      role: "user",
                      content: "Run a long task",
                      createdAt: "2026-08-22T00:00:00.000Z",
                    },
                    {
                      id: "message-2",
                      role: "assistant",
                      kind: "response",
                      content: "Finished while on new session.",
                      createdAt: "2026-08-22T00:00:01.000Z",
                    },
                  ],
                  rounds: [],
                  currentRound: 1,
                  isRunning: false,
                },
              }),
            }),
          );
        };
      }

      close() {
        this.readyState = MockEventSource.CLOSED;
      }
    }

    window.EventSource = MockEventSource as typeof EventSource;
  });

  await mockSessions(page, () => [runCompleted ? completedSession : runningSession]);
  await mockSessionById(page, "session-1", () =>
    runCompleted ? completedSession : runningSession,
  );

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Running session" })).toBeVisible();
  await page.getByRole("button", { name: "New session", exact: true }).click();
  await expect(page.getByRole("heading", { name: "New session" })).toBeVisible();

  runCompleted = true;
  await page.evaluate(() =>
    (
      window as Window & {
        __completeRun?: () => void;
      }
    ).__completeRun?.(),
  );

  await expect(page.getByRole("heading", { name: "New session" })).toBeVisible();
  await expect(page.getByText("Finished while on new session.")).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Running session" })).not.toHaveClass(
    /is-running-session/,
  );
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

  await page.exposeFunction("__markRunCompleted", () => {
    runCompleted = true;
  });
  await page.addInitScript(() => {
    const eventSourceUrls: string[] = [];

    (
      window as Window & {
        __eventSourceUrls?: string[];
      }
    ).__eventSourceUrls = eventSourceUrls;

    class MockEventSource extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 2;
      readonly CONNECTING = 0;
      readonly OPEN = 1;
      readonly CLOSED = 2;
      readonly url: string;
      readonly withCredentials = false;
      readyState = MockEventSource.CONNECTING;
      onerror: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onopen: ((event: Event) => void) | null = null;

      constructor(url: string | URL) {
        super();
        this.url = String(url);
        eventSourceUrls.push(this.url);

        window.setTimeout(async () => {
          this.readyState = MockEventSource.OPEN;
          this.dispatchEvent(new Event("open"));
          this.dispatchEvent(
            new MessageEvent("run.output.delta", {
              data: JSON.stringify({
                type: "run.output.delta",
                text: "Recovered response",
              }),
            }),
          );
          await (
            window as Window & {
              __markRunCompleted?: () => Promise<void>;
            }
          ).__markRunCompleted?.();
          this.dispatchEvent(
            new MessageEvent("run.succeeded", {
              data: JSON.stringify({
                type: "run.succeeded",
                session: {
                  id: "session-1",
                  workspace: "/Users/bytedance/cui",
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
                    {
                      id: "message-2",
                      role: "assistant",
                      kind: "response",
                      content: "Finished after reconnect.",
                      createdAt: "2026-08-22T00:00:01.000Z",
                    },
                  ],
                  rounds: [],
                  currentRound: 1,
                  isRunning: false,
                },
              }),
            }),
          );
        }, 0);
      }

      close() {
        this.readyState = MockEventSource.CLOSED;
      }
    }

    window.EventSource = MockEventSource as typeof EventSource;
  });

  await mockSessions(page, () => {
    return [runCompleted ? completedSession : runningSession];
  });
  await mockSessionById(page, "session-1", () =>
    runCompleted ? completedSession : runningSession,
  );

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Running session" })).toBeVisible();
  await expect(page.getByText("Finished after reconnect.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __eventSourceUrls?: string[];
            }
          ).__eventSourceUrls ?? [],
      ),
    )
    .toContain("/api/v1/runs/run-1/events");
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

  await page.addInitScript(() => {
    class MockEventSource extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 2;
      readonly CONNECTING = 0;
      readonly OPEN = 1;
      readonly CLOSED = 2;
      readonly url: string;
      readonly withCredentials = false;
      readyState = MockEventSource.CONNECTING;
      onerror: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onopen: ((event: Event) => void) | null = null;

      constructor(url: string | URL) {
        super();
        this.url = String(url);

        window.setTimeout(() => {
          this.readyState = MockEventSource.OPEN;
          this.dispatchEvent(new Event("open"));
          this.dispatchEvent(
            new MessageEvent("run.output.delta", {
              data: JSON.stringify({
                type: "run.output.delta",
                text: "Streamed ",
              }),
            }),
          );
          this.dispatchEvent(
            new MessageEvent("session.updated", {
              data: JSON.stringify({
                type: "session.updated",
                session: {
                  id: "session-1",
                  workspace: "/Users/bytedance/cui",
                  title: "Early summary title",
                  summary: "Summary generated from the latest user input.",
                  createdAt: "2026-08-22T00:00:00.000Z",
                  updatedAt: "2026-08-22T00:00:01.000Z",
                  messages: [
                    {
                      id: "message-1",
                      role: "assistant",
                      kind: "response",
                      content: "Previous response.",
                      createdAt: "2026-08-22T00:00:00.000Z",
                    },
                    {
                      id: "message-2",
                      role: "user",
                      content: "Continue with a streamed summary test",
                      createdAt: "2026-08-22T00:00:00.000Z",
                    },
                  ],
                  rounds: [],
                  currentRound: 0,
                  isRunning: true,
                  runningRunId: "run-1",
                },
              }),
            }),
          );
          this.dispatchEvent(
            new MessageEvent("run.output.delta", {
              data: JSON.stringify({
                type: "run.output.delta",
                text: "answer.",
              }),
            }),
          );
        }, 0);
      }

      close() {
        this.readyState = MockEventSource.CLOSED;
      }
    }

    window.EventSource = MockEventSource as typeof EventSource;
  });

  await mockSessions(page, () => {
    sessionListRequests += 1;
    return sessionListRequests < 3 ? [initialSession] : [summarizedSession];
  });
  await page.route("**/api/v1/sessions/session-1/runs", async (route) => {
    await fulfillJson(route, createSubmittedRunResponse(startedSession, "run-1"));
  });
  await mockSession(page, initialSession);

  await page.goto("/");
  await expect(page.getByText("Previous response.")).toBeVisible();
  await page
    .getByPlaceholder("Continue this session...")
    .fill("Continue with a streamed summary test");
  await page.getByRole("button", { name: "Send message" }).click();

  const conversation = page.getByLabel("AI conversation");

  await expect(conversation.getByRole("heading", { name: "Early summary title" })).toBeVisible();
  await expect(
    conversation.getByText("Summary generated from the latest user input."),
  ).toBeVisible();
  await expect(conversation.getByText("Streamed answer.")).toBeVisible();
});
