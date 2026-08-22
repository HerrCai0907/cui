import { randomUUID } from 'node:crypto';
import type { TurnStreamEvent } from './turnEvents.js';

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
  nextEventId: number;
};

export class TurnRegistry {
  private readonly runningTurns = new Map<string, RunningTurn>();
  private readonly activeSessionIds = new Set<string>();

  isSessionActive(sessionId: string): boolean {
    return this.activeSessionIds.has(sessionId);
  }

  hasRunningTurn(turnId: string): boolean {
    return this.runningTurns.has(turnId);
  }

  createRunningTurn(sessionId: string): RunningTurn {
    const turn: RunningTurn = {
      id: randomUUID(),
      sessionId,
      events: [],
      subscribers: new Set(),
      completed: false,
      nextEventId: 1,
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

    if (event.type === 'done' || event.type === 'failed') {
      turn.completed = true;
      this.activeSessionIds.delete(turn.sessionId);
      setTimeout(
        () => {
          this.runningTurns.delete(turn.id);
        },
        5 * 60 * 1000,
      ).unref();
    }
  }

  subscribeToTurn(
    turnId: string,
    onEvent: (event: TurnStreamEvent) => void,
  ): () => void {
    const turn = this.runningTurns.get(turnId);

    if (!turn) {
      return () => undefined;
    }

    const subscriber = (storedEvent: StoredTurnStreamEvent) =>
      onEvent(storedEvent.event);

    turn.events.forEach(subscriber);

    if (!turn.completed) {
      turn.subscribers.add(subscriber);
    }

    return () => {
      turn.subscribers.delete(subscriber);
    };
  }
}
