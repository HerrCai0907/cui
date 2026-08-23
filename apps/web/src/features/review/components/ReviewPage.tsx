import { useEffect, useMemo, useRef, useState } from "react";
import { formatMessageTime } from "../../../shared/lib/dates";
import type { ApiRound } from "../../../types";
import type { ReviewNavigation, ReviewNavigationTarget } from "../model/reviewNavigation";
import { createAtomicReviewNavigation } from "../model/reviewNavigation";
import {
  createEmptyAtomicItemState,
  loadReviewBrowserState,
  saveReviewBrowserState,
  type ReviewBrowserState,
} from "../model/reviewBrowserState";
import { reviewBrowserStateKey, type ReviewRoute } from "../model/reviewRoutes";
import { ReviewDiff } from "./ReviewDiff";

type ReviewPageProps = {
  error: string | null;
  loading: boolean;
  review: ApiRound | null;
  reviewRoute: ReviewRoute;
  navigationTarget: ReviewNavigationTarget | null;
  onOpenFullReview: () => void;
  onReviewNavigationChange: (navigation: ReviewNavigation | null) => void;
};

export function ReviewPage({
  error,
  loading,
  review,
  reviewRoute,
  navigationTarget,
  onOpenFullReview,
  onReviewNavigationChange,
}: ReviewPageProps) {
  const stateKey = reviewBrowserStateKey(reviewRoute);
  const pendingScrollTargetRef = useRef<string | null>(null);
  const [reviewState, setReviewState] = useState<ReviewBrowserState>(() =>
    loadReviewBrowserState(stateKey),
  );

  useEffect(() => {
    setReviewState(loadReviewBrowserState(stateKey));
    pendingScrollTargetRef.current = null;
  }, [stateKey]);

  const reviewNavigation = useMemo(
    () => createAtomicReviewNavigation(review?.atomicReview, reviewState),
    [review?.atomicReview, reviewState],
  );

  useEffect(() => {
    onReviewNavigationChange(reviewRoute.mode === "atomic" ? reviewNavigation : null);
  }, [onReviewNavigationChange, reviewNavigation, reviewRoute.mode]);

  useEffect(() => {
    return () => {
      onReviewNavigationChange(null);
    };
  }, [onReviewNavigationChange]);

  useEffect(() => {
    if (!pendingScrollTargetRef.current) {
      return;
    }

    scrollPendingTarget();
  }, [reviewState]);

  function updateReviewState(updater: (current: ReviewBrowserState) => ReviewBrowserState) {
    setReviewState((current) => {
      const next = updater(current);

      saveReviewBrowserState(stateKey, next);
      return next;
    });
  }

  useEffect(() => {
    if (!navigationTarget || reviewRoute.mode !== "atomic") {
      return;
    }

    navigateToReviewSection(navigationTarget.targetId, navigationTarget.itemId);
  }, [navigationTarget]);

  function navigateToReviewSection(targetId: string, itemId?: string) {
    if (itemId) {
      pendingScrollTargetRef.current = targetId;
      updateReviewState((current) => {
        const currentItem = current.atomicItems[itemId] ?? createEmptyAtomicItemState();

        if (!currentItem.collapsed) {
          return current;
        }

        return {
          ...current,
          atomicItems: {
            ...current.atomicItems,
            [itemId]: {
              ...currentItem,
              collapsed: false,
            },
          },
        };
      });
      scrollPendingTarget();
      return;
    }

    document.getElementById(targetId)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  function scrollPendingTarget() {
    window.requestAnimationFrame(() => {
      const targetId = pendingScrollTargetRef.current;

      if (!targetId) {
        return;
      }

      const target = document.getElementById(targetId);

      if (!target) {
        return;
      }

      target.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      pendingScrollTargetRef.current = null;
    });
  }

  return (
    <div className="review-page">
      {loading && <p className="loading-line">Loading review analysis...</p>}
      {!loading && review && (
        <>
          <div className="review-summary">
            <div>
              <span className="section-label">Session</span>
              <strong>{reviewRoute.sessionId}</strong>
            </div>
            <div>
              <span className="section-label">Changed</span>
              <strong>{formatMessageTime(review.createdAt)}</strong>
            </div>
          </div>
          <ReviewDiff
            key={reviewBrowserStateKey(reviewRoute)}
            diff={review.diff}
            atomicReview={review.atomicReview}
            mode={reviewRoute.mode}
            reviewState={reviewState}
            onUpdateReviewState={updateReviewState}
            onOpenFullReview={onOpenFullReview}
          />
        </>
      )}
      {!loading && !review && !error && (
        <p className="empty-review">No review diff was stored for this round.</p>
      )}
      {error && <p className="error-line">{error}</p>}
    </div>
  );
}
