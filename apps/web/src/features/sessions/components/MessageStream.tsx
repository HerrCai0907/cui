import {
  ChevronsUp,
  ClipboardList,
  FileDiff,
  ListChecks,
  LoaderCircle,
  Terminal,
} from "lucide-react";
import { useEffect, useState, type RefObject } from "react";
import { TraceView } from "../../trace/components/TraceView";
import { formatMessageTime } from "../../../shared/lib/dates";
import type { AppConfig } from "../../config/model/appConfig";
import type { ApiMessage, ApiSession } from "../../../types";
import { AssistantMessageContent } from "./AssistantMessageContent";
import { getMessageTitle } from "../model/messages";
import type { QueuedPromptView } from "../hooks/useSessionController";

type MessageStreamProps = {
  activeSession: ApiSession | null;
  blocked: boolean;
  config: AppConfig;
  error: string | null;
  expandedTraceIds: Set<string>;
  hasOlderMessages: boolean;
  messageStreamRef: RefObject<HTMLDivElement | null>;
  olderMessagesLoading: boolean;
  queuedPrompts: QueuedPromptView[];
  workspaceDraft: string;
  onLoadOlderMessages: () => void;
  onOpenReview: (sessionId: string, round: number, mode: "atomic" | "full") => void;
  onScroll: () => void;
  onTraceExpandedChange: (messageId: string, open: boolean) => void;
  onWorkspaceDraftChange: (value: string) => void;
};

export function MessageStream({
  activeSession,
  blocked,
  config,
  error,
  expandedTraceIds,
  hasOlderMessages,
  messageStreamRef,
  olderMessagesLoading,
  queuedPrompts,
  workspaceDraft,
  onLoadOlderMessages,
  onOpenReview,
  onScroll,
  onTraceExpandedChange,
  onWorkspaceDraftChange,
}: MessageStreamProps) {
  const lastAssistantResponseMessageId = findLastAssistantResponseMessageId(activeSession);
  const [lastReplyScrollSpacerHeight, setLastReplyScrollSpacerHeight] = useState(0);

  useEffect(() => {
    setLastReplyScrollSpacerHeight(0);
  }, [activeSession?.id, activeSession?.messages]);

  function scrollToLastAssistantResponse() {
    const messageStream = messageStreamRef.current;

    if (!messageStream) {
      return;
    }

    const target = messageStream.querySelector<HTMLElement>(
      '[data-last-assistant-response="true"]',
    );

    if (!target) {
      return;
    }

    const nextScrollTop =
      target.getBoundingClientRect().top -
      messageStream.getBoundingClientRect().top +
      messageStream.scrollTop;
    const requiredSpacerHeight = Math.max(
      0,
      Math.ceil(nextScrollTop - (messageStream.scrollHeight - messageStream.clientHeight)),
    );

    setLastReplyScrollSpacerHeight(requiredSpacerHeight);
    window.requestAnimationFrame(() => {
      messageStream.scrollTo({
        top: nextScrollTop,
        behavior: "smooth",
      });
    });
  }

  return (
    <div className="message-stream-shell">
      {lastAssistantResponseMessageId && (
        <button
          className="scroll-to-last-reply-button"
          type="button"
          aria-label="Scroll to latest assistant reply"
          title="Scroll to latest assistant reply"
          onClick={scrollToLastAssistantResponse}
        >
          <ChevronsUp size={18} />
        </button>
      )}

      <div
        className="message-stream"
        ref={messageStreamRef}
        role="log"
        aria-live="polite"
        onScroll={onScroll}
      >
        {!activeSession && (
          <div className="empty-state">
            <h2>Start an AI harness-backed session</h2>
            <p>
              Pick a workspace path, type the initial prompt, and the backend will create a
              persistent session.
            </p>
            <input
              value={workspaceDraft}
              aria-label="Workspace path"
              onChange={(event) => onWorkspaceDraftChange(event.target.value)}
            />
          </div>
        )}

        {activeSession && (hasOlderMessages || olderMessagesLoading) && (
          <button
            className="load-older-messages-button"
            type="button"
            disabled={olderMessagesLoading}
            onClick={onLoadOlderMessages}
          >
            {olderMessagesLoading ? "Loading earlier messages..." : "Load earlier messages"}
          </button>
        )}

        {activeSession?.messages.map((message) => (
          <MessageItem
            activeSession={activeSession}
            expanded={expandedTraceIds.has(message.id)}
            key={message.id}
            message={message}
            config={config}
            latestAssistantResponse={message.id === lastAssistantResponseMessageId}
            onOpenReview={onOpenReview}
            onTraceExpandedChange={onTraceExpandedChange}
          />
        ))}

        {queuedPrompts.length > 0 && <QueuedPromptList queuedPrompts={queuedPrompts} />}
        {blocked && <p className="loading-line">Waiting for the AI harness...</p>}
        {error && <p className="error-line">{error}</p>}
        {lastReplyScrollSpacerHeight > 0 && (
          <div
            className="last-reply-scroll-spacer"
            style={{ height: lastReplyScrollSpacerHeight }}
            aria-hidden="true"
          />
        )}
      </div>
    </div>
  );
}

