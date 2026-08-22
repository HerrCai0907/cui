import type express from 'express';
import type { TurnStreamEvent } from '../../domain/sessions/SessionService.js';

export function writeSse(
  response: express.Response,
  eventName: string,
  event: TurnStreamEvent,
): void {
  response.write(`event: ${eventName}\n`);
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}
