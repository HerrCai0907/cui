import { ClipboardList, FileDiff } from "lucide-react";
import type { RefObject } from "react";
import { TraceView } from "../../trace/components/TraceView";
import { formatMessageTime } from "../../../shared/lib/dates";
import type { ApiMessage, ApiSession } from "../../../types";
import { AssistantMessageContent } from "./AssistantMessageContent";
import { getMessageTitle } from "../model/messages";

type MessageStreamProps = {
  activeSession: ApiSession | null;
  blocked: boolean;
  error: string | null;
  expandedTraceIds: Set<string>;
  messageStreamRef: RefObject<HTMLDivElement | null>;
  workspaceDraft: string;
  onOpenReview: (sessionId: string, round: number, mode: "atomic" | "full") => void;
  onScroll: () => void;
  onTraceExpandedChange: (messageId: string, open: boolean) => void;
  onWorkspaceDraftChange: (value: string) => void;
};

export function MessageStream({
  activeSession,
  blocked,
  error,
  expandedTraceIds,
  messageStreamRef,
  workspaceDraft,
  onOpenReview,
  onScroll,
  onTraceExpandedChange,
  onWorkspaceDraftChange,
}: MessageStreamProps) {
  return (
    <div
      className="message-stream"
      ref={messageStreamRef}
      role="log"
      aria-live="polite"
      onScroll={onScroll}
    >
      {!activeSession && (
        <div className="empty-state">
          <h2>Start a TRAEX-backed AI session</h2>
          <p>
            Pick a workspace path, type the initial prompt, and the backend will create a persistent
            session.
          </p>
          <input
            value={workspaceDraft}
            aria-label="Workspace path"
            onChange={(event) => onWorkspaceDraftChange(event.target.value)}
          />
        </div>
      )}

      {activeSession?.messages.map((message) => (
        <MessageItem
          activeSession={activeSession}
          expanded={expandedTraceIds.has(message.id)}
          key={message.id}
          message={message}
          onOpenReview={onOpenReview}
          onTraceExpandedChange={onTraceExpandedChange}
        />
      ))}

      {blocked && <p className="loading-line">Waiting for TRAEX...</p>}
      {error && <p className="error-line">{error}</p>}
    </div>
  );
}

function MessageItem({
  activeSession,
  expanded,
  message,
  onOpenReview,
  onTraceExpandedChange,
}: {
  activeSession: ApiSession;
  expanded: boolean;
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

  return (
    <article className={`message ${message.role} ${isTrace ? "trace" : ""}`}>
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
