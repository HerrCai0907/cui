import { useEffect, useState, type CSSProperties } from "react";
import { ConfigPage } from "../features/config/components/ConfigPage";
import { loadAppConfig, saveAppConfig, type AppConfig } from "../features/config/model/appConfig";
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
  const [configOpen, setConfigOpen] = useState(() => location.pathname === "/config");
  const [config, setConfig] = useState<AppConfig>(loadAppConfig);
  const [reviewRoute, setReviewRoute] = useState<ReviewRoute | null>(() =>
    location.pathname === "/config" ? null : parseReviewRoute(location.pathname),
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
      const nextConfigOpen = location.pathname === "/config";

      setConfigOpen(nextConfigOpen);
      setReviewRoute(nextConfigOpen ? null : parseReviewRoute(location.pathname));
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  function updateConfig(nextConfig: AppConfig) {
    setConfig(nextConfig);
    saveAppConfig(nextConfig);
  }

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
    getRoundReview(reviewRoute.sessionId, reviewRoute.round, reviewRoute.mode)
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
    setConfigOpen(false);
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
    setConfigOpen(false);
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

  function openConfig() {
    if (location.pathname !== "/config") {
      history.pushState({}, "", "/config");
    }
    setConfigOpen(true);
    setReviewRoute(null);
    setReview(null);
    setReviewNavigation(null);
    setReviewNavigationTarget(null);
    setReviewError(null);
  }

  function openReview(sessionId: string, round: number, mode: ReviewRoute["mode"]) {
    window.open(createReviewPath(sessionId, round, mode), "_blank", "noopener,noreferrer");
  }

  function openFullReview() {
    if (!reviewRoute) {
      return;
    }

    window.location.assign(createReviewPath(reviewRoute.sessionId, reviewRoute.round, "full"));
  }

  function closeReview() {
    history.pushState({}, "", "/");
    setConfigOpen(false);
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
        configOpen={configOpen}
        expandedWorkspaces={sessionController.expandedWorkspaces}
        open={sessionController.sidebarOpen}
        pendingDoneSessionIds={sessionController.pendingDoneSessionIds}
        width={sessionController.sidebarWidth}
        runningSessionIds={sessionController.runningSessionIds}
        sessionListMode={sessionController.sessionListMode}
        sessionCount={sessionController.sessionCount}
        visibleSessionCount={sessionController.visibleSessionCount}
        workspaces={sessionController.workspaces}
        onOpenChange={sessionController.setSidebarOpen}
        onWidthChange={sessionController.setSidebarWidth}
        onSessionListModeChange={sessionController.setSessionListMode}
        onOpenSession={openSession}
        onMarkSessionDone={sessionController.markSessionDone}
        onNavigateReview={reviewRoute?.mode === "atomic" ? navigateToReviewTarget : undefined}
        onOpenConfig={openConfig}
        onStartNewSession={startNewSession}
        onToggleWorkspace={sessionController.toggleWorkspace}
        reviewNavigationActive={reviewRoute?.mode === "atomic"}
        reviewNavigation={reviewRoute?.mode === "atomic" ? reviewNavigation : null}
      />

      <section
        className="chat-area"
        aria-label={configOpen ? "Configuration" : reviewRoute ? "Round review" : "AI conversation"}
      >
        <ChatHeader
          activeSession={sessionController.activeSession}
          configOpen={configOpen}
          reviewRoute={reviewRoute}
          onCloseReview={closeReview}
        />

        {configOpen ? (
          <ConfigPage config={config} onConfigChange={updateConfig} />
        ) : reviewRoute ? (
          <ReviewPage
            error={reviewError ?? sessionController.error}
            loading={reviewLoading}
            navigationTarget={reviewNavigationTarget}
            review={review}
            reviewRoute={reviewRoute}
            sessionBlocked={
              sessionController.activeSessionBlocked ||
              sessionController.activeSession?.id !== reviewRoute.sessionId
            }
            onSubmitPrompt={sessionController.submitPrompt}
            onOpenFullReview={openFullReview}
            onCloseReview={closeReview}
            onReviewNavigationChange={setReviewNavigation}
          />
        ) : (
          <>
            <MessageStream
              activeSession={sessionController.activeSession}
              blocked={sessionController.activeSessionBlocked}
              config={config}
              error={sessionController.error}
              expandedTraceIds={sessionController.expandedTraceIds}
              messageStreamRef={sessionController.messageStreamRef}
              queuedPrompts={sessionController.activeSessionQueuedPrompts}
              workspaceDraft={sessionController.workspaceDraft}
              onOpenReview={openReview}
              onScroll={sessionController.handleMessageStreamScroll}
              onTraceExpandedChange={sessionController.setTraceExpanded}
              onWorkspaceDraftChange={sessionController.setWorkspaceDraft}
            />

            <Composer
              active={Boolean(sessionController.activeSession)}
              disabled={sessionController.composerSubmitDisabled}
              draft={sessionController.draft}
              shellMode={sessionController.composerMode === "shell"}
              stopping={sessionController.activeSessionRunning}
              stopDisabled={sessionController.activeSessionStopping}
              lastEnterKeyDownRef={sessionController.lastEnterKeyDownRef}
              textareaRef={sessionController.composerTextareaRef}
              onDraftChange={sessionController.setDraft}
              onShellModeChange={(shellMode) =>
                sessionController.setComposerMode(shellMode ? "shell" : "chat")
              }
              onStop={sessionController.stopActiveSession}
              onSubmit={sessionController.submitDraft}
            />
          </>
        )}
      </section>
    </main>
  );
}
