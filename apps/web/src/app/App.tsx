import { useEffect, useState } from 'react';
import { ReviewPage } from '../features/review/components/ReviewPage';
import { getRoundReview } from '../features/review/api/reviewApi';
import {
  createReviewPath,
  parseReviewRoute,
  type ReviewRoute,
} from '../features/review/model/reviewRoutes';
import { ChatHeader } from '../features/sessions/components/ChatHeader';
import { Composer } from '../features/sessions/components/Composer';
import { MessageStream } from '../features/sessions/components/MessageStream';
import { SessionSidebar } from '../features/sessions/components/SessionSidebar';
import { useSessionController } from '../features/sessions/hooks/useSessionController';
import type { ApiRound } from '../types';

const DEFAULT_WORKSPACE = '/Users/bytedance/cui';

export function App() {
  const [reviewRoute, setReviewRoute] = useState<ReviewRoute | null>(() =>
    parseReviewRoute(location.pathname),
  );
  const [review, setReview] = useState<ApiRound | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const sessionController = useSessionController(DEFAULT_WORKSPACE);

  useEffect(() => {
    const handlePopState = () => {
      setReviewRoute(parseReviewRoute(location.pathname));
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  useEffect(() => {
    if (!reviewRoute) {
      setReview(null);
      setReviewLoading(false);
      setReviewError(null);
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
          setReviewError(
            reason instanceof Error ? reason.message : 'Failed to load review',
          );
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
    if (location.pathname !== '/') {
      history.pushState({}, '', '/');
    }
    setReviewError(null);
    sessionController.startNewSession(workspace);
  }

  function openSession(sessionId: string) {
    setReviewRoute(null);
    setReview(null);
    setReviewError(null);
    if (location.pathname !== '/') {
      history.pushState({}, '', '/');
    }
    void sessionController.openSession(sessionId);
  }

  function openReview(sessionId: string, round: number) {
    window.open(
      createReviewPath(sessionId, round, 'atomic'),
      '_blank',
      'noopener,noreferrer',
    );
  }

  function openFullReview() {
    if (!reviewRoute) {
      return;
    }

    window.location.assign(
      createReviewPath(reviewRoute.sessionId, reviewRoute.round, 'full'),
    );
  }

  function closeReview() {
    history.pushState({}, '', '/');
    setReviewRoute(null);
    setReview(null);
    setReviewError(null);
  }

  return (
    <main className={`app-shell ${sessionController.sidebarOpen ? '' : 'is-collapsed'}`}>
      <SessionSidebar
        activeSessionId={sessionController.activeSession?.id}
        expandedWorkspaces={sessionController.expandedWorkspaces}
        open={sessionController.sidebarOpen}
        sessionCount={sessionController.sessionCount}
        workspaces={sessionController.workspaces}
        onOpenChange={sessionController.setSidebarOpen}
        onOpenSession={openSession}
        onStartNewSession={startNewSession}
        onToggleWorkspace={sessionController.toggleWorkspace}
      />

      <section
        className="chat-area"
        aria-label={reviewRoute ? 'Round review' : 'AI conversation'}
      >
        <ChatHeader
          activeSession={sessionController.activeSession}
          reviewRoute={reviewRoute}
          onCloseReview={closeReview}
        />

        {reviewRoute ? (
          <ReviewPage
            error={reviewError ?? sessionController.error}
            loading={reviewLoading}
            review={review}
            reviewRoute={reviewRoute}
            onOpenFullReview={openFullReview}
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
              lastEnterKeyDownRef={sessionController.lastEnterKeyDownRef}
              textareaRef={sessionController.composerTextareaRef}
              onDraftChange={sessionController.setDraft}
              onSubmit={sessionController.submitDraft}
            />
          </>
        )}
      </section>
    </main>
  );
}
