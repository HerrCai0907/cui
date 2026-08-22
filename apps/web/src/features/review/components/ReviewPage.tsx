import { formatMessageTime } from '../../../shared/lib/dates';
import type { ApiRound } from '../../../types';
import {
  reviewBrowserStateKey,
  type ReviewRoute,
} from '../model/reviewRoutes';
import { ReviewDiff } from './ReviewDiff';

type ReviewPageProps = {
  error: string | null;
  loading: boolean;
  review: ApiRound | null;
  reviewRoute: ReviewRoute;
  onOpenFullReview: () => void;
};

export function ReviewPage({
  error,
  loading,
  review,
  reviewRoute,
  onOpenFullReview,
}: ReviewPageProps) {
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
            stateKey={reviewBrowserStateKey(reviewRoute)}
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
