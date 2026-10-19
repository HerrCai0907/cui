import { randomUUID } from "node:crypto";
import { compactRunStreamEvent, type RunStreamEvent } from "./runEvents.js";
import type {
  PersistedRunStreamEvent,
  SessionStore,
  StoredRunStreamEvent,
} from "../../infrastructure/store/SessionStore.js";

const DEFAULT_MAX_STORED_RUN_EVENTS = 500;
const RUN_EVENT_GENERATION_COUNT = 3;

type RunEventStore = Pick<SessionStore, "appendRunEvents">;
type RunEventGeneration = PersistedRunStreamEvent[];

export type RunningRun = {
  id: string;
  sessionId: string;
  type: "assistant_response" | "shell_command" | "round_review";
  createdAt: string;
  eventGenerations: RunEventGeneration[];
  subscribers: Set<(event: StoredRunStreamEvent) => void>;
  completed: boolean;
  completion: Promise<RunStreamEvent>;
  nextEventId: number;
  persistence: Promise<void>;
  cancel: () => void;
  resolveCompletion: (event: RunStreamEvent) => void;
};

export class RunRegistry {
  private readonly runningRuns = new Map<string, RunningRun>();
  private readonly activeSessionIds = new Set<string>();
  private readonly pendingSubscribers = new Map<
    string,
    Set<(event: StoredRunStreamEvent) => void>
  >();
  private readonly store: RunEventStore | undefined;
  private readonly generationCapacity: number;

  constructor(store: RunEventStore, maxStoredRunEvents?: number);
  constructor(maxStoredRunEvents?: number);
  constructor(
    storeOrMaxStoredRunEvents: RunEventStore | number | undefined = DEFAULT_MAX_STORED_RUN_EVENTS,
    maxStoredRunEvents = DEFAULT_MAX_STORED_RUN_EVENTS,
  ) {
    if (typeof storeOrMaxStoredRunEvents === "number") {
      this.generationCapacity = getGenerationCapacity(storeOrMaxStoredRunEvents);
      return;
    }

    this.store = storeOrMaxStoredRunEvents;
    this.generationCapacity = getGenerationCapacity(maxStoredRunEvents);
  }

  isSessionActive(sessionId: string): boolean {
    return this.activeSessionIds.has(sessionId);
  }

  getRunningRunIdForSession(sessionId: string): string | undefined {
    for (const run of this.runningRuns.values()) {
      if (run.sessionId === sessionId && !run.completed) {
        return run.id;
      }
    }

    return undefined;
  }

  getRunningRunForSession(sessionId: string): RunningRun | undefined {
    for (const run of this.runningRuns.values()) {
      if (run.sessionId === sessionId && !run.completed) {
        return run;
      }
    }

    return undefined;
  }

  getRunningRun(runId: string): RunningRun | undefined {
    return this.runningRuns.get(runId);
  }

  hasRunningRun(runId: string): boolean {
    return this.runningRuns.has(runId);
  }

  createRunningRun(
    sessionId: string,
    type: RunningRun["type"],
    cancel: () => void,
    options: { runId?: string; createdAt?: string } = {},
  ): RunningRun {
    let resolveCompletion!: (event: RunStreamEvent) => void;
    const completion = new Promise<RunStreamEvent>((resolve) => {
      resolveCompletion = resolve;
    });
    const run: RunningRun = {
      id: options.runId ?? randomUUID(),
      sessionId,
      type,
      createdAt: options.createdAt ?? new Date().toISOString(),
      eventGenerations: createEmptyGenerations(),
      subscribers: new Set(),
      completed: false,
      completion,
      nextEventId: 1,
      persistence: Promise.resolve(),
      cancel,
      resolveCompletion,
    };

    this.runningRuns.set(run.id, run);
    this.activeSessionIds.add(sessionId);
    const pendingSubscribers = this.pendingSubscribers.get(run.id);

    if (pendingSubscribers) {
      pendingSubscribers.forEach((subscriber) => run.subscribers.add(subscriber));
      this.pendingSubscribers.delete(run.id);
    }

    return run;
  }

