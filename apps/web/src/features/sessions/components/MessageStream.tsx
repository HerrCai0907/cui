import { ClipboardList, FileDiff } from "lucide-react";
import type { RefObject } from "react";
import { TraceView } from "../../trace/components/TraceView";
import { formatMessageTime } from "../../../shared/lib/dates";
import type { ApiMessage, ApiSession } from "../../../types";
import { getMessageTitle } from "../model/messages";

type MessageStreamProps = {
  activeSession: ApiSession | null;
  blocked: boolean;
  error: string | null;
  expandedTraceIds: Set<string>;
  messageStreamRef: RefObject<HTMLDivElement | null>;
  workspaceDraft: string;
  onOpenReview: (sessionId: string, round: number) => void;
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
  onTraceExpandedChange,
  onWorkspaceDraftChange,
}: MessageStreamProps) {
  return (
    <div className="message-stream" ref={messageStreamRef} role="log" aria-live="polite">
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
  onOpenReview: (sessionId: string, round: number) => void;
  onTraceExpandedChange: (messageId: string, open: boolean) => void;
}) {
  const isTrace = message.kind === "trace";
  const hasReviewDiff =
    message.role === "assistant" &&
    message.kind === "response" &&
    Boolean(
      message.round &&
      activeSession.rounds?.find((round) => round.round === message.round)?.hasChanges,
    );

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
              <button
                className="review-button"
                type="button"
                onClick={() => onOpenReview(activeSession.id, message.round!)}
              >
                <FileDiff size={14} />
                [review]
              </button>
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
        ) : (
          <p>{message.content}</p>
        )}
      </div>
    </article>
  );
}
