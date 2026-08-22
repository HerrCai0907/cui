import type { ApiMessage } from '../../../types';

export function getMessageTitle(message: ApiMessage): string {
  if (message.kind === 'trace') {
    return 'Execution Trace';
  }

  return message.role === 'assistant' ? 'Assistant' : 'You';
}
