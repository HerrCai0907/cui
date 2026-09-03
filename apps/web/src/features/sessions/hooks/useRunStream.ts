import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useEffect,
  useRef,
} from "react";
import type { ApiSession } from "../../../types";
import {
  appendResponseDeltaToState,
  appendTraceEventToState,
  applyStreamMessageState,
  createStreamMessageState,
  type StreamMessageState,
} from "../model/streamMessages";
import { toSessionSummary } from "../model/sessionSummaries";
import { parseRunStreamEvent } from "../model/runStream";
import type { SessionSummary } from "../../../types";
import { resolveApiUrl } from "../../../shared/api/apiBaseUrl";
import type { ExecutionTraceMessageType } from "../../config/model/appConfig";

type UseRunStreamInput = {
  activeSessionRef: MutableRefObject<ApiSession | null>;
  onRunSettled?: (sessionId: string, session?: ApiSession) => void;
  refreshSessions: () => void;
  traceMessageTypes: ExecutionTraceMessageType[];
  setActiveSession: Dispatch<SetStateAction<ApiSession | null>>;
  setCurrentActiveSession: (
    session: ApiSession | null,
    options?: { recordAttention?: boolean },
  ) => void;
  setError: (error: string | null) => void;
  setExpandedTraceIds: Dispatch<SetStateAction<Set<string>>>;
  setRunningSession: (sessionId: string, running: boolean, runId?: string) => void;
  setSessions: (updater: (current: SessionSummary[]) => SessionSummary[]) => void;
};

type StoppedTraceOverlay = {
  traceMessageId: string;
  insertIndex: number;
  content: string;
};

