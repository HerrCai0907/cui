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

test("createRun refreshes summary after user input and assistant response", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "cui-session-service-"));
  const store = new JsonSessionStore(join(cwd, "sessions.json"));
  const aiModel = new FakeAiModel();
  const service = new SessionService(aiModel, store, createSilentLogger());

  try {
    await store.createSession({
      id: "session-1",
      aiThreadId: "traex-thread-1",
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

    const submitted = await service.createRun(
      "session-1",
      createAssistantRunRequest("Explain when the summary should run.", {
        normal: "GPT-5.4",
        summary: "Seed-2.1-Turbo",
      }),
    );
    const events: unknown[] = [];

    service.subscribeToRun(submitted.run.id, (event) => {
      events.push(event);
    });

    assert.equal(aiModel.summaryPrompts.length, 1);
    assert.deepEqual(aiModel.summaryModels[0], {
      normal: "GPT-5.4",
      summary: "Seed-2.1-Turbo",
    });
    assert.match(aiModel.summaryPrompts[0], /用户：Explain when the summary should run\./);
    assert.doesNotMatch(aiModel.summaryPrompts[0], /助手：Done\./);
    assert.equal(aiModel.continueStreamInputs[0]?.sessionId, "traex-thread-1");

    aiModel.resolveSummary({
      title: "User input summary",
      progress: "The latest user input has been summarized.",
    });
    await waitFor(() => events.length === 1);

    aiModel.resolveRun({
      sessionId: "traex-thread-1",
      content: "Done.",
      rawEvents: [],
    });
    await waitFor(() => aiModel.summaryPrompts.length === 2);

    assert.equal(aiModel.summaryPrompts.length, 2);
    assert.deepEqual(aiModel.summaryModels[1], {
      normal: "GPT-5.4",
      summary: "Seed-2.1-Turbo",
    });
    assert.match(aiModel.summaryPrompts[1], /用户：Explain when the summary should run\./);
    assert.match(aiModel.summaryPrompts[1], /助手：Done\./);
    assert.equal(events.some(isDoneEvent), false);

    aiModel.resolveSummary(
      {
        title: "Summary timing",
        progress: "The completed turn is summarized before the run finishes.",
      },
      1,
    );
    await waitFor(() => events.length === 3);

    assert.equal(aiModel.summaryPrompts.length, 2);
    assert.deepEqual(aiModel.runModels[0], {
      normal: "GPT-5.4",
      summary: "Seed-2.1-Turbo",
    });
    assert.deepEqual(
      events.map((event) => eventType(event)),
      ["session.updated", "session.updated", "run.succeeded"],
    );
    assert.equal(await getStoredTitle(store), "Summary timing");

    const doneEvent = events.find(isDoneEvent);
    assert.equal(doneEvent?.session.title, "Summary timing");
    assert.equal(doneEvent?.session.messages.at(-1)?.content, "Done.");
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("createRun completes without waiting for atomic review generation", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "cui-session-service-"));
  const store = new JsonSessionStore(join(cwd, "sessions.json"));
  const aiModel = new FakeAiModel();
  const service = new SessionService(aiModel, store, createSilentLogger());

  try {
    await store.createSession({
      id: "session-1",
      aiThreadId: "traex-thread-1",
      workspace: cwd,
      title: "Initial title",
      summary: "",
      createdAt: "2026-08-22T00:00:00.000Z",
      updatedAt: "2026-08-22T00:00:00.000Z",
      messages: [],
      rounds: [],
    });

    const submitted = await service.createRun(
      "session-1",
      createAssistantRunRequest("Change the value.", {
        atomicReview: "DeepSeek-V4-Pro",
      }),
    );
    const events: unknown[] = [];

    service.subscribeToRun(submitted.run.id, (event) => {
      events.push(event);
    });
    await waitFor(() => aiModel.summaryPrompts.length === 1);
    aiModel.resolveSummary({
      title: "Input summary",
      progress: "The input was summarized.",
    });
    aiModel.resolveRun({
      sessionId: "traex-thread-1",
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
    await waitFor(() => aiModel.summaryPrompts.length === 2);
    aiModel.resolveSummary(
      {
        title: "Changed value",
        progress: "The user asked for a value change.",
      },
      1,
    );

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

test("cancelRun stops an active stream and emits a cancellation event", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "cui-session-service-"));
  const store = new JsonSessionStore(join(cwd, "sessions.json"));
  const aiModel = new FakeAiModel();
  const service = new SessionService(aiModel, store, createSilentLogger());

  try {
    await store.createSession({
      id: "session-1",
      aiThreadId: "traex-thread-1",
      workspace: cwd,
      title: "Initial title",
      summary: "",
      createdAt: "2026-08-22T00:00:00.000Z",
      updatedAt: "2026-08-22T00:00:00.000Z",
      messages: [],
      rounds: [],
    });

    const submitted = await service.createRun(
      "session-1",
      createAssistantRunRequest("Run until stopped."),
    );
    const events: unknown[] = [];

    service.subscribeToRun(submitted.run.id, (event) => {
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
    await service.cancelRun(submitted.run.id);

    assert.equal(aiModel.cancelled, true);
    assert.equal(
      events.some((event) => eventType(event) === "run.cancelled"),
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

test("createRun queues prompts while a session is running", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "cui-session-service-"));
  const store = new JsonSessionStore(join(cwd, "sessions.json"));
  const aiModel = new FakeAiModel();
  const service = new SessionService(aiModel, store, createSilentLogger());

  try {
    await store.createSession({
      id: "session-1",
      aiThreadId: "traex-thread-1",
      workspace: cwd,
      title: "Initial title",
      summary: "",
      createdAt: "2026-08-22T00:00:00.000Z",
      updatedAt: "2026-08-22T00:00:00.000Z",
      messages: [],
      rounds: [],
    });

    const firstRun = await service.createRun(
      "session-1",
      createAssistantRunRequest("Run a long task.", {
        normal: "GPT-5.4",
      }),
    );
    const queuedRun = await service.createRun(
      "session-1",
      createAssistantRunRequest("Queued follow-up.", {
        normal: "DeepSeek-V4-Pro",
      }),
    );
    const queuedRunEvents: unknown[] = [];

    service.subscribeToRun(queuedRun.run.id, (event) => {
      queuedRunEvents.push(event);
    });

    assert.equal(firstRun.run.status, "running");
    assert.equal(queuedRun.run.status, "queued");
    assert.equal(aiModel.continueStreamInputs.length, 1);
    assert.equal(aiModel.continueStreamInputs[0]?.prompt, "Run a long task.");

    const queuedSession = await store.getSession("session-1");

    assert.deepEqual(
      queuedSession?.queuedPrompts?.map((prompt) => ({
        id: prompt.id,
        mode: prompt.mode,
        prompt: prompt.prompt,
        models: prompt.models,
      })),
      [
        {
          id: queuedRun.run.id,
          mode: "chat",
          prompt: "Queued follow-up.",
          models: {
            normal: "DeepSeek-V4-Pro",
          },
        },
      ],
    );
    assert.deepEqual(
      queuedSession?.messages.map((message) => message.content),
      ["Run a long task."],
    );

    await waitFor(() => aiModel.summaryPrompts.length === 1);
    aiModel.resolveSummary({
      title: "First summary",
      progress: "The first run is summarized.",
    });
    aiModel.resolveRun({
      sessionId: "traex-thread-1",
      content: "First response.",
      rawEvents: [],
    });
    await waitFor(() => aiModel.summaryPrompts.length === 2);
    aiModel.resolveSummary(
      {
        title: "First response summary",
        progress: "The first response is summarized.",
      },
      1,
    );

    await waitFor(() => aiModel.continueStreamInputs.length === 2);

    assert.equal(aiModel.continueStreamInputs[1]?.prompt, "Queued follow-up.");
    assert.equal(aiModel.continueStreamInputs[1]?.sessionId, "traex-thread-1");
    assert.deepEqual(aiModel.continueStreamInputs[1]?.models, {
      normal: "DeepSeek-V4-Pro",
    });
    assert.equal((await store.getSession("session-1"))?.queuedPrompts?.length ?? 0, 0);
    assert.equal((await service.getSessionView("session-1"))?.isRunning, true);

    await waitFor(() => aiModel.summaryPrompts.length === 3);
    aiModel.resolveSummary(
      {
        title: "Second input summary",
        progress: "The queued input is summarized.",
      },
      2,
    );
    aiModel.resolveRun(
      {
        sessionId: "traex-thread-1",
        content: "Second response.",
        rawEvents: [],
      },
      1,
    );
    await waitFor(() => aiModel.summaryPrompts.length === 4);
    aiModel.resolveSummary(
      {
        title: "Second response summary",
        progress: "The queued response is summarized.",
      },
      3,
    );

    await waitFor(() => queuedRunEvents.some(isDoneEvent));

    assert.equal((await service.getSessionView("session-1"))?.isRunning, false);
    assert.equal(
      queuedRunEvents.find(isDoneEvent)?.session.messages.at(-1)?.content,
      "Second response.",
    );
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("resumeQueuedPrompts starts persisted queued prompts", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "cui-session-service-"));
  const store = new JsonSessionStore(join(cwd, "sessions.json"));
  const aiModel = new FakeAiModel();
  const service = new SessionService(aiModel, store, createSilentLogger());

  try {
    await store.createSession({
      id: "session-1",
      aiThreadId: "traex-thread-1",
      workspace: cwd,
      title: "Initial title",
      summary: "",
      createdAt: "2026-08-22T00:00:00.000Z",
      updatedAt: "2026-08-22T00:00:00.000Z",
      messages: [],
      rounds: [],
      queuedPrompts: [
        {
          id: "queued-1",
          mode: "chat",
          prompt: "Persisted follow-up.",
          createdAt: "2026-08-22T00:00:01.000Z",
          models: {
            normal: "GPT-5.4",
          },
        },
      ],
    });

    await service.resumeQueuedPrompts();
    await waitFor(() => aiModel.continueStreamInputs.length === 1);

    assert.equal(aiModel.continueStreamInputs[0]?.prompt, "Persisted follow-up.");
    assert.equal(aiModel.continueStreamInputs[0]?.sessionId, "traex-thread-1");
    assert.deepEqual(aiModel.continueStreamInputs[0]?.models, {
      normal: "GPT-5.4",
    });
    assert.equal((await store.getSession("session-1"))?.queuedPrompts?.length ?? 0, 0);

    const session = await service.getSessionView("session-1");

    assert.equal(session?.isRunning, true);
    assert.equal(session?.messages[0]?.content, "Persisted follow-up.");
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("createRun streams and stores command output in a shell session", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "cui-session-service-"));
  const store = new JsonSessionStore(join(cwd, "sessions.json"));
  const aiModel = new FakeAiModel();
  const service = new SessionService(aiModel, store, createSilentLogger());

  try {
    const session = await service.createSessionContainer({
      workspace: cwd,
      origin: "shell",
      title: '$ printf "hello\\n"',
    });
    const submitted = await service.createRun(session.id, {
      type: "shell_command",
      input: {
        command: 'printf "hello\\n"',
      },
    });
    const events: unknown[] = [];

    service.subscribeToRun(submitted.run.id, (event) => {
      events.push(event);
    });

    await waitFor(() => events.some(isDoneEvent));

    const doneEvent = events.find(isDoneEvent);
    const storedSession = await store.getSession(doneEvent!.session.id);

    assert.equal(doneEvent?.session.title, '$ printf "hello\\n"');
    assert.equal(storedSession?.messages.length, 3);
    assert.equal(storedSession?.messages[0]?.role, "user");
    assert.equal(storedSession?.messages[0]?.content, 'printf "hello\\n"');
    assert.equal(storedSession?.messages[1]?.kind, "trace");
    assert.match(storedSession?.messages[1]?.content ?? "", /command_execution/);
    assert.equal(storedSession?.messages[2]?.kind, "response");
    assert.match(storedSession?.messages[2]?.content ?? "", /hello/);
    assert.match(storedSession?.messages[2]?.content ?? "", /Status: completed/);
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("createRun creates an AI thread before chatting in an unbound shell session", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "cui-session-service-"));
  const store = new JsonSessionStore(join(cwd, "sessions.json"));
  const aiModel = new FakeAiModel();
  const service = new SessionService(aiModel, store, createSilentLogger());

  try {
    await store.createSession({
      id: "shell-session-1",
      origin: "shell",
      workspace: cwd,
      title: "$ printf hello",
      summary: "Shell session",
      createdAt: "2026-08-22T00:00:00.000Z",
      updatedAt: "2026-08-22T00:00:00.000Z",
      messages: [
        {
          id: "message-1",
          role: "user",
          content: "printf hello",
          createdAt: "2026-08-22T00:00:00.000Z",
        },
        {
          id: "message-2",
          role: "assistant",
          kind: "response",
          content: "$ printf hello\n\nhello\n\nStatus: completed",
          createdAt: "2026-08-22T00:00:01.000Z",
        },
      ],
    });

    const submitted = await service.createRun(
      "shell-session-1",
      createAssistantRunRequest("Explain this output.", {
        harness: "codex",
        normal: "GPT-5.4",
      }),
    );
    const events: unknown[] = [];

    service.subscribeToRun(submitted.run.id, (event) => {
      events.push(event);
    });

    assert.equal(aiModel.createStreamInputs.length, 1);
    assert.equal(aiModel.continueStreamInputs.length, 0);
    assert.match(aiModel.createStreamInputs[0]?.prompt ?? "", /用户：printf hello/);
    assert.match(aiModel.createStreamInputs[0]?.prompt ?? "", /助手：\$ printf hello/);
    assert.match(aiModel.createStreamInputs[0]?.prompt ?? "", /用户：Explain this output\./);

    await waitFor(() => aiModel.summaryPrompts.length === 1);
    aiModel.resolveSummary({
      title: "Shell input",
      progress: "The shell follow-up input has been summarized.",
    });
    aiModel.resolveRun({
      sessionId: "codex-thread-1",
      content: "It printed hello.",
      rawEvents: [],
    });
    await waitFor(() => aiModel.summaryPrompts.length === 2);
    aiModel.resolveSummary(
      {
        title: "Shell explained",
        progress: "The shell output has been explained.",
      },
      1,
    );

    await waitFor(() => events.some(isDoneEvent));

    const storedSession = await store.getSession("shell-session-1");
    const publicSession = await service.getSessionView("shell-session-1");

    assert.equal(storedSession?.id, "shell-session-1");
    assert.equal(storedSession?.aiThreadId, "codex-thread-1");
    assert.equal(storedSession?.aiHarness, "codex");
    assert.equal(publicSession?.id, "shell-session-1");
    assert.equal("aiThreadId" in (publicSession ?? {}), false);
    assert.equal(publicSession?.messages.at(-1)?.content, "It printed hello.");
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("createRun resumes a bound Codex thread for later shell-session chat", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "cui-session-service-"));
  const store = new JsonSessionStore(join(cwd, "sessions.json"));
  const aiModel = new FakeAiModel();
  const service = new SessionService(aiModel, store, createSilentLogger());

  try {
    await store.createSession({
      id: "shell-session-1",
      origin: "shell",
      aiThreadId: "codex-thread-1",
      aiHarness: "codex",
      workspace: cwd,
      title: "$ printf hello",
      summary: "Shell session",
      createdAt: "2026-08-22T00:00:00.000Z",
      updatedAt: "2026-08-22T00:00:00.000Z",
      messages: [],
    });

    const submitted = await service.createRun(
      "shell-session-1",
      createAssistantRunRequest("Follow up."),
    );
    const events: unknown[] = [];

    service.subscribeToRun(submitted.run.id, (event) => {
      events.push(event);
    });

    assert.equal(aiModel.createStreamInputs.length, 0);
    assert.equal(aiModel.continueStreamInputs.length, 1);
    assert.equal(aiModel.continueStreamInputs[0]?.sessionId, "codex-thread-1");
    assert.equal(aiModel.continueStreamInputs[0]?.models?.harness, "codex");

    await waitFor(() => aiModel.summaryPrompts.length === 1);
    aiModel.resolveSummary({
      title: "Shell follow-up input",
      progress: "The bound thread input was summarized.",
    });
    aiModel.resolveRun({
      sessionId: "codex-thread-1",
      content: "Continued.",
      rawEvents: [],
    });
    await waitFor(() => aiModel.summaryPrompts.length === 2);
    aiModel.resolveSummary(
      {
        title: "Shell follow-up",
        progress: "The bound thread was resumed.",
      },
      1,
    );

    await waitFor(() => events.some(isDoneEvent));

    const storedSession = await store.getSession("shell-session-1");

    assert.equal(storedSession?.id, "shell-session-1");
    assert.equal(storedSession?.aiThreadId, "codex-thread-1");
    assert.equal(storedSession?.messages.at(-1)?.content, "Continued.");
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("createRun creates a TraeX thread for any session without a bound TraeX thread", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "cui-session-service-"));
  const store = new JsonSessionStore(join(cwd, "sessions.json"));
  const aiModel = new FakeAiModel();
  const service = new SessionService(aiModel, store, createSilentLogger());

  try {
    await store.createSession({
      id: "legacy-shell-session-1",
      workspace: cwd,
      title: "$ pwd",
      summary: "Shell session",
      createdAt: "2026-08-22T00:00:00.000Z",
      updatedAt: "2026-08-22T00:00:00.000Z",
      messages: [
        {
          id: "message-1",
          role: "user",
          content: "pwd",
          createdAt: "2026-08-22T00:00:00.000Z",
        },
      ],
    });

    const submitted = await service.createRun(
      "legacy-shell-session-1",
      createAssistantRunRequest("Explain this."),
    );
    const events: unknown[] = [];

    service.subscribeToRun(submitted.run.id, (event) => {
      events.push(event);
    });

    assert.equal(aiModel.createStreamInputs.length, 1);
    assert.equal(aiModel.continueStreamInputs.length, 0);

    await waitFor(() => aiModel.summaryPrompts.length === 1);
    aiModel.resolveSummary({
      title: "Legacy input",
      progress: "The legacy shell input was summarized.",
    });
    aiModel.resolveRun({
      sessionId: "traex-thread-legacy",
      content: "Explained.",
      rawEvents: [],
    });
    await waitFor(() => aiModel.summaryPrompts.length === 2);
    aiModel.resolveSummary(
      {
        title: "Legacy shell",
        progress: "The legacy shell session was rebound.",
      },
      1,
    );

    await waitFor(() => events.some(isDoneEvent));

    const storedSession = await store.getSession("legacy-shell-session-1");

    assert.equal(storedSession?.aiThreadId, "traex-thread-legacy");
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("createSessionContainer expands home workspace before creating a run", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "cui-session-service-"));
  const store = new JsonSessionStore(join(cwd, "sessions.json"));
  const aiModel = new FakeAiModel();
  const service = new SessionService(aiModel, store, createSilentLogger());

  try {
    const session = await service.createSessionContainer({
      workspace: "~",
      title: "Use my home directory.",
    });
    const submitted = await service.createRun(
      session.id,
      createAssistantRunRequest("Use my home directory."),
    );
    const events: unknown[] = [];

    service.subscribeToRun(submitted.run.id, (event) => {
      events.push(event);
    });

    assert.equal(aiModel.createStreamInputs[0]?.workspace, homedir());
    assert.equal(submitted.session.workspace, homedir());
    await waitFor(() => aiModel.summaryPrompts.length === 1);
    aiModel.resolveSummary({
      title: "Home input",
      progress: "The home workspace input was summarized.",
    });
    aiModel.resolveRun({
      sessionId: "created-session-1",
      content: "Done.",
      rawEvents: [],
    });
    await waitFor(() => aiModel.summaryPrompts.length === 2);
    aiModel.resolveSummary(
      {
        title: "Home workspace",
        progress: "The home workspace was accepted.",
      },
      1,
    );
    await waitFor(() => events.some(isDoneEvent));
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("createSessionContainer rejects missing workspaces before calling the model", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "cui-session-service-"));
  const store = new JsonSessionStore(join(cwd, "sessions.json"));
  const aiModel = new FakeAiModel();
  const service = new SessionService(aiModel, store, createSilentLogger());

  try {
    await assert.rejects(
      () =>
        service.createSessionContainer({
          workspace: join(cwd, "missing"),
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
  readonly createStreamInputs: Array<{
    workspace: string;
    prompt: string;
    models?: AiModelPreferences;
  }> = [];
  readonly continueStreamInputs: Array<{
    sessionId: string;
    workspace: string;
    prompt: string;
    models?: AiModelPreferences;
  }> = [];
  readonly atomicReviewInputs: AiAtomicDiffReviewInput[] = [];
  cancelled = false;
  private readonly runs: Array<ReturnType<typeof createDeferred<AiRunResult>>> = [];
  private readonly summaries: Array<ReturnType<typeof createDeferred<ConversationSummary>>> = [];
  private readonly atomicReview = createDeferred<AtomicDiffReview>();
  private readonly streamEventHandlers: Array<(event: AiRunEvent) => void> = [];

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
    const summary = createDeferred<ConversationSummary>();

    this.summaryPrompts.push(input.prompt);
    this.summaryModels.push(input.models);
    this.summaries.push(summary);

    return summary.promise;
  }

  createSessionStream(
    input: { workspace: string; prompt: string; models?: AiModelPreferences },
    onEvent: (event: AiRunEvent) => void,
  ): AiRun {
    const run = createDeferred<AiRunResult>();

    this.runs.push(run);
    this.createStreamInputs.push(input);
    this.streamEventHandlers.push(onEvent);

    return {
      sessionId: Promise.resolve("created-session-1"),
      result: run.promise,
      cancel: () => {
        this.cancelled = true;
        run.reject(new AiRunCancelledError());
      },
    };
  }

  continueSessionStream(
    input: {
      sessionId: string;
      workspace: string;
      prompt: string;
      models?: AiModelPreferences;
    },
    onEvent: (event: AiRunEvent) => void,
  ): AiRun {
    const run = createDeferred<AiRunResult>();

    this.runs.push(run);
    this.continueStreamInputs.push(input);
    this.runModels.push(input.models);
    this.streamEventHandlers.push(onEvent);

    return {
      sessionId: Promise.resolve(input.sessionId),
      result: run.promise,
      cancel: () => {
        this.cancelled = true;
        run.reject(new AiRunCancelledError());
      },
    };
  }

  emitRawEvent(event: unknown, index = 0) {
    this.streamEventHandlers[index]?.({
      type: "raw",
      event,
    });
  }

  resolveRun(result: AiRunResult, index = 0) {
    this.runs[index]?.resolve(result);
  }

  resolveSummary(summary: ConversationSummary, index = 0) {
    this.summaries[index]?.resolve(summary);
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
  type: "run.succeeded";
  session: { title: string; messages: Array<{ content: string }> };
} {
  return isEventWithType(event) && event.type === "run.succeeded";
}

function isEventWithType(event: unknown): event is { type: string } {
  return (
    Boolean(event) && typeof event === "object" && "type" in event && typeof event.type === "string"
  );
}

async function getStoredTitle(store: JsonSessionStore): Promise<string | undefined> {
  return (await store.getSession("session-1"))?.title;
}

function createAssistantRunRequest(prompt: string, models?: AiModelPreferences) {
  return {
    type: "assistant_response" as const,
    input: { prompt },
    ...(models ? { models } : {}),
  };
}
