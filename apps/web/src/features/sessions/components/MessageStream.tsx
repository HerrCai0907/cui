import { ClipboardList, FileDiff, ListChecks, Terminal } from "lucide-react";
import type { RefObject } from "react";
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
          <h2>Start an AI harness-backed session</h2>
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
          onOpenReview={onOpenReview}
          onTraceExpandedChange={onTraceExpandedChange}
        />
      ))}

      {queuedPrompts.length > 0 && <QueuedPromptList queuedPrompts={queuedPrompts} />}
      {blocked && <p className="loading-line">Waiting for the AI harness...</p>}
      {error && <p className="error-line">{error}</p>}
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
  message,
  onOpenReview,
  onTraceExpandedChange,
}: {
  activeSession: ApiSession;
  config: AppConfig;
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
    <article
      className={`message ${message.role} ${isTrace ? "trace" : ""}`}
      data-message-id={message.id}
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
