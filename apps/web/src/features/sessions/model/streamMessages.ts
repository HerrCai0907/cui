import { encodeExecutionTraceEvent } from '../../trace/model/parseExecutionTrace';
import type { ApiMessage, ApiSession } from '../../../types';

export type StreamMessageState = {
  streamedTrace: string;
  streamedResponse: string;
};

export function createStreamMessageState(): StreamMessageState {
  return {
    streamedTrace: '',
    streamedResponse: '',
  };
}

export function appendResponseDelta(
  session: ApiSession,
  input: {
    state: StreamMessageState;
    sessionId: string;
    responseMessageId: string;
    text: string;
  },
): ApiSession {
  if (session.id !== input.sessionId || !input.text) {
    return session;
  }

  input.state.streamedResponse += input.text;

  const existingMessage = session.messages.find(
    (message) => message.id === input.responseMessageId,
  );

  if (existingMessage) {
    return {
      ...session,
      messages: session.messages.map((message) =>
        message.id === input.responseMessageId
          ? { ...message, content: input.state.streamedResponse }
          : message,
      ),
    };
  }

  const streamMessage: ApiMessage = {
    id: input.responseMessageId,
    role: 'assistant',
    kind: 'response',
    content: input.state.streamedResponse,
    createdAt: new Date().toISOString(),
  };

  return {
    ...session,
    messages: [...session.messages, streamMessage],
  };
}

export function appendTraceEvent(
  session: ApiSession,
  input: {
    state: StreamMessageState;
    sessionId: string;
    traceMessageId: string;
    responseMessageId: string;
    rawEvent: unknown;
  },
): ApiSession | undefined {
  if (session.id !== input.sessionId) {
    return session;
  }

  const json = encodeExecutionTraceEvent(input.rawEvent);

  if (!json) {
    return undefined;
  }

  input.state.streamedTrace = input.state.streamedTrace
    ? `${input.state.streamedTrace}\n${json}`
    : json;

  const existingMessage = session.messages.find(
    (message) => message.id === input.traceMessageId,
  );

  if (existingMessage) {
    return {
      ...session,
      messages: session.messages.map((message) =>
        message.id === input.traceMessageId
          ? { ...message, content: input.state.streamedTrace }
          : message,
      ),
    };
  }

  const streamMessage: ApiMessage = {
    id: input.traceMessageId,
    role: 'assistant',
    kind: 'trace',
    content: input.state.streamedTrace,
    createdAt: new Date().toISOString(),
  };
  const responseIndex = session.messages.findIndex(
    (message) => message.id === input.responseMessageId,
  );
  const messages =
    responseIndex === -1
      ? [...session.messages, streamMessage]
      : [
          ...session.messages.slice(0, responseIndex),
          streamMessage,
          ...session.messages.slice(responseIndex),
        ];

  return {
    ...session,
    messages,
  };
}