  emitRunEvent(run: RunningRun, event: RunStreamEvent): void {
    const compactedEvent = compactRunStreamEvent(event);
    const storedEvent: PersistedRunStreamEvent = {
      runId: run.id,
      sessionId: run.sessionId,
      id: run.nextEventId,
      event: compactedEvent,
      createdAt: new Date().toISOString(),
    };

    run.nextEventId += 1;
    this.appendToNewestGeneration(run, storedEvent);
    this.enqueuePersistence(run, [storedEvent]);
    run.subscribers.forEach((subscriber) => subscriber(storedEvent));

    if (
      compactedEvent.type === "run.succeeded" ||
      compactedEvent.type === "run.failed" ||
      compactedEvent.type === "run.cancelled"
    ) {
      run.completed = true;
      run.resolveCompletion(compactedEvent);
      this.activeSessionIds.delete(run.sessionId);
      void this.flushRunEvents(run).catch(() => undefined);
      setTimeout(
        () => {
          this.runningRuns.delete(run.id);
        },
        5 * 60 * 1000,
      ).unref();
    }
  }

  async flushRunEvents(run: RunningRun): Promise<void> {
    if (!this.store) {
      return run.persistence;
    }

    const events = this.getBufferedEvents(run);

    run.eventGenerations = createEmptyGenerations();
    this.enqueuePersistence(run, events as PersistedRunStreamEvent[]);

    return run.persistence;
  }

  subscribeToRun(runId: string, onEvent: (event: RunStreamEvent) => void): () => void {
    return this.subscribeToRunEvents(runId, (event) => onEvent(event.event));
  }

  subscribeToRunEvents(runId: string, onEvent: (event: StoredRunStreamEvent) => void): () => void {
    const run = this.runningRuns.get(runId);

    if (!run) {
      const subscribers = this.pendingSubscribers.get(runId) ?? new Set();

      subscribers.add(onEvent);
      this.pendingSubscribers.set(runId, subscribers);

      return () => {
        subscribers.delete(onEvent);
        if (subscribers.size === 0) {
          this.pendingSubscribers.delete(runId);
        }
      };
    }

    this.getBufferedEvents(run).forEach(onEvent);

    if (!run.completed) {
      run.subscribers.add(onEvent);
    }

    return () => {
      run.subscribers.delete(onEvent);
    };
  }

  getBufferedEvents(runId: string): StoredRunStreamEvent[];
  getBufferedEvents(run: RunningRun): StoredRunStreamEvent[];
  getBufferedEvents(runOrRunId: RunningRun | string): StoredRunStreamEvent[] {
    const run = typeof runOrRunId === "string" ? this.runningRuns.get(runOrRunId) : runOrRunId;

    if (!run) {
      return [];
    }

    return run.eventGenerations.flat();
  }

  private appendToNewestGeneration(run: RunningRun, storedEvent: PersistedRunStreamEvent): void {
    run.eventGenerations[RUN_EVENT_GENERATION_COUNT - 1].push(storedEvent);

    if (run.eventGenerations[RUN_EVENT_GENERATION_COUNT - 1].length >= this.generationCapacity) {
      this.rotateGenerations(run);
    }
  }

  private rotateGenerations(run: RunningRun): void {
    const [oldestGeneration, ...remainingGenerations] = run.eventGenerations;

    run.eventGenerations = [...remainingGenerations, []];
    this.enqueuePersistence(run, oldestGeneration);
  }

  private enqueuePersistence(run: RunningRun, events: PersistedRunStreamEvent[]): void {
    const durableEvents = events.filter(isDurableRunContentEvent);

    if (!this.store || durableEvents.length === 0) {
      return;
    }

    run.persistence = run.persistence
      .catch(() => undefined)
      .then(() => this.store?.appendRunEvents(durableEvents));
  }
}

function createEmptyGenerations(): RunEventGeneration[] {
  return Array.from({ length: RUN_EVENT_GENERATION_COUNT }, () => []);
}

function getGenerationCapacity(maxStoredRunEvents: number): number {
  return Math.max(1, Math.floor(maxStoredRunEvents / RUN_EVENT_GENERATION_COUNT));
}

function isDurableRunContentEvent(event: PersistedRunStreamEvent): boolean {
  return event.event.type === "run.trace" || event.event.type === "run.output.delta";
}
