import { useEffect, useId, useState } from "react";
import { ArrowLeft, Copy, GitBranch, GitCommitHorizontal, Menu, X } from "lucide-react";
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
  const [mobileDetailsOpen, setMobileDetailsOpen] = useState(false);
  const mobileDetailsId = useId();

  useEffect(() => {
    if (!mobileDetailsOpen) {
      return;
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMobileDetailsOpen(false);
      }
    }

    document.addEventListener("keydown", closeOnEscape);

    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [mobileDetailsOpen]);

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
  const copyText = async (value: string | undefined) => {
    if (!value || !navigator.clipboard) {
      return;
    }

    await navigator.clipboard.writeText(value);
  };

  return (
    <>
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
      <button
        className="icon-button session-git-info-mobile-trigger"
        type="button"
        aria-label="Show git details"
        aria-controls={mobileDetailsId}
        aria-expanded={mobileDetailsOpen}
        title={title}
        onClick={() => setMobileDetailsOpen((open) => !open)}
      >
        <GitBranch size={19} />
      </button>
      {mobileDetailsOpen && (
        <>
          <button
            className="session-git-info-mobile-backdrop"
            type="button"
            aria-label="Close git information"
            onClick={() => setMobileDetailsOpen(false)}
          />
          <section
            className="session-git-info-sheet"
            id={mobileDetailsId}
            role="dialog"
            aria-modal="true"
            aria-label="Current git information"
          >
            <div className="session-git-info-sheet-header">
              <h2>Git details</h2>
              <button
                className="icon-button"
                type="button"
                aria-label="Close git information"
                onClick={() => setMobileDetailsOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <dl className="session-git-info-sheet-list">
              {gitInfo.gitBranch && (
                <div className="session-git-info-sheet-row">
                  <div>
                    <dt>Branch</dt>
                    <dd>{gitInfo.gitBranch}</dd>
                  </div>
                  <button
                    className="icon-button session-git-info-copy"
                    type="button"
                    aria-label={`Copy branch ${gitInfo.gitBranch}`}
                    onClick={() => void copyText(gitInfo.gitBranch)}
                  >
                    <Copy size={16} />
                  </button>
                </div>
              )}
              {gitInfo.gitCommitSha && (
                <div className="session-git-info-sheet-row">
                  <div>
                    <dt>Commit</dt>
                    <dd>{gitInfo.gitCommitSha}</dd>
                  </div>
                  <button
                    className="icon-button session-git-info-copy"
                    type="button"
                    aria-label={`Copy commit ${gitInfo.gitCommitSha}`}
                    onClick={() => void copyText(gitInfo.gitCommitSha)}
                  >
                    <Copy size={16} />
                  </button>
                </div>
              )}
            </dl>
          </section>
        </>
      )}
    </>
  );
}
