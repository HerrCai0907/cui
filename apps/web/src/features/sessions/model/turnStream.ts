import type { TurnStreamEvent } from "../../../types";

export function parseTurnStreamEvent(event: Event): TurnStreamEvent | undefined {
  if (!(event instanceof MessageEvent)) {
    return undefined;
  }

  try {
    return JSON.parse(event.data) as TurnStreamEvent;
  } catch {
    return undefined;
  }
}
