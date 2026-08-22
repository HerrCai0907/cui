import type { ConversationSummary } from '../../types.js';
import { getStringProperty } from './jsonFields.js';
import { limitCharacters, parseSummaryJson } from './summaryJson.js';

export function parseConversationSummary(content: string): ConversationSummary {
  const parsed = parseSummaryJson(content);

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Conversation summary was not valid JSON');
  }

  const title = getStringProperty(parsed, 'title')?.trim();
  const progress = getStringProperty(parsed, 'progress')?.trim();

  if (!title || !progress) {
    throw new Error(
      'Conversation summary JSON must include title and progress',
    );
  }

  return {
    title: limitCharacters(title, 30),
    progress: limitCharacters(progress, 200),
  };
}
