import { ArrowLeft, GitBranch } from "lucide-react";
import type { ApiSession } from "../../../types";
import type { ReviewRoute } from "../../review/model/reviewRoutes";

type ChatHeaderProps = {
  activeSession: ApiSession | null;
  reviewRoute: ReviewRoute | null;
  onCloseReview: () => void;
};

export function ChatHeader({ activeSession, reviewRoute, onCloseReview }: ChatHeaderProps) {
  const gitBranch = activeSession?.gitBranch;

  return (
    <header className="chat-header">
      <div className="chat-header-title">
        <span className="section-label">
          {reviewRoute
            ? reviewRoute.mode === "atomic"
              ? "Atomic Review"
              : "Full Review"
            : "Session"}
        </span>
        <h1>
          {reviewRoute ? `Round ${reviewRoute.round}` : (activeSession?.title ?? "New session")}
        </h1>
        {reviewRoute ? (
          <p className="session-progress">{activeSession?.title ?? reviewRoute.sessionId}</p>
        ) : (
          activeSession?.summary && <p className="session-progress">{activeSession.summary}</p>
        )}
      </div>
      <div className="chat-header-actions">
        {gitBranch && (
          <span
            className="session-branch"
            title={gitBranch}
            aria-label={`Current branch ${gitBranch}`}
          >
            <GitBranch size={15} />
            <span>{gitBranch}</span>
          </span>
        )}
        {reviewRoute && (
          <button className="secondary-button" type="button" onClick={onCloseReview}>
            <ArrowLeft size={16} />
            Back
          </button>
        )}
      </div>
    </header>
  );
}
