import { randomUUID } from "node:crypto";
import type { TurnStreamEvent } from "./turnEvents.js";

type StoredTurnStreamEvent = {
  id: number;
  event: TurnStreamEvent;
};

export type RunningTurn = {
  id: string;
  sessionId: string;
  events: StoredTurnStreamEvent[];
  subscribers: Set<(event: StoredTurnStreamEvent) => void>;
  completed: boolean;
  completion: Promise<TurnStreamEvent>;
  nextEventId: number;
  cancel: () => void;
  resolveCompletion: (event: TurnStreamEvent) => void;
};

export class TurnRegistry {
  private readonly runningTurns = new Map<string, RunningTurn>();
  private readonly activeSessionIds = new Set<string>();

  isSessionActive(sessionId: string): boolean {
    return this.activeSessionIds.has(sessionId);
  }

  getRunningTurnIdForSession(sessionId: string): string | undefined {
    for (const turn of this.runningTurns.values()) {
      if (turn.sessionId === sessionId && !turn.completed) {
        return turn.id;
      }
    }

    return undefined;
  }

  getRunningTurnForSession(sessionId: string): RunningTurn | undefined {
    for (const turn of this.runningTurns.values()) {
      if (turn.sessionId === sessionId && !turn.completed) {
        return turn;
      }
    }

    return undefined;
  }

  hasRunningTurn(turnId: string): boolean {
    return this.runningTurns.has(turnId);
  }

  createRunningTurn(sessionId: string, cancel: () => void): RunningTurn {
    let resolveCompletion!: (event: TurnStreamEvent) => void;
    const completion = new Promise<TurnStreamEvent>((resolve) => {
      resolveCompletion = resolve;
    });
    const turn: RunningTurn = {
      id: randomUUID(),
      sessionId,
      events: [],
      subscribers: new Set(),
      completed: false,
      completion,
      nextEventId: 1,
      cancel,
      resolveCompletion,
    };

    this.runningTurns.set(turn.id, turn);
    this.activeSessionIds.add(sessionId);

    return turn;
  }

  emitTurnEvent(turn: RunningTurn, event: TurnStreamEvent): void {
    const storedEvent = {
      id: turn.nextEventId,
      event,
    };

    turn.nextEventId += 1;
    turn.events.push(storedEvent);
    turn.subscribers.forEach((subscriber) => subscriber(storedEvent));

    if (event.type === "done" || event.type === "failed" || event.type === "cancelled") {
      turn.completed = true;
      turn.resolveCompletion(event);
      this.activeSessionIds.delete(turn.sessionId);
      setTimeout(
        () => {
          this.runningTurns.delete(turn.id);
        },
        5 * 60 * 1000,
      ).unref();
    }
  }

  subscribeToTurn(turnId: string, onEvent: (event: TurnStreamEvent) => void): () => void {
    const turn = this.runningTurns.get(turnId);

    if (!turn) {
      return () => undefined;
    }

    const subscriber = (storedEvent: StoredTurnStreamEvent) => onEvent(storedEvent.event);

    turn.events.forEach(subscriber);

    if (!turn.completed) {
      turn.subscribers.add(subscriber);
    }

    return () => {
      turn.subscribers.delete(subscriber);
    };
  }
}
