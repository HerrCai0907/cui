import type express from "express";
import type { RunStreamEvent } from "../../domain/sessions/SessionService.js";

export function writeSse(
  response: express.Response,
  eventName: string,
  event: RunStreamEvent,
): void {
  response.write(`event: ${eventName}\n`);
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}
