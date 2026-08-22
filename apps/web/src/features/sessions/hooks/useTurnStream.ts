import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useEffect,
  useRef,
} from 'react';
import type { ApiSession } from '../../../types';
import {
  appendResponseDelta,
  appendTraceEvent,
  createStreamMessageState,
} from '../model/streamMessages';
import { parseTurnStreamEvent } from '../model/turnStream';

type UseTurnStreamInput = {
  activeSessionRef: MutableRefObject<ApiSession | null>;
  refreshSessions: () => void;
  setActiveSession: Dispatch<SetStateAction<ApiSession | null>>;
  setCurrentActiveSession: (session: ApiSession | null) => void;
  setError: (error: string | null) => void;
  setExpandedTraceIds: Dispatch<SetStateAction<Set<string>>>;
  setRunningSession: (sessionId: string, running: boolean) => void;
};

export function useTurnStream({
  activeSessionRef,
  refreshSessions,
  setActiveSession,
  setCurrentActiveSession,
  setError,
  setExpandedTraceIds,
  setRunningSession,
}: UseTurnStreamInput) {
  const eventSourceRefs = useRef<Map<string, EventSource>>(new Map());

  useEffect(() => {
    return () => {
      eventSourceRefs.current.forEach((eventSource) => {
        eventSource.close();
      });
      eventSourceRefs.current.clear();
    };
  }, []);

  function streamTurn(sessionId: string, turnId: string) {
    eventSourceRefs.current.get(sessionId)?.close();

    const eventSource = new EventSource(`/api/turns/${turnId}/events`);
    eventSourceRefs.current.set(sessionId, eventSource);
    const streamingTraceMessageId = `stream-${turnId}-trace`;
    const streamingResponseMessageId = `stream-${turnId}-response`;
    const streamMessageState = createStreamMessageState();
    let streamClosed = false;

    const closeCurrentStream = () => {
      eventSource.close();
      if (eventSourceRefs.current.get(sessionId) === eventSource) {
        eventSourceRefs.current.delete(sessionId);
      }
    };

    const updateResponseMessage = (text: string) => {
      setActiveSession((session) => {
        if (!session) {
          return session;
        }

        const nextSession = appendResponseDelta(session, {
          state: streamMessageState,
          sessionId,
          responseMessageId: streamingResponseMessageId,
          text,
        });

        activeSessionRef.current = nextSession;
        return nextSession;
      });
    };

    const updateTraceMessage = (rawEvent: unknown) => {
      setActiveSession((session) => {
        if (!session) {
          return session;
        }

        const nextSession = appendTraceEvent(session, {
          state: streamMessageState,
          sessionId,
          traceMessageId: streamingTraceMessageId,
          responseMessageId: streamingResponseMessageId,
          rawEvent,
        });

        if (!nextSession) {
          return session;
        }

        activeSessionRef.current = nextSession;
        setExpandedTraceIds((current) =>
          new Set(current).add(streamingTraceMessageId),
        );
        return nextSession;
      });
    };

    eventSource.addEventListener('delta', (event) => {
      const data = parseTurnStreamEvent(event);

      if (data?.type === 'delta') {
        updateResponseMessage(data.text);
      }
    });

    eventSource.addEventListener('raw', (event) => {
      const data = parseTurnStreamEvent(event);

      if (data?.type === 'raw') {
        updateTraceMessage(data.event);
      }
    });

    eventSource.addEventListener('done', (event) => {
      const data = parseTurnStreamEvent(event);

      if (data?.type !== 'done') {
        return;
      }

      if (activeSessionRef.current?.id === data.session.id) {
        setCurrentActiveSession(data.session);
      }
      setExpandedTraceIds((current) => {
        const next = new Set(current);

        next.delete(streamingTraceMessageId);

        return next;
      });
      setRunningSession(sessionId, false);
      refreshSessions();
      streamClosed = true;
      closeCurrentStream();
    });

    eventSource.addEventListener('failed', (event) => {
      const data = parseTurnStreamEvent(event);

      if (activeSessionRef.current?.id === sessionId) {
        setError(data?.type === 'failed' ? data.error : 'Request failed');
      }
      setRunningSession(sessionId, false);
      streamClosed = true;
      closeCurrentStream();
    });

    eventSource.onerror = () => {
      if (streamClosed) {
        return;
      }

      if (activeSessionRef.current?.id === sessionId) {
        setError('Stream connection failed');
      }
      setRunningSession(sessionId, false);
      closeCurrentStream();
    };
  }

  return { streamTurn };
}
