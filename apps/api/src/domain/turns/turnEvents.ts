import type { ChatSessionView } from '../../types.js';

export type TurnStreamEvent =
  | {
      type: 'delta';
      text: string;
    }
  | {
      type: 'raw';
      event: unknown;
    }
  | {
      type: 'done';
      session: ChatSessionView;
    }
  | {
      type: 'failed';
      error: string;
    };
