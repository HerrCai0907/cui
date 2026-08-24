import { ArrowLeft, GitBranch } from "lucide-react";
import type { ApiSession } from "../../../types";
import type { ReviewRoute } from "../../review/model/reviewRoutes";

type ChatHeaderProps = {
  activeSession: ApiSession | null;
  configOpen: boolean;
  reviewRoute: ReviewRoute | null;
  onCloseReview: () => void;
};

export function ChatHeader({
  activeSession,
  configOpen,
  reviewRoute,
  onCloseReview,
}: ChatHeaderProps) {
  const gitBranch = activeSession?.gitBranch;
  const sectionLabel = configOpen
    ? "Configuration"
    : reviewRoute
      ? reviewRoute.mode === "atomic"
        ? "Atomic Review"
        : "Full Review"
      : "Session";
  const title = configOpen
    ? "Config"
    : reviewRoute
      ? `Round ${reviewRoute.round}`
      : (activeSession?.title ?? "New session");

  return (
    <header className="chat-header">
      <div className="chat-header-title">
        <span className="section-label">{sectionLabel}</span>
        <h1>{title}</h1>
        {reviewRoute && !configOpen ? (
          <p className="session-progress">{activeSession?.title ?? reviewRoute.sessionId}</p>
        ) : (
          !configOpen &&
          activeSession?.summary && <p className="session-progress">{activeSession.summary}</p>
        )}
      </div>
      <div className="chat-header-actions">
        {!configOpen && gitBranch && (
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
