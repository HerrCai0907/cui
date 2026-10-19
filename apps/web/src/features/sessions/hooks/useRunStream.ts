import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useEffect,
  useRef,
} from "react";
import type { ApiSession, RunStreamEvent, SessionSummary } from "../../../types";
import {
  addRpcCloseListener,
  addRpcNotificationListener,
  rpcRequest,
} from "../../../shared/api/rpcClient";
import {
  appendResponseDeltaToState,
  appendTraceEventToState,
  applyStreamMessageState,
  createStreamMessageState,
  type StreamMessageState,
} from "../model/streamMessages";
import { toSessionSummary } from "../model/sessionSummaries";
import { formatModelLabel } from "../model/messages";
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
  insertAfterMessageId?: string;
  model?: string;
  content: string;
};

type RunEventNotification = {
  subscriptionId: string;
  runId: string;
  event: RunStreamEvent;
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
  const subscriptionRefs = useRef<Map<string, string>>(new Map());
  const runIdRefs = useRef<Map<string, string>>(new Map());
  const runEventHandlersRef = useRef<Map<string, (event: RunStreamEvent) => void>>(new Map());
  const traceMessageTypeKeyRefs = useRef<Map<string, string>>(new Map());
  const streamStateRefs = useRef<Map<string, StreamMessageState>>(new Map());
  const streamMessageIdRefs = useRef<
    Map<
      string,
      {
        traceMessageId: string;
        responseMessageId: string;
        traceInsertAfterMessageId?: string;
      }
    >
  >(new Map());
  const stoppedTraceOverlayRefs = useRef<Map<string, StoppedTraceOverlay[]>>(new Map());

  useEffect(() => {
    const removeNotificationListener = addRpcNotificationListener("run.event", (params) => {
      const notification = parseRunEventNotification(params);

      if (!notification) {
        return;
      }

      runEventHandlersRef.current.get(notification.runId)?.(notification.event);
    });
    const removeCloseListener = addRpcCloseListener(() => {
      for (const [sessionId, runId] of runIdRefs.current) {
        if (activeSessionRef.current?.id === sessionId) {
          setError("Stream connection failed");
        }
        preserveStoppedStreamOverlay(sessionId);
        setRunningSession(sessionId, false, runId);
      }

      subscriptionRefs.current.clear();
      runIdRefs.current.clear();
      runEventHandlersRef.current.clear();
      traceMessageTypeKeyRefs.current.clear();
    });

    return () => {
      removeNotificationListener();
      removeCloseListener();
      subscriptionRefs.current.forEach((subscriptionId) => {
        void rpcRequest("runs.unsubscribe", { subscriptionId }).catch(() => undefined);
      });
      subscriptionRefs.current.clear();
      runIdRefs.current.clear();
      runEventHandlersRef.current.clear();
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
      runEventHandlersRef.current.has(runId)
    ) {
      return;
    }

    closeRunStream(sessionId);
    runIdRefs.current.set(sessionId, runId);
    traceMessageTypeKeyRefs.current.set(sessionId, traceMessageTypeKey);

    const streamingTraceMessageId = `stream-${runId}-trace`;
    const streamingResponseMessageId = `stream-${runId}-response`;
    const existingStreamMessageIds = streamMessageIdRefs.current.get(sessionId);
    const streamModel = getSessionNormalModelLabel(activeSessionRef.current, sessionId);
    const streamMessageState =
      existingStreamMessageIds?.traceMessageId === streamingTraceMessageId
        ? (streamStateRefs.current.get(sessionId) ?? createStreamMessageState(streamModel))
        : createStreamMessageState(streamModel);

    if (!streamMessageState.model && streamModel) {
      streamMessageState.model = streamModel;
    }

    const traceInsertAfterMessageId =
      existingStreamMessageIds?.traceMessageId === streamingTraceMessageId
        ? existingStreamMessageIds.traceInsertAfterMessageId
        : findInitialTraceInsertAfterMessageId(activeSessionRef.current, sessionId);
    streamStateRefs.current.set(sessionId, streamMessageState);
    streamMessageIdRefs.current.set(sessionId, {
      traceMessageId: streamingTraceMessageId,
      responseMessageId: streamingResponseMessageId,
      traceInsertAfterMessageId,
    });
    let streamClosed = false;

    const closeCurrentStream = (options: { preserveOverlay?: boolean } = {}) => {
      if (runIdRefs.current.get(sessionId) !== runId) {
        return;
      }

      const subscriptionId = subscriptionRefs.current.get(sessionId);

      if (subscriptionId) {
        void rpcRequest("runs.unsubscribe", { subscriptionId }).catch(() => undefined);
      }
      subscriptionRefs.current.delete(sessionId);
      runEventHandlersRef.current.delete(runId);
      runIdRefs.current.delete(sessionId);
      traceMessageTypeKeyRefs.current.delete(sessionId);

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

        if (!currentSession || currentSession.id !== sessionId) {
          return session;
        }

        const nextSession = applyStreamMessageState(currentSession, {
          state: streamMessageState,
          sessionId,
          traceMessageId: streamingTraceMessageId,
          responseMessageId: streamingResponseMessageId,
          traceInsertAfterMessageId,
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

        if (!currentSession || currentSession.id !== sessionId) {
          return session;
        }

        const nextSession = applyStreamMessageState(currentSession, {
          state: streamMessageState,
          sessionId,
          traceMessageId: streamingTraceMessageId,
          responseMessageId: streamingResponseMessageId,
          traceInsertAfterMessageId,
        });

        activeSessionRef.current = nextSession;
        setExpandedTraceIds((current) => new Set(current).add(streamingTraceMessageId));
        return nextSession;
      });
    };

    const updateSession = (updatedSession: ApiSession) => {
      if (updatedSession.messagePageInfo) {
        const currentSession = activeSessionRef.current;

        if (currentSession?.id !== updatedSession.id) {
          updateSessionSummary(updatedSession);
          return;
        }

        if (sessionHasNewPersistedAssistantMessage(currentSession, updatedSession)) {
          streamStateRefs.current.delete(sessionId);
          streamMessageIdRefs.current.delete(sessionId);
          setExpandedTraceIds((current) => {
            const next = new Set(current);

            next.delete(streamingTraceMessageId);

            return next;
          });
        }

        setCurrentActiveSession(updatedSession, { recordAttention: false });
        updateSessionSummary(updatedSession);
        return;
      }

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
          gitCommitSha: updatedSession.gitCommitSha,
          queuedPrompts: updatedSession.queuedPrompts,
          isRunning: updatedSession.isRunning,
          runningRunId: updatedSession.runningRunId,
        };

        activeSessionRef.current = nextSession;
        return nextSession;
      });
      updateSessionSummary(updatedSession);
    };

    const updateSessionSummary = (updatedSession: ApiSession) => {
      setSessions((current) => {
        const nextSummary = toSessionSummary(updatedSession);

        return current.some((session) => session.id === updatedSession.id)
          ? current.map((session) =>
              session.id === updatedSession.id ? { ...session, ...nextSummary } : session,
            )
          : [{ ...updatedSession, ...nextSummary }, ...current];
      });
    };

    runEventHandlersRef.current.set(runId, (data) => {
      if (data.type === "run.output.delta") {
        updateResponseMessage(data.text);
      } else if (data.type === "run.trace") {
        updateTraceMessage(data.event);
      } else if (data.type === "session.updated") {
        updateSession(data.session);
      } else if (data.type === "run.succeeded") {
        notifyAndroidSessionCompleted(data.session);
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
      } else if (data.type === "run.failed") {
        if (activeSessionRef.current?.id === sessionId) {
          setError(data.error || "Request failed");
        }
        preserveStoppedStreamOverlay(sessionId);
        setRunningSession(sessionId, false, runId);
        onRunSettled?.(sessionId);
        streamClosed = true;
        closeCurrentStream({ preserveOverlay: true });
      } else if (data.type === "run.cancelled") {
        preserveStoppedStreamOverlay(sessionId);
        setRunningSession(sessionId, false, runId);
        refreshSessions();
        onRunSettled?.(sessionId);
        streamClosed = true;
        closeCurrentStream({ preserveOverlay: true });
      }
    });

    void rpcRequest<{ subscriptionId: string }>("runs.subscribe", {
      runId,
      traceMessageTypes,
    })
      .then(({ subscriptionId }) => {
        if (runIdRefs.current.get(sessionId) === runId) {
          subscriptionRefs.current.set(sessionId, subscriptionId);
        } else {
          void rpcRequest("runs.unsubscribe", { subscriptionId }).catch(() => undefined);
        }
      })
      .catch(() => {
        if (streamClosed) {
          return;
        }

        if (activeSessionRef.current?.id === sessionId) {
          setError("Stream connection failed");
        }
        preserveStoppedStreamOverlay(sessionId);
        setRunningSession(sessionId, false, runId);
        closeCurrentStream({ preserveOverlay: true });
      });
  }

  function applyLocalRunOverlay(session: ApiSession): ApiSession {
    const sessionWithStoppedTrace = applyStoppedTraceOverlays(session);
    const streamMessageState = streamStateRefs.current.get(session.id);
    const streamMessageIds = streamMessageIdRefs.current.get(session.id);

    if (!streamMessageState || !streamMessageIds) {
      return sessionWithStoppedTrace;
    }

    const streamModel = getSessionNormalModelLabel(session, session.id);
    if (!streamMessageState.model && streamModel) {
      streamMessageState.model = streamModel;
    }

    return applyStreamMessageState(sessionWithStoppedTrace, {
      state: streamMessageState,
      sessionId: session.id,
      traceMessageId: streamMessageIds.traceMessageId,
      responseMessageId: streamMessageIds.responseMessageId,
      traceInsertAfterMessageId: streamMessageIds.traceInsertAfterMessageId,
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

    const currentRunId = runIdRefs.current.get(sessionId);
    const subscriptionId = subscriptionRefs.current.get(sessionId);

    if (subscriptionId) {
      void rpcRequest("runs.unsubscribe", { subscriptionId }).catch(() => undefined);
    }
    if (currentRunId) {
      runEventHandlersRef.current.delete(currentRunId);
    }

    subscriptionRefs.current.delete(sessionId);
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
          insertAfterMessageId: streamMessageIds.traceInsertAfterMessageId,
          model: streamMessageState.model,
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
          ...(overlay.model ? { model: overlay.model } : {}),
          streamedTrace: overlay.content,
          streamedResponse: "",
        },
        sessionId: session.id,
        traceMessageId: overlay.traceMessageId,
        responseMessageId: "",
        traceInsertAfterMessageId: overlay.insertAfterMessageId,
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

function parseRunEventNotification(params: unknown): RunEventNotification | undefined {
  if (!params || typeof params !== "object") {
    return undefined;
  }

  const record = params as Partial<RunEventNotification>;

  if (typeof record.runId !== "string" || !record.event || typeof record.event !== "object") {
    return undefined;
  }

  return {
    subscriptionId: typeof record.subscriptionId === "string" ? record.subscriptionId : "",
    runId: record.runId,
    event: record.event as RunStreamEvent,
  };
}

function findInitialTraceInsertAfterMessageId(
  session: ApiSession | null,
  sessionId: string,
): string | undefined {
  return session?.id === sessionId ? session.messages.at(-1)?.id : undefined;
}

function getSessionNormalModelLabel(
  session: ApiSession | null,
  sessionId: string,
): string | undefined {
  if (session?.id !== sessionId || !session.models) {
    return undefined;
  }

  return formatModelLabel(session.models.normal, session.models.reasoningEfforts?.normal);
}

function sessionHasNewPersistedAssistantMessage(
  currentSession: ApiSession | null,
  incomingSession: ApiSession,
): boolean {
  const currentMessageIds = new Set(currentSession?.messages.map((message) => message.id) ?? []);

  return incomingSession.messages.some(
    (message) =>
      !message.id.startsWith("stream-") &&
      !currentMessageIds.has(message.id) &&
      message.role === "assistant" &&
      (message.kind === "response" || message.kind === "trace"),
  );
}

type AndroidSessionCompletionBridge = {
  notifySessionCompleted?: (sessionId: string, sessionTitle: string) => void;
};

function notifyAndroidSessionCompleted(session: ApiSession): void {
  if (typeof window === "undefined") {
    return;
  }

  const bridge = (window as Window & { CuiAndroid?: AndroidSessionCompletionBridge }).CuiAndroid;

  try {
    bridge?.notifySessionCompleted?.(session.id, session.title);
  } catch {
    // Native notification delivery is best-effort and should not affect session state.
  }
}
