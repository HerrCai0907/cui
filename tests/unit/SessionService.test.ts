import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SessionService } from '../../apps/api/src/domain/sessions/SessionService.js';
import { JsonSessionStore } from '../../apps/api/src/infrastructure/store/JsonSessionStore.js';
import type { AppLogger } from '../../apps/api/src/infrastructure/logging/AppLogger.js';
import type {
  AiModel,
  AiResponse,
  AiRun,
  AiRunResult,
  ConversationSummary,
} from '../../apps/api/src/types.js';

test('beginContinueSession refreshes summary after user input and before turn completion', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'cui-session-service-'));
  const store = new JsonSessionStore(join(cwd, 'sessions.json'));
  const aiModel = new FakeAiModel();
  const service = new SessionService(aiModel, store, createSilentLogger());

  try {
    await store.createSession({
      id: 'session-1',
      workspace: cwd,
      title: 'Initial title',
      summary: '',
      createdAt: '2026-08-22T00:00:00.000Z',
      updatedAt: '2026-08-22T00:00:00.000Z',
      messages: [
        {
          id: 'message-1',
          role: 'assistant',
          kind: 'response',
          content: 'Previous answer.',
          createdAt: '2026-08-22T00:00:00.000Z',
        },
      ],
      rounds: [],
    });

    const submitted = await service.beginContinueSession('session-1', {
      prompt: 'Explain when the summary should run.',
    });
    const events: unknown[] = [];

    service.subscribeToTurn(submitted.turnId, (event) => {
      events.push(event);
    });

    assert.equal(aiModel.summaryPrompts.length, 1);
    assert.match(
      aiModel.summaryPrompts[0],
      /用户：Explain when the summary should run\./,
    );

    aiModel.resolveRun({
      sessionId: 'session-1',
      content: 'Done.',
      rawEvents: [],
    });
    await flushPromises();

    assert.equal(aiModel.summaryPrompts.length, 1);
    assert.equal(events.some(isDoneEvent), false);

    aiModel.resolveSummary({
      title: 'Summary timing',
      progress: 'The latest user input is summarized before the turn finishes.',
    });
    await waitFor(() => events.length === 2);

    assert.equal(aiModel.summaryPrompts.length, 1);
    assert.deepEqual(
      events.map((event) => eventType(event)),
      ['session.updated', 'done'],
    );
    assert.equal(await getStoredTitle(store), 'Summary timing');

    const doneEvent = events.find(isDoneEvent);
    assert.equal(doneEvent?.session.title, 'Summary timing');
    assert.equal(doneEvent?.session.messages.at(-1)?.content, 'Done.');
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

class FakeAiModel implements AiModel {
  readonly summaryPrompts: string[] = [];
  private readonly run = createDeferred<AiRunResult>();
  private readonly summary = createDeferred<ConversationSummary>();

  async createSession(): Promise<AiResponse> {
    throw new Error('Unexpected createSession call');
  }

  async continueSession(): Promise<AiResponse> {
    throw new Error('Unexpected continueSession call');
  }

  async createAtomicDiffReview() {
    throw new Error('Unexpected createAtomicDiffReview call');
  }

  async summarizeConversation(input: { prompt: string }) {
    this.summaryPrompts.push(input.prompt);

    return this.summary.promise;
  }

  createSessionStream(): AiRun {
    throw new Error('Unexpected createSessionStream call');
  }

  continueSessionStream(): AiRun {
    return {
      sessionId: Promise.resolve('session-1'),
      result: this.run.promise,
    };
  }

  resolveRun(result: AiRunResult) {
    this.run.resolve(result);
  }

  resolveSummary(summary: ConversationSummary) {
    this.summary.resolve(summary);
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

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 1000;

  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }

    await delay(5);
  }

  assert.equal(predicate(), true);
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function eventType(event: unknown): string | undefined {
  return isEventWithType(event) ? event.type : undefined;
}

function isDoneEvent(
  event: unknown,
): event is {
  type: 'done';
  session: { title: string; messages: Array<{ content: string }> };
} {
  return isEventWithType(event) && event.type === 'done';
}

function isEventWithType(event: unknown): event is { type: string } {
  return (
    Boolean(event) &&
    typeof event === 'object' &&
    'type' in event &&
    typeof event.type === 'string'
  );
}

async function getStoredTitle(
  store: JsonSessionStore,
): Promise<string | undefined> {
  return (await store.getSession('session-1'))?.title;
}
