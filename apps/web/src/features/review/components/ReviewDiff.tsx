import type { ApiAtomicDiffReview } from "../../../types";
import { AtomicReview } from "./AtomicReview";
import { DiffFileList } from "./DiffFileList";
import { parseDiff } from "../model/diffParser";
import {
  createEmptyAtomicItemState,
  toggleString,
  type AtomicReviewItemState,
  type ReviewBrowserState,
} from "../model/reviewBrowserState";

type ReviewDiffProps = {
  diff: string;
  atomicReview?: ApiAtomicDiffReview;
  mode: "atomic" | "full";
  reviewState: ReviewBrowserState;
  onUpdateReviewState: (updater: (current: ReviewBrowserState) => ReviewBrowserState) => void;
  onOpenFullReview?: () => void;
};

export function ReviewDiff({
  diff,
  atomicReview,
  mode,
  reviewState,
  onUpdateReviewState,
  onOpenFullReview,
}: ReviewDiffProps) {
  const files = parseDiff(diff);

  if (files.length === 0) {
    return <p className="empty-review">No code changes in this round.</p>;
  }

  function toggleFullReviewFile(fileId: string, approved: boolean) {
    onUpdateReviewState((current) => ({
      ...current,
      fullApprovedFileIds: toggleString(current.fullApprovedFileIds, fileId, approved),
    }));
  }

  function updateAtomicItemState(
    itemId: string,
    updater: (current: AtomicReviewItemState) => AtomicReviewItemState,
  ) {
    onUpdateReviewState((current) => {
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

  if (mode === "full") {
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
