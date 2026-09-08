import type { ApiDiffFilePage, ApiDiffFileSummary, ApiRoundReview } from "../../../types";
import { AtomicReview } from "./AtomicReview";
import { DiffFileList } from "./DiffFileList";
import { parseDiff } from "../model/diffParser";
import { getRoundDiffFilePage } from "../api/reviewApi";
import {
  createEmptyAtomicItemState,
  toggleString,
  type AtomicReviewItemState,
  type ReviewBrowserState,
} from "../model/reviewBrowserState";

type ReviewDiffProps = {
  review: ApiRoundReview;
  sessionId: string;
  round: number;
  mode: "atomic" | "full";
  reviewState: ReviewBrowserState;
  commentCount: number;
  commentsDisabled: boolean;
  sendingComments: boolean;
  onUpdateReviewState: (updater: (current: ReviewBrowserState) => ReviewBrowserState) => void;
  onOpenFullReview?: () => void;
  onSubmitAtomicComments: () => void | Promise<void>;
};

export function ReviewDiff({
  review,
  sessionId,
  round,
  mode,
  reviewState,
  commentCount,
  commentsDisabled,
  sendingComments,
  onUpdateReviewState,
  onOpenFullReview,
  onSubmitAtomicComments,
}: ReviewDiffProps) {
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

  if (mode === "atomic") {
    return (
      <div className="review-diff" aria-label="Atomic review diff">
        <AtomicReview
          review={review.atomicReview}
          sessionId={sessionId}
          round={round}
          itemStates={reviewState.atomicItems}
          commentCount={commentCount}
          commentsDisabled={commentsDisabled}
          sendingComments={sendingComments}
          onUpdateItemState={updateAtomicItemState}
          onOpenFullReview={onOpenFullReview}
          onSubmitComments={onSubmitAtomicComments}
        />
      </div>
    );
  }

  const legacyParsedFiles = review.diffSummary ? [] : parseDiff(review.diff ?? "");
  const files = review.diffSummary?.files ?? toDiffFileSummaries(legacyParsedFiles, review.diff);
  const initialPages = toInitialPages(legacyParsedFiles);

  if (files.length === 0) {
    return review.diff && !review.diffSummary ? (
      <p className="empty-review">Large diff. Load file pages from a refreshed review summary.</p>
    ) : (
      <p className="empty-review">No code changes in this round.</p>
    );
  }

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
          initialPages={initialPages}
          loadFilePage={
            review.diffSummary
              ? (fileId, options) =>
                  getRoundDiffFilePage({
                    sessionId,
                    round,
                    fileId,
                    ...options,
                  })
              : undefined
          }
          approvedFileIds={new Set(reviewState.fullApprovedFileIds)}
          onToggleFile={toggleFullReviewFile}
        />
      </section>
    </div>
  );
}

function toDiffFileSummaries(
  files: ReturnType<typeof parseDiff>,
  diff: string | undefined,
): ApiDiffFileSummary[] {
  return files.map((file) => ({
    id: file.id,
    path: file.path,
    status: "modified",
    additions: file.additions,
    deletions: file.deletions,
    hunkCount: 0,
    lineCount: file.lines.length,
    byteSize: diff?.length ?? 0,
    isLarge: false,
    isBinary: false,
    metadata: file.metadata,
  }));
}

function toInitialPages(files: ReturnType<typeof parseDiff>): Record<string, ApiDiffFilePage> {
  return Object.fromEntries(
    files.map((file) => [
      file.id,
      {
        file: {
          id: file.id,
          path: file.path,
          status: "modified",
          additions: file.additions,
          deletions: file.deletions,
          hunkCount: 0,
          lineCount: file.lines.length,
          byteSize: 0,
          isLarge: false,
          isBinary: false,
          metadata: file.metadata,
        },
        lines: file.lines,
        pageInfo: {
          returned: file.lines.length,
          totalVisible: file.lines.length,
          hasMoreBefore: false,
          hasMoreAfter: false,
          hasExpandableContext: file.lines.some((line) => line.kind === "ellipsis"),
          contextLines: 3,
          truncated: false,
        },
      },
    ]),
  );
}
