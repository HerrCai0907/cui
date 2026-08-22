import { useEffect, useRef, useState } from 'react';
import type { ApiAtomicDiffReview } from '../../../types';
import { AtomicReview } from './AtomicReview';
import { DiffFileList } from './DiffFileList';
import { parseDiff } from '../model/diffParser';
import {
  createEmptyAtomicItemState,
  createEmptyReviewBrowserState,
  loadReviewBrowserState,
  saveReviewBrowserState,
  toggleString,
  type AtomicReviewItemState,
  type ReviewBrowserState,
} from '../model/reviewBrowserState';

type ReviewDiffProps = {
  diff: string;
  atomicReview?: ApiAtomicDiffReview;
  mode: 'atomic' | 'full';
  stateKey: string;
  onOpenFullReview?: () => void;
};

export function ReviewDiff({
  diff,
  atomicReview,
  mode,
  stateKey,
  onOpenFullReview,
}: ReviewDiffProps) {
  const files = parseDiff(diff);
  const initialReviewStateRef = useRef<ReviewBrowserState | null>(null);

  if (!initialReviewStateRef.current) {
    initialReviewStateRef.current = loadReviewBrowserState(stateKey);
  }

  const [reviewState, setReviewState] = useState<ReviewBrowserState>(() =>
    initialReviewStateRef.current ?? createEmptyReviewBrowserState(),
  );
  const reviewStateRef = useRef(reviewState);

  useEffect(() => {
    const storedState = loadReviewBrowserState(stateKey);

    reviewStateRef.current = storedState;
    setReviewState(storedState);
  }, [stateKey]);

  if (files.length === 0) {
    return <p className="empty-review">No code changes in this round.</p>;
  }

  function updateReviewState(
    updater: (current: ReviewBrowserState) => ReviewBrowserState,
  ) {
    const next = updater(reviewStateRef.current);

    reviewStateRef.current = next;
    setReviewState(next);
    saveReviewBrowserState(stateKey, next);
  }

  function toggleFullReviewFile(fileId: string, approved: boolean) {
    updateReviewState((current) => ({
      ...current,
      fullApprovedFileIds: toggleString(current.fullApprovedFileIds, fileId, approved),
    }));
  }

  function updateAtomicItemState(
    itemId: string,
    updater: (current: AtomicReviewItemState) => AtomicReviewItemState,
  ) {
    updateReviewState((current) => {
      const currentItem = current.atomicItems[itemId] ?? createEmptyAtomicItemState();

      return {
        ...current,
        atomicItems: {
          ...current.atomicItems,
          [itemId]: updater(currentItem),
        },
      };
    });
  }

  if (mode === 'full') {
    return (
      <div className="review-diff" aria-label="Full review diff">
        <section className="review-diff-section" aria-label="Full round diff">
          <header className="review-diff-section-header">
            <div>
              <span className="section-label">Full Review</span>
              <strong>Round changes</strong>
            </div>
          </header>
          <DiffFileList
            files={files}
            approvedFileIds={new Set(reviewState.fullApprovedFileIds)}
            onToggleFile={toggleFullReviewFile}
          />
        </section>
      </div>
    );
  }

  return (
    <div className="review-diff" aria-label="Atomic review diff">
      <AtomicReview
        review={atomicReview}
        itemStates={reviewState.atomicItems}
        onUpdateItemState={updateAtomicItemState}
        onOpenFullReview={onOpenFullReview}
      />
    </div>
  );
}
