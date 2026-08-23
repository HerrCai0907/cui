import { useEffect, useState, type CSSProperties } from "react";
import { ReviewPage } from "../features/review/components/ReviewPage";
import { getRoundReview } from "../features/review/api/reviewApi";
import type {
  ReviewNavigation,
  ReviewNavigationTarget,
} from "../features/review/model/reviewNavigation";
import {
  createReviewPath,
  parseReviewRoute,
  type ReviewRoute,
} from "../features/review/model/reviewRoutes";
import { ChatHeader } from "../features/sessions/components/ChatHeader";
import { Composer } from "../features/sessions/components/Composer";
import { MessageStream } from "../features/sessions/components/MessageStream";
import { SessionSidebar } from "../features/sessions/components/SessionSidebar";
import { useSessionController } from "../features/sessions/hooks/useSessionController";
import type { ApiRound } from "../types";

const DEFAULT_WORKSPACE = "/Users/bytedance/cui";

export function App() {
  const [reviewRoute, setReviewRoute] = useState<ReviewRoute | null>(() =>
    parseReviewRoute(location.pathname),
  );
  const [review, setReview] = useState<ApiRound | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewNavigation, setReviewNavigation] = useState<ReviewNavigation | null>(null);
  const [reviewNavigationTarget, setReviewNavigationTarget] =
    useState<ReviewNavigationTarget | null>(null);
  const sessionController = useSessionController(DEFAULT_WORKSPACE);

  useEffect(() => {
    const handlePopState = () => {
      setReviewRoute(parseReviewRoute(location.pathname));
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  useEffect(() => {
    if (!reviewRoute) {
      setReview(null);
      setReviewLoading(false);
      setReviewError(null);
      setReviewNavigation(null);
      setReviewNavigationTarget(null);
      return;
    }

    let cancelled = false;

    setReviewLoading(true);
    setReviewError(null);
    getRoundReview(reviewRoute.sessionId, reviewRoute.round)
      .then((loadedReview) => {
        if (!cancelled) {
          setReview(loadedReview);
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          setReview(null);
          setReviewError(reason instanceof Error ? reason.message : "Failed to load review");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setReviewLoading(false);
        }
      });

    if (sessionController.activeSession?.id !== reviewRoute.sessionId) {
      void sessionController.openSession(reviewRoute.sessionId, {
        resetError: false,
      });
    }

    return () => {
      cancelled = true;
    };
  }, [reviewRoute?.sessionId, reviewRoute?.round, reviewRoute?.mode]);

  function startNewSession(workspace?: string) {
    setReviewRoute(null);
    setReview(null);
    setReviewNavigation(null);
    setReviewNavigationTarget(null);
    if (location.pathname !== "/") {
      history.pushState({}, "", "/");
    }
    setReviewError(null);
    sessionController.startNewSession(workspace);
  }

  function openSession(sessionId: string) {
    setReviewRoute(null);
    setReview(null);
    setReviewNavigation(null);
    setReviewNavigationTarget(null);
    setReviewError(null);
    if (location.pathname !== "/") {
      history.pushState({}, "", "/");
    }
    void sessionController.openSession(sessionId);
  }

  function openReview(sessionId: string, round: number) {
    window.open(createReviewPath(sessionId, round, "atomic"), "_blank", "noopener,noreferrer");
  }

  function openFullReview() {
    if (!reviewRoute) {
      return;
    }

    window.location.assign(createReviewPath(reviewRoute.sessionId, reviewRoute.round, "full"));
  }

  function closeReview() {
    history.pushState({}, "", "/");
    setReviewRoute(null);
    setReview(null);
    setReviewNavigation(null);
    setReviewNavigationTarget(null);
    setReviewError(null);
  }

  function navigateToReviewTarget(target: ReviewNavigationTarget) {
    setReviewNavigationTarget({ ...target });
  }

  return (
    <main
      className={`app-shell ${sessionController.sidebarOpen ? "" : "is-collapsed"}`}
      style={{ "--sidebar-width": `${sessionController.sidebarWidth}px` } as CSSProperties}
    >
      <SessionSidebar
        activeSessionId={sessionController.activeSession?.id}
        expandedWorkspaces={sessionController.expandedWorkspaces}
        historyOpen={sessionController.historyOpen}
        open={sessionController.sidebarOpen}
        width={sessionController.sidebarWidth}
        runningSessionIds={sessionController.runningSessionIds}
        historySessionCount={sessionController.historySessionCount}
        historyWorkspaces={sessionController.historyWorkspaces}
        sessionCount={sessionController.sessionCount}
        workspaces={sessionController.workspaces}
        onOpenChange={sessionController.setSidebarOpen}
        onWidthChange={sessionController.setSidebarWidth}
        onHistoryOpenChange={sessionController.setHistoryOpen}
        onOpenSession={openSession}
        onNavigateReview={reviewRoute?.mode === "atomic" ? navigateToReviewTarget : undefined}
        onStartNewSession={startNewSession}
        onToggleWorkspace={sessionController.toggleWorkspace}
        reviewNavigationActive={reviewRoute?.mode === "atomic"}
        reviewNavigation={reviewRoute?.mode === "atomic" ? reviewNavigation : null}
      />

      <section className="chat-area" aria-label={reviewRoute ? "Round review" : "AI conversation"}>
        <ChatHeader
          activeSession={sessionController.activeSession}
          reviewRoute={reviewRoute}
          onCloseReview={closeReview}
        />

        {reviewRoute ? (
          <ReviewPage
            error={reviewError ?? sessionController.error}
            loading={reviewLoading}
            navigationTarget={reviewNavigationTarget}
            review={review}
            reviewRoute={reviewRoute}
            onOpenFullReview={openFullReview}
            onReviewNavigationChange={setReviewNavigation}
          />
        ) : (
          <>
            <MessageStream
              activeSession={sessionController.activeSession}
              blocked={sessionController.activeSessionBlocked}
              error={sessionController.error}
              expandedTraceIds={sessionController.expandedTraceIds}
              messageStreamRef={sessionController.messageStreamRef}
              workspaceDraft={sessionController.workspaceDraft}
              onOpenReview={openReview}
              onTraceExpandedChange={sessionController.setTraceExpanded}
              onWorkspaceDraftChange={sessionController.setWorkspaceDraft}
            />

            <Composer
              active={Boolean(sessionController.activeSession)}
              disabled={sessionController.activeSessionBlocked}
              draft={sessionController.draft}
              stopping={sessionController.activeSessionRunning}
              stopDisabled={sessionController.activeSessionStopping}
              lastEnterKeyDownRef={sessionController.lastEnterKeyDownRef}
              textareaRef={sessionController.composerTextareaRef}
              onDraftChange={sessionController.setDraft}
              onStop={sessionController.stopActiveSession}
              onSubmit={sessionController.submitDraft}
            />
          </>
        )}
      </section>
    </main>
  );
}
