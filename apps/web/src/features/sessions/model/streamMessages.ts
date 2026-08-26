import { encodeExecutionTraceEvent } from "../../trace/model/parseExecutionTrace";
import type { ApiMessage, ApiSession } from "../../../types";

export type StreamMessageState = {
  streamedTrace: string;
  streamedResponse: string;
};

export function createStreamMessageState(): StreamMessageState {
  return {
    streamedTrace: "",
    streamedResponse: "",
  };
}

export function appendResponseDeltaToState(state: StreamMessageState, text: string): boolean {
  if (!text) {
    return false;
  }

  state.streamedResponse += text;

  return true;
}

export function appendTraceEventToState(state: StreamMessageState, rawEvent: unknown): boolean {
  const json = encodeExecutionTraceEvent(rawEvent);

  if (!json) {
    return false;
  }

  state.streamedTrace = state.streamedTrace ? `${state.streamedTrace}\n${json}` : json;

  return true;
}

export function applyStreamMessageState(
  session: ApiSession,
  input: {
    state: StreamMessageState;
    sessionId: string;
    traceMessageId: string;
    responseMessageId: string;
    traceInsertIndex?: number;
  },
): ApiSession {
  if (session.id !== input.sessionId) {
    return session;
  }

  let nextSession = session;

  if (input.state.streamedTrace) {
    nextSession = upsertTraceMessage(nextSession, {
      traceMessageId: input.traceMessageId,
      responseMessageId: input.responseMessageId,
      insertIndex: input.traceInsertIndex,
      content: input.state.streamedTrace,
    });
  }

  if (input.state.streamedResponse) {
    nextSession = upsertResponseMessage(nextSession, {
      responseMessageId: input.responseMessageId,
      content: input.state.streamedResponse,
    });
  }

  return nextSession;
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
  if (session.id !== input.sessionId || !appendResponseDeltaToState(input.state, input.text)) {
    return session;
  }

  return upsertResponseMessage(session, {
    responseMessageId: input.responseMessageId,
    content: input.state.streamedResponse,
  });
}

function upsertResponseMessage(
  session: ApiSession,
  input: {
    responseMessageId: string;
    content: string;
  },
): ApiSession {
  const existingMessage = session.messages.find(
    (message) => message.id === input.responseMessageId,
  );

  if (existingMessage) {
    return {
      ...session,
      messages: session.messages.map((message) =>
        message.id === input.responseMessageId ? { ...message, content: input.content } : message,
      ),
    };
  }

  const streamMessage: ApiMessage = {
    id: input.responseMessageId,
    role: "assistant",
    kind: "response",
    content: input.content,
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

  if (!appendTraceEventToState(input.state, input.rawEvent)) {
    return undefined;
  }

  return applyStreamMessageState(session, input);
}

function upsertTraceMessage(
  session: ApiSession,
  input: {
    traceMessageId: string;
    responseMessageId: string;
    insertIndex?: number;
    content: string;
  },
): ApiSession {
  const existingMessage = session.messages.find((message) => message.id === input.traceMessageId);

  if (existingMessage) {
    return {
      ...session,
      messages: session.messages.map((message) =>
        message.id === input.traceMessageId ? { ...message, content: input.content } : message,
      ),
    };
  }

  const streamMessage: ApiMessage = {
    id: input.traceMessageId,
    role: "assistant",
    kind: "trace",
    content: input.content,
    createdAt: new Date().toISOString(),
  };
  const responseIndex = session.messages.findIndex(
    (message) => message.id === input.responseMessageId,
  );
  const insertionIndex =
    responseIndex === -1 ? clampMessageInsertionIndex(session, input.insertIndex) : responseIndex;
  const messages =
    insertionIndex === session.messages.length
      ? [...session.messages, streamMessage]
      : [
          ...session.messages.slice(0, insertionIndex),
          streamMessage,
          ...session.messages.slice(insertionIndex),
        ];

  return {
    ...session,
    messages,
  };
}

function clampMessageInsertionIndex(session: ApiSession, insertIndex: number | undefined): number {
  if (insertIndex === undefined) {
    return session.messages.length;
  }

  return Math.max(0, Math.min(insertIndex, session.messages.length));
}
