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
import { toSessionSummary } from '../model/sessionSummaries';
import { parseTurnStreamEvent } from '../model/turnStream';
import type { SessionSummary } from '../../../types';

type UseTurnStreamInput = {
  activeSessionRef: MutableRefObject<ApiSession | null>;
  refreshSessions: () => void;
  setActiveSession: Dispatch<SetStateAction<ApiSession | null>>;
  setCurrentActiveSession: (session: ApiSession | null) => void;
  setError: (error: string | null) => void;
  setExpandedTraceIds: Dispatch<SetStateAction<Set<string>>>;
  setRunningSession: (sessionId: string, running: boolean) => void;
  setSessions: Dispatch<SetStateAction<SessionSummary[]>>;
};

export function useTurnStream({
  activeSessionRef,
  refreshSessions,
  setActiveSession,
  setCurrentActiveSession,
  setError,
  setExpandedTraceIds,
  setRunningSession,
  setSessions,
}: UseTurnStreamInput) {
  const eventSourceRefs = useRef<Map<string, EventSource>>(new Map());
  const turnIdRefs = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    return () => {
      eventSourceRefs.current.forEach((eventSource) => {
        eventSource.close();
      });
      eventSourceRefs.current.clear();
      turnIdRefs.current.clear();
    };
  }, []);

  function streamTurn(sessionId: string, turnId: string) {
    if (
      turnIdRefs.current.get(sessionId) === turnId &&
      eventSourceRefs.current.has(sessionId)
    ) {
      return;
    }

    eventSourceRefs.current.get(sessionId)?.close();

    const eventSource = new EventSource(`/api/turns/${turnId}/events`);
    eventSourceRefs.current.set(sessionId, eventSource);
    turnIdRefs.current.set(sessionId, turnId);
    const streamingTraceMessageId = `stream-${turnId}-trace`;
    const streamingResponseMessageId = `stream-${turnId}-response`;
    const streamMessageState = createStreamMessageState();
    let streamClosed = false;

    const closeCurrentStream = () => {
      eventSource.close();
      if (eventSourceRefs.current.get(sessionId) === eventSource) {
        eventSourceRefs.current.delete(sessionId);
        turnIdRefs.current.delete(sessionId);
      }
    };

    const updateResponseMessage = (text: string) => {
      setActiveSession((session) => {
        const currentSession = session ?? activeSessionRef.current;

        if (!currentSession) {
          return session;
        }

        const nextSession = appendResponseDelta(currentSession, {
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
        const currentSession = session ?? activeSessionRef.current;

        if (!currentSession) {
          return session;
        }

        const nextSession = appendTraceEvent(currentSession, {
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

    const updateSessionMetadata = (updatedSession: ApiSession) => {
      setActiveSession((session) => {
        const currentSession = session ?? activeSessionRef.current;

        if (currentSession?.id !== updatedSession.id) {
          return session;
        }

        const nextSession = {
          ...currentSession,
          title: updatedSession.title,
          summary: updatedSession.summary,
          updatedAt: updatedSession.updatedAt,
          currentRound: updatedSession.currentRound,
          isRunning: updatedSession.isRunning,
          runningTurnId: updatedSession.runningTurnId,
        };

        activeSessionRef.current = nextSession;
        return nextSession;
      });
      setSessions((current) => {
        const nextSummary = toSessionSummary(updatedSession);

        return current.some((session) => session.id === updatedSession.id)
          ? current.map((session) =>
              session.id === updatedSession.id ? nextSummary : session,
            )
          : [nextSummary, ...current];
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

    eventSource.addEventListener('session.updated', (event) => {
      const data = parseTurnStreamEvent(event);

      if (data?.type !== 'session.updated') {
        return;
      }

      updateSessionMetadata(data.session);
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
