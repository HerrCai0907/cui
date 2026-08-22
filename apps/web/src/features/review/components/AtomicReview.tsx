import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ApiAtomicDiffReview, ApiAtomicDiffReviewItem } from '../../../types';
import { shortId } from '../../../shared/lib/ids';
import { DiffFileList } from './DiffFileList';
import { parseDiff } from '../model/diffParser';
import {
  createEmptyAtomicItemState,
  toggleString,
  type AtomicReviewItemState,
} from '../model/reviewBrowserState';

type AtomicReviewProps = {
  review?: ApiAtomicDiffReview;
  itemStates: Record<string, AtomicReviewItemState>;
  onUpdateItemState: (
    itemId: string,
    updater: (current: AtomicReviewItemState) => AtomicReviewItemState,
  ) => void;
  onOpenFullReview?: () => void;
};

export function AtomicReview({
  review,
  itemStates,
  onUpdateItemState,
  onOpenFullReview,
}: AtomicReviewProps) {
  if (!review) {
    return (
      <section className="atomic-review-panel">
        <AtomicReviewTopline onOpenFullReview={onOpenFullReview} />
        <p>Atomic diff review has not been generated for this round.</p>
      </section>
    );
  }

  if (review.status === 'failed') {
    return (
      <section className="atomic-review-panel is-error">
        <AtomicReviewTopline onOpenFullReview={onOpenFullReview} />
        <strong>Generation failed</strong>
        <p>{review.error}</p>
      </section>
    );
  }

  return (
    <section className="atomic-review-panel" aria-label="Atomic review">
      <header className="atomic-review-header">
        <div>
          <span className="section-label">Atomic Review</span>
          <strong>{review.items.length} atomic changes</strong>
        </div>
        <div className="atomic-review-actions">
          <button
            className="secondary-button"
            type="button"
            onClick={onOpenFullReview}
          >
            Full review
          </button>
          <small title={review.analysisSessionId}>
            Session {shortId(review.analysisSessionId)}
          </small>
        </div>
      </header>
      <div className="atomic-review-list">
        {review.items.map((item) => (
          <AtomicReviewItem
            item={item}
            itemState={itemStates[item.id] ?? createEmptyAtomicItemState()}
            key={item.id}
            onUpdateItemState={onUpdateItemState}
          />
        ))}
      </div>
    </section>
  );
}

function AtomicReviewTopline({
  onOpenFullReview,
}: {
  onOpenFullReview?: () => void;
}) {
  return (
    <header className="atomic-review-header">
      <div>
        <span className="section-label">Atomic Review</span>
        <strong>Atomic changes</strong>
      </div>
      <button
        className="secondary-button"
        type="button"
        onClick={onOpenFullReview}
      >
        Full review
      </button>
    </header>
  );
}

function AtomicReviewItem({
  item,
  itemState,
  onUpdateItemState,
}: {
  item: ApiAtomicDiffReviewItem;
  itemState: AtomicReviewItemState;
  onUpdateItemState: (
    itemId: string,
    updater: (current: AtomicReviewItemState) => AtomicReviewItemState,
  ) => void;
}) {
  const collapsed = Boolean(itemState.collapsed);
  const files = parseDiff(item.diff);
  const approvedFileIds = new Set(itemState.approvedFileIds);
  const allFilesApproved =
    files.length > 0 && files.every((file) => approvedFileIds.has(file.id));

  function toggleCollapsed() {
    onUpdateItemState(item.id, (current) => ({
      ...current,
      collapsed: !Boolean(current.collapsed),
    }));
  }

  function approveAllFiles() {
    onUpdateItemState(item.id, (current) => {
      if (allFilesApproved) {
        return { ...current, approvedFileIds: [] };
      }

      return {
        ...current,
        approvedFileIds: files.map((file) => file.id),
      };
    });
  }

  function toggleFile(fileId: string, approved: boolean) {
    onUpdateItemState(item.id, (current) => ({
      ...current,
      approvedFileIds: toggleString(current.approvedFileIds, fileId, approved),
    }));
  }

  return (
    <article
      className={`atomic-review-item ${capabilityToneClass(
        item.capabilityType,
      )}`}
    >
      <header className="atomic-review-item-header">
        <div className="atomic-review-heading-row">
          <button
            className="atomic-review-toggle"
            type="button"
            aria-expanded={!collapsed}
            aria-label={`${
              collapsed ? 'Expand' : 'Collapse'
            } atomic change ${item.order}`}
            title={collapsed ? 'Expand atomic change' : 'Collapse atomic change'}
            onClick={toggleCollapsed}
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
          </button>
          <button
            className="atomic-review-approve-all"
            type="button"
            aria-pressed={allFilesApproved}
            disabled={files.length === 0}
            onClick={approveAllFiles}
          >
            {allFilesApproved ? 'Unapprove all' : 'Approve all'}
          </button>
          <h2>{item.title}</h2>
        </div>
        <p>{item.intent}</p>
      </header>
      {!collapsed && (
        <div className="atomic-review-change-block">
          <DiffFileList
            files={files}
            approvedFileIds={approvedFileIds}
            onToggleFile={toggleFile}
          />
        </div>
      )}
    </article>
  );
}

function capabilityToneClass(
  capabilityType: ApiAtomicDiffReviewItem['capabilityType'],
): string {
  if (capabilityType === 0 || capabilityType === 1) {
    return 'is-capability-low-risk';
  }

  if (capabilityType === 2) {
    return 'is-capability-feature';
  }

  return 'is-capability-change';
}
