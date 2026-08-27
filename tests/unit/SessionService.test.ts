import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionService } from "../../apps/api/src/domain/sessions/SessionService.js";
import { PathNotFoundError } from "../../apps/api/src/domain/paths/pathValidation.js";
import { JsonSessionStore } from "../../apps/api/src/infrastructure/store/JsonSessionStore.js";
import type { AppLogger } from "../../apps/api/src/infrastructure/logging/AppLogger.js";
import type {
  AiAtomicDiffReviewInput,
  AiModel,
  AiModelInfo,
  AiModelPreferences,
  AiResponse,
  AiRun,
  AiRunResult,
  AtomicDiffReview,
  ConversationSummary,
} from "../../apps/api/src/types.js";
import { AiRunCancelledError } from "../../apps/api/src/types.js";

test("beginContinueSession refreshes summary after user input and before turn completion", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "cui-session-service-"));
  const store = new JsonSessionStore(join(cwd, "sessions.json"));
  const aiModel = new FakeAiModel();
  const service = new SessionService(aiModel, store, createSilentLogger());

  try {
    await store.createSession({
      id: "session-1",
      workspace: cwd,
      title: "Initial title",
      summary: "",
      createdAt: "2026-08-22T00:00:00.000Z",
      updatedAt: "2026-08-22T00:00:00.000Z",
      messages: [
        {
          id: "message-1",
          role: "assistant",
          kind: "response",
          content: "Previous answer.",
          createdAt: "2026-08-22T00:00:00.000Z",
        },
      ],
      rounds: [],
    });

    const submitted = await service.beginContinueSession("session-1", {
      prompt: "Explain when the summary should run.",
      models: {
        normal: "GPT-5.4",
        summary: "Seed-2.1-Turbo",
      },
    });
    const events: unknown[] = [];

    service.subscribeToTurn(submitted.turnId, (event) => {
      events.push(event);
    });

    assert.equal(aiModel.summaryPrompts.length, 1);
    assert.deepEqual(aiModel.summaryModels[0], {
      normal: "GPT-5.4",
      summary: "Seed-2.1-Turbo",
    });
    assert.match(aiModel.summaryPrompts[0], /用户：Explain when the summary should run\./);

    aiModel.resolveRun({
      sessionId: "session-1",
      content: "Done.",
      rawEvents: [],
    });
    await flushPromises();

    assert.equal(aiModel.summaryPrompts.length, 1);
    assert.equal(events.some(isDoneEvent), false);

    aiModel.resolveSummary({
      title: "Summary timing",
      progress: "The latest user input is summarized before the turn finishes.",
    });
    await waitFor(() => events.length === 2);

    assert.equal(aiModel.summaryPrompts.length, 1);
    assert.deepEqual(aiModel.runModels[0], {
      normal: "GPT-5.4",
      summary: "Seed-2.1-Turbo",
    });
    assert.deepEqual(
      events.map((event) => eventType(event)),
      ["session.updated", "done"],
    );
    assert.equal(await getStoredTitle(store), "Summary timing");

    const doneEvent = events.find(isDoneEvent);
    assert.equal(doneEvent?.session.title, "Summary timing");
    assert.equal(doneEvent?.session.messages.at(-1)?.content, "Done.");
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("beginContinueSession completes without waiting for atomic review generation", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "cui-session-service-"));
  const store = new JsonSessionStore(join(cwd, "sessions.json"));
  const aiModel = new FakeAiModel();
  const service = new SessionService(aiModel, store, createSilentLogger());

  try {
    await store.createSession({
      id: "session-1",
      workspace: cwd,
      title: "Initial title",
      summary: "",
      createdAt: "2026-08-22T00:00:00.000Z",
      updatedAt: "2026-08-22T00:00:00.000Z",
      messages: [],
      rounds: [],
    });

    const submitted = await service.beginContinueSession("session-1", {
      prompt: "Change the value.",
      models: {
        atomicReview: "DeepSeek-V4-Pro",
      },
    });
    const events: unknown[] = [];

    service.subscribeToTurn(submitted.turnId, (event) => {
      events.push(event);
    });
    aiModel.resolveSummary({
      title: "Changed value",
      progress: "The user asked for a value change.",
    });
    aiModel.resolveRun({
      sessionId: "session-1",
      content: "Done.",
      gitDiff: {
        beforeDiff: "",
        afterDiff: [
          "diff --git a/example.ts b/example.ts",
          "--- a/example.ts",
          "+++ b/example.ts",
          "@@ -1 +1 @@",
          "-export const value = 1;",
          "+export const value = 2;",
        ].join("\n"),
      },
      rawEvents: [],
    });

    await waitFor(() => events.some(isDoneEvent));

    const doneEvent = events.find(isDoneEvent);

    assert.equal(aiModel.atomicReviewInputs.length, 1);
    assert.deepEqual(aiModel.atomicReviewInputs[0]?.models, {
      atomicReview: "DeepSeek-V4-Pro",
    });
    assert.equal(doneEvent?.session.messages.at(-1)?.content, "Done.");
    assert.equal((await store.getRound("session-1", 1))?.atomicReview, undefined);

    aiModel.resolveAtomicReview({
      status: "ready",
      generatedAt: "2026-08-22T00:00:02.000Z",
      analysisSessionId: "analysis-session-1",
      items: [],
      rawResponse: '{"items":[]}',
    });
    await waitFor(
      async () => (await store.getRound("session-1", 1))?.atomicReview?.status === "ready",
    );

    assert.equal((await store.getRound("session-1", 1))?.atomicReview?.status, "ready");
    assert.equal(
      (await service.getSessionView("session-1"))?.rounds?.[0]?.atomicReviewStatus,
      "ready",
    );
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("cancelRunningTurn stops an active stream and emits a cancellation event", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "cui-session-service-"));
  const store = new JsonSessionStore(join(cwd, "sessions.json"));
  const aiModel = new FakeAiModel();
  const service = new SessionService(aiModel, store, createSilentLogger());

  try {
    await store.createSession({
      id: "session-1",
      workspace: cwd,
      title: "Initial title",
      summary: "",
      createdAt: "2026-08-22T00:00:00.000Z",
      updatedAt: "2026-08-22T00:00:00.000Z",
      messages: [],
      rounds: [],
    });

    const submitted = await service.beginContinueSession("session-1", {
      prompt: "Run until stopped.",
    });
    const events: unknown[] = [];

    service.subscribeToTurn(submitted.turnId, (event) => {
      events.push(event);
    });

    aiModel.emitRawEvent({
      type: "item.completed",
      item: {
        id: "item-1",
        type: "agent_message",
        text: "Trace before stop.",
      },
    });
    await service.cancelRunningTurn("session-1");

    assert.equal(aiModel.cancelled, true);
    assert.equal(
      events.some((event) => eventType(event) === "cancelled"),
      true,
    );
    const session = await service.getSessionView("session-1");

    assert.equal(session?.isRunning, false);
    assert.equal(session?.messages[1]?.kind, "trace");
    assert.match(session?.messages[1]?.content ?? "", /Trace before stop/);
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("beginCreateShellSession streams and stores command output", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "cui-session-service-"));
  const store = new JsonSessionStore(join(cwd, "sessions.json"));
  const aiModel = new FakeAiModel();
  const service = new SessionService(aiModel, store, createSilentLogger());

  try {
    const submitted = await service.beginCreateShellSession({
      workspace: cwd,
      command: 'printf "hello\\n"',
    });
    const events: unknown[] = [];

    service.subscribeToTurn(submitted.turnId, (event) => {
      events.push(event);
    });

    await waitFor(() => events.some(isDoneEvent));

    const doneEvent = events.find(isDoneEvent);
    const session = await store.getSession(doneEvent!.session.id);

    assert.equal(doneEvent?.session.title, '$ printf "hello\\n"');
    assert.equal(session?.messages.length, 3);
    assert.equal(session?.messages[0]?.role, "user");
    assert.equal(session?.messages[0]?.content, 'printf "hello\\n"');
    assert.equal(session?.messages[1]?.kind, "trace");
    assert.match(session?.messages[1]?.content ?? "", /command_execution/);
    assert.equal(session?.messages[2]?.kind, "response");
    assert.match(session?.messages[2]?.content ?? "", /hello/);
    assert.match(session?.messages[2]?.content ?? "", /Status: completed/);
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("beginCreateSession expands home workspace before calling the model", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "cui-session-service-"));
  const store = new JsonSessionStore(join(cwd, "sessions.json"));
  const aiModel = new FakeAiModel();
  const service = new SessionService(aiModel, store, createSilentLogger());

  try {
    const submitted = await service.beginCreateSession({
      workspace: "~",
      prompt: "Use my home directory.",
    });
    const events: unknown[] = [];

    service.subscribeToTurn(submitted.turnId, (event) => {
      events.push(event);
    });

    assert.equal(aiModel.createStreamInputs[0]?.workspace, homedir());
    assert.equal(submitted.session.workspace, homedir());
    aiModel.resolveSummary({
      title: "Home workspace",
      progress: "The home workspace was accepted.",
    });
    aiModel.resolveRun({
      sessionId: submitted.session.id,
      content: "Done.",
      rawEvents: [],
    });
    await waitFor(() => events.some(isDoneEvent));
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("beginCreateSession rejects missing workspaces before calling the model", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "cui-session-service-"));
  const store = new JsonSessionStore(join(cwd, "sessions.json"));
  const aiModel = new FakeAiModel();
  const service = new SessionService(aiModel, store, createSilentLogger());

  try {
    await assert.rejects(
      () =>
        service.beginCreateSession({
          workspace: join(cwd, "missing"),
          prompt: "This should fail before TraeX.",
        }),
      PathNotFoundError,
    );
    assert.equal(aiModel.createStreamInputs.length, 0);
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

class FakeAiModel implements AiModel {
  readonly summaryPrompts: string[] = [];
  readonly summaryModels: Array<AiModelPreferences | undefined> = [];
  readonly runModels: Array<AiModelPreferences | undefined> = [];
  readonly createStreamInputs: Array<{ workspace: string; models?: AiModelPreferences }> = [];
  readonly atomicReviewInputs: AiAtomicDiffReviewInput[] = [];
  cancelled = false;
  private readonly run = createDeferred<AiRunResult>();
  private readonly summary = createDeferred<ConversationSummary>();
  private readonly atomicReview = createDeferred<AtomicDiffReview>();
  private streamEventHandler: ((event: AiRunEvent) => void) | undefined;

  async listModels(): Promise<AiModelInfo[]> {
    return [];
  }

  async createSession(): Promise<AiResponse> {
    throw new Error("Unexpected createSession call");
  }

  async continueSession(): Promise<AiResponse> {
    throw new Error("Unexpected continueSession call");
  }

  async createAtomicDiffReview(input: AiAtomicDiffReviewInput) {
    this.atomicReviewInputs.push(input);

    return this.atomicReview.promise;
  }

  async summarizeConversation(input: { prompt: string; models?: AiModelPreferences }) {
    this.summaryPrompts.push(input.prompt);
    this.summaryModels.push(input.models);

    return this.summary.promise;
  }

  createSessionStream(input: { workspace: string; models?: AiModelPreferences }): AiRun {
    this.createStreamInputs.push(input);

    return {
      sessionId: Promise.resolve("created-session-1"),
      result: this.run.promise,
      cancel: () => {
        this.cancelled = true;
        this.run.reject(new AiRunCancelledError());
      },
    };
  }

  continueSessionStream(
    input: { models?: AiModelPreferences },
    onEvent: (event: AiRunEvent) => void,
  ): AiRun {
    this.runModels.push(input.models);
    this.streamEventHandler = onEvent;

    return {
      sessionId: Promise.resolve("session-1"),
      result: this.run.promise,
      cancel: () => {
        this.cancelled = true;
        this.run.reject(new AiRunCancelledError());
      },
    };
  }

  emitRawEvent(event: unknown) {
    this.streamEventHandler?.({
      type: "raw",
      event,
    });
  }

  resolveRun(result: AiRunResult) {
    this.run.resolve(result);
  }

  resolveSummary(summary: ConversationSummary) {
    this.summary.resolve(summary);
  }

  resolveAtomicReview(review: AtomicDiffReview) {
    this.atomicReview.resolve(review);
  }
}

function createSilentLogger(): AppLogger {
  const sink = {
    debug: async () => undefined,
    info: async () => undefined,
    warn: async () => undefined,
    error: async () => undefined,
  };

  return {
    framework: sink,
    session: () => sink,
  } as unknown as AppLogger;
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function flushPromises() {
  return new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

async function waitFor(predicate: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 1000;

  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }

    await delay(5);
  }

  assert.equal(await predicate(), true);
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function eventType(event: unknown): string | undefined {
  return isEventWithType(event) ? event.type : undefined;
}

function isDoneEvent(event: unknown): event is {
  type: "done";
  session: { title: string; messages: Array<{ content: string }> };
} {
  return isEventWithType(event) && event.type === "done";
}

function isEventWithType(event: unknown): event is { type: string } {
  return (
    Boolean(event) && typeof event === "object" && "type" in event && typeof event.type === "string"
  );
}

async function getStoredTitle(store: JsonSessionStore): Promise<string | undefined> {
  return (await store.getSession("session-1"))?.title;
}
