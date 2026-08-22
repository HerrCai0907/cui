import { ArrowLeft } from 'lucide-react';
import type { ApiSession } from '../../../types';
import type { ReviewRoute } from '../../review/model/reviewRoutes';

type ChatHeaderProps = {
  activeSession: ApiSession | null;
  reviewRoute: ReviewRoute | null;
  onCloseReview: () => void;
};

export function ChatHeader({
  activeSession,
  reviewRoute,
  onCloseReview,
}: ChatHeaderProps) {
  return (
    <header className="chat-header">
      <div>
        <span className="section-label">
          {reviewRoute
            ? reviewRoute.mode === 'atomic'
              ? 'Atomic Review'
              : 'Full Review'
            : 'Session'}
        </span>
        <h1>
          {reviewRoute
            ? `Round ${reviewRoute.round}`
            : (activeSession?.title ?? 'New session')}
        </h1>
        {reviewRoute ? (
          <p className="session-progress">
            {activeSession?.title ?? reviewRoute.sessionId}
          </p>
        ) : (
          activeSession?.summary && (
            <p className="session-progress">{activeSession.summary}</p>
          )
        )}
      </div>
      {reviewRoute && (
        <button
          className="secondary-button"
          type="button"
          onClick={onCloseReview}
        >
          <ArrowLeft size={16} />
          Back
        </button>
      )}
    </header>
  );
}
