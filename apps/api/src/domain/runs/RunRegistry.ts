import { randomUUID } from "node:crypto";
import type { RunStreamEvent } from "./runEvents.js";

type StoredRunStreamEvent = {
  id: number;
  event: RunStreamEvent;
};

export type RunningRun = {
  id: string;
  sessionId: string;
  type: "assistant_response" | "shell_command" | "round_review";
  createdAt: string;
  events: StoredRunStreamEvent[];
  subscribers: Set<(event: StoredRunStreamEvent) => void>;
  completed: boolean;
  completion: Promise<RunStreamEvent>;
  nextEventId: number;
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
      events: [],
      subscribers: new Set(),
      completed: false,
      completion,
      nextEventId: 1,
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
    const storedEvent = {
      id: run.nextEventId,
      event,
    };

    run.nextEventId += 1;
    run.events.push(storedEvent);
    run.subscribers.forEach((subscriber) => subscriber(storedEvent));

    if (
      event.type === "run.succeeded" ||
      event.type === "run.failed" ||
      event.type === "run.cancelled"
    ) {
      run.completed = true;
      run.resolveCompletion(event);
      this.activeSessionIds.delete(run.sessionId);
      setTimeout(
        () => {
          this.runningRuns.delete(run.id);
        },
        5 * 60 * 1000,
      ).unref();
    }
  }

  subscribeToRun(runId: string, onEvent: (event: RunStreamEvent) => void): () => void {
    const run = this.runningRuns.get(runId);
    const subscriber = (storedEvent: StoredRunStreamEvent) => onEvent(storedEvent.event);

    if (!run) {
      const subscribers = this.pendingSubscribers.get(runId) ?? new Set();

      subscribers.add(subscriber);
      this.pendingSubscribers.set(runId, subscribers);

      return () => {
        subscribers.delete(subscriber);
        if (subscribers.size === 0) {
          this.pendingSubscribers.delete(runId);
        }
      };
    }

    run.events.forEach(subscriber);

    if (!run.completed) {
      run.subscribers.add(subscriber);
    }

    return () => {
      run.subscribers.delete(subscriber);
    };
  }
}