function QueuedPromptList({ queuedPrompts }: { queuedPrompts: QueuedPromptView[] }) {
  return (
    <section className="queued-prompts" aria-label="Queued prompts">
      <div className="queued-prompts-heading">
        <ListChecks size={17} />
        <strong>Queued prompts</strong>
        <span>{queuedPrompts.length}</span>
      </div>
      <ol className="queued-prompts-list">
        {queuedPrompts.map((queuedPrompt, index) => (
          <li className="queued-prompt" key={queuedPrompt.id}>
            <span className="queued-prompt-index">{index + 1}</span>
            <p>{queuedPrompt.prompt}</p>
            {queuedPrompt.mode === "shell" && (
              <span className="queued-prompt-mode" title="Shell command">
                <Terminal size={14} />
              </span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function MessageItem({
  activeSession,
  config,
  expanded,
  latestAssistantResponse,
  message,
  onOpenReview,
  onTraceExpandedChange,
}: {
  activeSession: ApiSession;
  config: AppConfig;
  expanded: boolean;
  latestAssistantResponse: boolean;
  message: ApiMessage;
  onOpenReview: (sessionId: string, round: number, mode: "atomic" | "full") => void;
  onTraceExpandedChange: (messageId: string, open: boolean) => void;
}) {
  const isTrace = message.kind === "trace";
  const reviewRound =
    message.role === "assistant" && message.kind === "response" && message.round
      ? activeSession.rounds?.find((round) => round.round === message.round && round.hasChanges)
      : undefined;
  const hasReviewDiff = Boolean(reviewRound);
  const hasAtomicReview = Boolean(reviewRound?.atomicReviewStatus);
  const atomicReviewPending = hasReviewDiff && !reviewRound?.atomicReviewStatus;

  return (
    <article
      className={`message ${message.role} ${isTrace ? "trace" : ""}`}
      data-message-id={message.id}
      data-last-assistant-response={latestAssistantResponse ? "true" : undefined}
    >
      <div className="message-avatar">
        {isTrace ? <ClipboardList size={17} /> : message.role === "assistant" ? "AI" : "You"}
      </div>
      <div className="message-body">
        <div className="message-meta">
          <div className="message-title-row">
            <strong>{getMessageTitle(message)}</strong>
            {message.round && hasReviewDiff && (
              <span
                className="review-button-group"
                role="group"
                aria-label={`Round ${message.round} reviews`}
              >
                {hasAtomicReview && (
                  <button
                    className="review-button"
                    type="button"
                    onClick={() => onOpenReview(activeSession.id, message.round!, "atomic")}
                  >
                    <FileDiff size={14} />
                    Atomic review
                  </button>
                )}
                {atomicReviewPending && (
                  <span
                    className="review-pending-indicator"
                    role="status"
                    aria-label={`Round ${message.round} atomic review is running`}
                    title="Atomic review is running"
                  >
                    <LoaderCircle size={14} aria-hidden="true" />
                    Atomic review
                  </span>
                )}
                <button
                  className="review-button"
                  type="button"
                  onClick={() => onOpenReview(activeSession.id, message.round!, "full")}
                >
                  <FileDiff size={14} />
                  Full review
                </button>
              </span>
            )}
          </div>
          <time>{formatMessageTime(message.createdAt)}</time>
        </div>
        {isTrace ? (
          <TraceView
            content={message.content}
            visibleMessageTypes={config.executionTrace.visibleMessageTypes}
            expanded={expanded}
            onExpandedChange={(open) => onTraceExpandedChange(message.id, open)}
          />
        ) : message.role === "assistant" ? (
          <AssistantMessageContent content={message.content} workspace={activeSession.workspace} />
        ) : (
          <p>{message.content}</p>
        )}
      </div>
    </article>
  );
}

function findLastAssistantResponseMessageId(session: ApiSession | null): string | undefined {
  if (!session) {
    return undefined;
  }

  for (let index = session.messages.length - 1; index >= 0; index -= 1) {
    const message = session.messages[index];

    if (message.role === "assistant" && message.kind === "response") {
      return message.id;
    }
  }

  return undefined;
}
