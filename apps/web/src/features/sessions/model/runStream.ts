import type { RunStreamEvent } from "../../../types";

export function parseRunStreamEvent(event: Event): RunStreamEvent | undefined {
  if (!(event instanceof MessageEvent)) {
    return undefined;
  }

  try {
    return JSON.parse(event.data) as RunStreamEvent;
  } catch {
    return undefined;
  }
}