export function useRunStream({
  activeSessionRef,
  onRunSettled,
  refreshSessions,
  traceMessageTypes,
  setActiveSession,
  setCurrentActiveSession,
  setError,
  setExpandedTraceIds,
  setRunningSession,
  setSessions,
}: UseRunStreamInput) {
  const eventSourceRefs = useRef<Map<string, EventSource>>(new Map());
  const runIdRefs = useRef<Map<string, string>>(new Map());
  const traceMessageTypeKeyRefs = useRef<Map<string, string>>(new Map());
  const streamStateRefs = useRef<Map<string, StreamMessageState>>(new Map());
  const streamMessageIdRefs = useRef<
    Map<
      string,
      {
        traceMessageId: string;
        responseMessageId: string;
        traceInsertIndex: number;
      }
    >
  >(new Map());
  const stoppedTraceOverlayRefs = useRef<Map<string, StoppedTraceOverlay[]>>(new Map());

  useEffect(() => {
    return () => {
      eventSourceRefs.current.forEach((eventSource) => {
        eventSource.close();
      });
      eventSourceRefs.current.clear();
      runIdRefs.current.clear();
      traceMessageTypeKeyRefs.current.clear();
      streamStateRefs.current.clear();
      streamMessageIdRefs.current.clear();
      stoppedTraceOverlayRefs.current.clear();
    };
  }, []);

  function streamRun(sessionId: string, runId: string) {
    const traceMessageTypeKey = traceMessageTypes.join(",");

    if (
      runIdRefs.current.get(sessionId) === runId &&
      traceMessageTypeKeyRefs.current.get(sessionId) === traceMessageTypeKey &&
      eventSourceRefs.current.has(sessionId)
    ) {
      return;
    }

    eventSourceRefs.current.get(sessionId)?.close();

    const eventSource = new EventSource(
      resolveApiUrl(createRunEventsPath(runId, traceMessageTypes)),
    );
    eventSourceRefs.current.set(sessionId, eventSource);
    runIdRefs.current.set(sessionId, runId);
    traceMessageTypeKeyRefs.current.set(sessionId, traceMessageTypeKey);
    const streamingTraceMessageId = `stream-${runId}-trace`;
    const streamingResponseMessageId = `stream-${runId}-response`;
    const existingStreamMessageIds = streamMessageIdRefs.current.get(sessionId);
    const streamMessageState =
      existingStreamMessageIds?.traceMessageId === streamingTraceMessageId
        ? (streamStateRefs.current.get(sessionId) ?? createStreamMessageState())
        : createStreamMessageState();
    const traceInsertIndex =
      existingStreamMessageIds?.traceMessageId === streamingTraceMessageId
        ? existingStreamMessageIds.traceInsertIndex
        : findInitialTraceInsertIndex(activeSessionRef.current, sessionId);
    streamStateRefs.current.set(sessionId, streamMessageState);
    streamMessageIdRefs.current.set(sessionId, {
      traceMessageId: streamingTraceMessageId,
      responseMessageId: streamingResponseMessageId,
      traceInsertIndex,
    });
    let streamClosed = false;

    const closeCurrentStream = (options: { preserveOverlay?: boolean } = {}) => {
      eventSource.close();
      if (eventSourceRefs.current.get(sessionId) === eventSource) {
        eventSourceRefs.current.delete(sessionId);
        runIdRefs.current.delete(sessionId);
        traceMessageTypeKeyRefs.current.delete(sessionId);
      }

      if (!options.preserveOverlay) {
        streamStateRefs.current.delete(sessionId);
        streamMessageIdRefs.current.delete(sessionId);
      }
    };

    const updateResponseMessage = (text: string) => {
      if (!appendResponseDeltaToState(streamMessageState, text)) {
        return;
      }

      setActiveSession((session) => {
        const currentSession = session ?? activeSessionRef.current;

        if (!currentSession) {
          return session;
        }

        if (currentSession.id !== sessionId) {
          return session;
        }

        const nextSession = applyStreamMessageState(currentSession, {
          state: streamMessageState,
          sessionId,
          traceMessageId: streamingTraceMessageId,
          responseMessageId: streamingResponseMessageId,
        });

        activeSessionRef.current = nextSession;
        return nextSession;
      });
    };

    const updateTraceMessage = (rawEvent: unknown) => {
      if (!appendTraceEventToState(streamMessageState, rawEvent)) {
        return;
      }

      setActiveSession((session) => {
        const currentSession = session ?? activeSessionRef.current;

        if (!currentSession) {
          return session;
        }

        if (currentSession.id !== sessionId) {
          return session;
        }

        const nextSession = applyStreamMessageState(currentSession, {
          state: streamMessageState,
          sessionId,
          traceMessageId: streamingTraceMessageId,
          responseMessageId: streamingResponseMessageId,
        });

        activeSessionRef.current = nextSession;
        setExpandedTraceIds((current) => new Set(current).add(streamingTraceMessageId));
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
          gitBranch: updatedSession.gitBranch,
          queuedPrompts: updatedSession.queuedPrompts,
          isRunning: updatedSession.isRunning,
          runningRunId: updatedSession.runningRunId,
        };

        activeSessionRef.current = nextSession;
        return nextSession;
      });
      setSessions((current) => {
        const nextSummary = toSessionSummary(updatedSession);

        return current.some((session) => session.id === updatedSession.id)
          ? current.map((session) =>
              session.id === updatedSession.id ? { ...session, ...nextSummary } : session,
            )
          : [{ ...updatedSession, ...nextSummary }, ...current];
      });
    };

    eventSource.addEventListener("run.output.delta", (event) => {
      const data = parseRunStreamEvent(event);

      if (data?.type === "run.output.delta") {
        updateResponseMessage(data.text);
      }
    });

    eventSource.addEventListener("run.trace", (event) => {
      const data = parseRunStreamEvent(event);

      if (data?.type === "run.trace") {
        updateTraceMessage(data.event);
      }
    });

    eventSource.addEventListener("session.updated", (event) => {
      const data = parseRunStreamEvent(event);

      if (data?.type !== "session.updated") {
        return;
      }

      updateSessionMetadata(data.session);
    });

    eventSource.addEventListener("run.succeeded", (event) => {
      const data = parseRunStreamEvent(event);

      if (data?.type !== "run.succeeded") {
        return;
      }

      streamStateRefs.current.delete(sessionId);
      streamMessageIdRefs.current.delete(sessionId);
      if (activeSessionRef.current?.id === data.session.id) {
        setCurrentActiveSession(data.session, { recordAttention: false });
      }
      setSessions((current) => {
        const nextSummary = toSessionSummary(data.session);

        return current.map((session) =>
          session.id === data.session.id ? { ...session, ...nextSummary } : session,
        );
      });
      setExpandedTraceIds((current) => {
        const next = new Set(current);

        next.delete(streamingTraceMessageId);

        return next;
      });
      setRunningSession(sessionId, false, runId);
      refreshSessions();
      onRunSettled?.(sessionId, data.session);
      streamClosed = true;
      closeCurrentStream();
    });

    eventSource.addEventListener("run.failed", (event) => {
      const data = parseRunStreamEvent(event);

      if (activeSessionRef.current?.id === sessionId) {
        setError(data?.type === "run.failed" ? data.error : "Request failed");
      }
      streamStateRefs.current.delete(sessionId);
      streamMessageIdRefs.current.delete(sessionId);
      setRunningSession(sessionId, false, runId);
      onRunSettled?.(sessionId);
      streamClosed = true;
      closeCurrentStream();
    });

    eventSource.addEventListener("run.cancelled", () => {
      preserveStoppedStreamOverlay(sessionId);
      setRunningSession(sessionId, false, runId);
      refreshSessions();
      onRunSettled?.(sessionId);
      streamClosed = true;
      closeCurrentStream({ preserveOverlay: true });
    });

    eventSource.onerror = () => {
      if (streamClosed) {
        return;
      }

      if (activeSessionRef.current?.id === sessionId) {
        setError("Stream connection failed");
      }
      setRunningSession(sessionId, false, runId);
      closeCurrentStream();
    };
  }

  function applyLocalRunOverlay(session: ApiSession): ApiSession {
    const sessionWithStoppedTrace = applyStoppedTraceOverlays(session);
    const streamMessageState = streamStateRefs.current.get(session.id);
    const streamMessageIds = streamMessageIdRefs.current.get(session.id);

    if (!streamMessageState || !streamMessageIds) {
      return sessionWithStoppedTrace;
    }

    return applyStreamMessageState(sessionWithStoppedTrace, {
      state: streamMessageState,
      sessionId: session.id,
      traceMessageId: streamMessageIds.traceMessageId,
      responseMessageId: streamMessageIds.responseMessageId,
    });
  }

  function closeRunStream(
    sessionId: string,
    runId?: string,
    options: { preserveOverlay?: boolean } = {},
  ) {
    if (runId && runIdRefs.current.get(sessionId) !== runId) {
      return;
    }

    eventSourceRefs.current.get(sessionId)?.close();
    eventSourceRefs.current.delete(sessionId);
    runIdRefs.current.delete(sessionId);
    traceMessageTypeKeyRefs.current.delete(sessionId);
    if (options.preserveOverlay) {
      preserveStoppedStreamOverlay(sessionId);
      return;
    }

    streamStateRefs.current.delete(sessionId);
    streamMessageIdRefs.current.delete(sessionId);
  }

  function preserveStoppedStreamOverlay(sessionId: string) {
    const streamMessageState = streamStateRefs.current.get(sessionId);
    const streamMessageIds = streamMessageIdRefs.current.get(sessionId);

    if (!streamMessageState?.streamedTrace || !streamMessageIds) {
      return;
    }

    const overlays = stoppedTraceOverlayRefs.current.get(sessionId) ?? [];

    if (
      !overlays.some(
        (overlay) =>
          overlay.traceMessageId === streamMessageIds.traceMessageId ||
          overlay.content === streamMessageState.streamedTrace,
      )
    ) {
      stoppedTraceOverlayRefs.current.set(sessionId, [
        ...overlays,
        {
          traceMessageId: streamMessageIds.traceMessageId,
          insertIndex: streamMessageIds.traceInsertIndex,
          content: streamMessageState.streamedTrace,
        },
      ]);
    }
    streamStateRefs.current.delete(sessionId);
    streamMessageIdRefs.current.delete(sessionId);
    setActiveSession((session) => {
      const currentSession = session ?? activeSessionRef.current;

      if (!currentSession || currentSession.id !== sessionId) {
        return session;
      }

      const nextSession = applyStoppedTraceOverlays(currentSession);

      activeSessionRef.current = nextSession;
      return nextSession;
    });
    setExpandedTraceIds((current) => {
      const next = new Set(current);

      next.delete(streamMessageIds.traceMessageId);

      return next;
    });
  }

  function applyStoppedTraceOverlays(session: ApiSession): ApiSession {
    const overlays = stoppedTraceOverlayRefs.current.get(session.id);

    if (!overlays?.length) {
      return session;
    }

    let nextSession = session;
    const remainingOverlays: StoppedTraceOverlay[] = [];

    for (const overlay of overlays) {
      const hasPersistedTrace = nextSession.messages.some(
        (message) =>
          message.kind === "trace" &&
          message.content === overlay.content &&
          !message.id.startsWith("stream-"),
      );

      if (hasPersistedTrace) {
        continue;
      }

      remainingOverlays.push(overlay);
      nextSession = applyStreamMessageState(nextSession, {
        state: {
          streamedTrace: overlay.content,
          streamedResponse: "",
        },
        sessionId: session.id,
        traceMessageId: overlay.traceMessageId,
        responseMessageId: "",
        traceInsertIndex: overlay.insertIndex,
      });
    }

    if (remainingOverlays.length > 0) {
      stoppedTraceOverlayRefs.current.set(session.id, remainingOverlays);
    } else {
      stoppedTraceOverlayRefs.current.delete(session.id);
    }

    return nextSession;
  }

  return { applyLocalRunOverlay, closeRunStream, streamRun };
}

export function createRunEventsPath(
  runId: string,
  traceMessageTypes: ExecutionTraceMessageType[],
): string {
  const params = new URLSearchParams();

  params.set("traceMessageTypes", traceMessageTypes.join(","));

  return `/api/v1/runs/${encodeURIComponent(runId)}/events?${params.toString()}`;
}

function findInitialTraceInsertIndex(session: ApiSession | null, sessionId: string): number {
  return session?.id === sessionId ? session.messages.length : 0;
}
