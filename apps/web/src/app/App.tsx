import { useEffect, useState, type CSSProperties } from "react";
import { getAppPath, isEmbeddedAndroidApp, navigateApp } from "../shared/lib/appNavigation";
import { listModels } from "../features/config/api/modelApi";
import { ConfigPage } from "../features/config/components/ConfigPage";
import {
  loadAppConfig,
  saveAppConfig,
  type AppConfig,
  type ModelOption,
} from "../features/config/model/appConfig";
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

const DEFAULT_WORKSPACE = "~";

export function App() {
  const initialPath = getAppPath();
  const [configOpen, setConfigOpen] = useState(() => initialPath === "/config");
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [config, setConfig] = useState<AppConfig>(loadAppConfig);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [reviewRoute, setReviewRoute] = useState<ReviewRoute | null>(() =>
    initialPath === "/config" ? null : parseReviewRoute(initialPath),
  );
  const [review, setReview] = useState<ApiRound | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewNavigation, setReviewNavigation] = useState<ReviewNavigation | null>(null);
  const [reviewNavigationTarget, setReviewNavigationTarget] =
    useState<ReviewNavigationTarget | null>(null);
  const sessionController = useSessionController(DEFAULT_WORKSPACE, config);

  useEffect(() => {
    let cancelled = false;

    listModels()
      .then((loadedModels) => {
        if (!cancelled) {
          setModels(loadedModels);
          setModelsError(null);
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          setModels([]);
          setModelsError(reason instanceof Error ? reason.message : "Failed to load models");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handleNavigation = () => {
      const path = getAppPath();
      const nextConfigOpen = path === "/config";

      setConfigOpen(nextConfigOpen);
      setReviewRoute(nextConfigOpen ? null : parseReviewRoute(path));
      setMobileNavigationOpen(false);
    };

    window.addEventListener("popstate", handleNavigation);
    window.addEventListener("hashchange", handleNavigation);

    return () => {
      window.removeEventListener("popstate", handleNavigation);
      window.removeEventListener("hashchange", handleNavigation);
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
  }, [
    reviewRoute?.sessionId,
    reviewRoute?.round,
    reviewRoute?.mode,
    config.models.atomicReview,
    config.reasoningEfforts.atomicReview,
  ]);

  function startNewSession(workspace?: string) {
    setConfigOpen(false);
    setReviewRoute(null);
    setReview(null);
    setReviewNavigation(null);
    setReviewNavigationTarget(null);
    if (getAppPath() !== "/") {
      navigateApp("/");
    }
    setMobileNavigationOpen(false);
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
    if (getAppPath() !== "/") {
      navigateApp("/");
    }
    setMobileNavigationOpen(false);
    void sessionController.openSession(sessionId);
  }

  function openConfig() {
    if (getAppPath() !== "/config") {
      navigateApp("/config");
    }
    setMobileNavigationOpen(false);
    setConfigOpen(true);
    setReviewRoute(null);
    setReview(null);
    setReviewNavigation(null);
    setReviewNavigationTarget(null);
    setReviewError(null);
  }

  function openReview(sessionId: string, round: number, mode: ReviewRoute["mode"]) {
    const path = createReviewPath(sessionId, round, mode);

    if (isEmbeddedAndroidApp()) {
      navigateApp(path);
      setReviewRoute(parseReviewRoute(path));
      setMobileNavigationOpen(false);
    } else {
      window.open(path, "_blank", "noopener,noreferrer");
    }
  }

  function openFullReview() {
    if (!reviewRoute) {
      return;
    }

    const path = createReviewPath(reviewRoute.sessionId, reviewRoute.round, "full");

    if (isEmbeddedAndroidApp()) {
      navigateApp(path);
      setReviewRoute(parseReviewRoute(path));
    } else {
      window.location.assign(path);
    }
  }

  function closeReview() {
    navigateApp("/");
    setConfigOpen(false);
    setReviewRoute(null);
    setReview(null);
    setReviewNavigation(null);
    setReviewNavigationTarget(null);
    setReviewError(null);
  }

  function navigateToReviewTarget(target: ReviewNavigationTarget) {
    setReviewNavigationTarget({ ...target });
    setMobileNavigationOpen(false);
  }

  useEffect(() => {
    const androidWindow = window as Window & { __cuiHandleBack?: () => boolean };

    androidWindow.__cuiHandleBack = () => {
      if (!mobileNavigationOpen) {
        return false;
      }

      setMobileNavigationOpen(false);
      return true;
    };

    return () => {
      delete androidWindow.__cuiHandleBack;
    };
  }, [mobileNavigationOpen]);

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
        mobileOpen={mobileNavigationOpen}
        pendingDoneSessionIds={sessionController.pendingDoneSessionIds}
        width={sessionController.sidebarWidth}
        runningSessionIds={sessionController.runningSessionIds}
        sessionPage={sessionController.sessionPage}
        sessionPageLoading={sessionController.sessionPageLoading}
        sessionTotalPages={sessionController.sessionPagination.totalPages}
        sessionListMode={sessionController.sessionListMode}
        sessionCount={sessionController.sessionCount}
        visibleSessionCount={sessionController.visibleSessionCount}
        workspaces={sessionController.workspaces}
        onOpenChange={sessionController.setSidebarOpen}
        onMobileClose={() => setMobileNavigationOpen(false)}
        onWidthChange={sessionController.setSidebarWidth}
        onSessionListModeChange={sessionController.setSessionListMode}
        onSessionPageChange={sessionController.setSessionListPage}
        onOpenSession={openSession}
        onMarkSessionDone={sessionController.markSessionDone}
        onNavigateReview={reviewRoute?.mode === "atomic" ? navigateToReviewTarget : undefined}
        onOpenConfig={openConfig}
        onStartNewSession={startNewSession}
        onToggleWorkspace={sessionController.toggleWorkspace}
        reviewNavigationActive={reviewRoute?.mode === "atomic"}
        reviewNavigation={reviewRoute?.mode === "atomic" ? reviewNavigation : null}
      />
      {mobileNavigationOpen && (
        <button
          className="mobile-navigation-backdrop"
          type="button"
          aria-label="Close session menu"
          onClick={() => setMobileNavigationOpen(false)}
        />
      )}

      <section
        className="chat-area"
        aria-label={configOpen ? "Configuration" : reviewRoute ? "Round review" : "AI conversation"}
      >
        <ChatHeader
          activeSession={sessionController.activeSession}
          configOpen={configOpen}
          reviewRoute={reviewRoute}
          onCloseReview={closeReview}
          onOpenNavigation={() => setMobileNavigationOpen(true)}
        />

        {configOpen ? (
          <ConfigPage
            config={config}
            models={models}
            modelsError={modelsError}
            onConfigChange={updateConfig}
          />
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
              hasOlderMessages={sessionController.hasOlderMessages}
              messageStreamRef={sessionController.messageStreamRef}
              olderMessagesLoading={sessionController.olderMessagesLoading}
              queuedPrompts={sessionController.activeSessionQueuedPrompts}
              workspaceDraft={sessionController.workspaceDraft}
              onLoadOlderMessages={sessionController.loadOlderActiveSessionMessages}
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
