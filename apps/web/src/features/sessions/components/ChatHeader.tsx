import { ArrowLeft, GitBranch, GitCommitHorizontal, Menu } from "lucide-react";
import type { ApiSession } from "../../../types";
import type { ReviewRoute } from "../../review/model/reviewRoutes";

export type SessionGitInfo = {
  gitBranch?: string;
  gitCommitSha?: string;
};

type ChatHeaderProps = {
  activeSession: ApiSession | null;
  configOpen: boolean;
  newSessionGitInfo: SessionGitInfo | null;
  reviewRoute: ReviewRoute | null;
  onCloseReview: () => void;
  onOpenNavigation: () => void;
};

export function ChatHeader({
  activeSession,
  configOpen,
  newSessionGitInfo,
  reviewRoute,
  onCloseReview,
  onOpenNavigation,
}: ChatHeaderProps) {
  const gitInfo = activeSession ?? newSessionGitInfo;
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
      <button
        className="icon-button mobile-navigation-button"
        type="button"
        aria-label="Open session menu"
        onClick={onOpenNavigation}
      >
        <Menu size={20} />
      </button>
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
        {!configOpen && <SessionGitInfoBadge gitInfo={gitInfo} />}
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

function SessionGitInfoBadge({ gitInfo }: { gitInfo: SessionGitInfo | null }) {
  if (!gitInfo) {
    return null;
  }

  const shortSha = gitInfo.gitCommitSha?.slice(0, 12);

  if (!gitInfo.gitBranch && !shortSha) {
    return null;
  }

  const title = [gitInfo.gitBranch, gitInfo.gitCommitSha].filter(Boolean).join(" @ ");
  const ariaLabel = [
    gitInfo.gitBranch ? `Current branch ${gitInfo.gitBranch}` : undefined,
    shortSha ? `current commit ${shortSha}` : undefined,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <span className="session-git-info" title={title} aria-label={ariaLabel}>
      {gitInfo.gitBranch && (
        <span className="session-git-info-item">
          <GitBranch size={15} />
          <span>{gitInfo.gitBranch}</span>
        </span>
      )}
      {shortSha && (
        <span className="session-git-info-item">
          <GitCommitHorizontal size={15} />
          <span>{shortSha}</span>
        </span>
      )}
    </span>
  );
}
