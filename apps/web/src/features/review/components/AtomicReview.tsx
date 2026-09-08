import { CheckCheck, ChevronDown, ChevronRight, RotateCcw, Send } from "lucide-react";
import type {
  ApiAtomicDiffReview,
  ApiAtomicDiffReviewItem,
  ApiDiffFilePage,
  ApiDiffFileSummary,
} from "../../../types";
import { shortId } from "../../../shared/lib/ids";
import { DiffFileList } from "./DiffFileList";
import { parseDiff } from "../model/diffParser";
import { getAtomicDiffFilePage } from "../api/reviewApi";
import {
  createEmptyAtomicItemState,
  toggleString,
  type AtomicReviewItemState,
} from "../model/reviewBrowserState";
import {
  createAtomicReviewFileSectionId,
  createAtomicReviewSectionId,
} from "../model/reviewNavigation";

type AtomicReviewProps = {
  review?: ApiAtomicDiffReview;
  sessionId: string;
  round: number;
  itemStates: Record<string, AtomicReviewItemState>;
  commentCount: number;
  commentsDisabled: boolean;
  sendingComments: boolean;
  onUpdateItemState: (
    itemId: string,
    updater: (current: AtomicReviewItemState) => AtomicReviewItemState,
  ) => void;
  onOpenFullReview?: () => void;
  onSubmitComments: () => void | Promise<void>;
};

export function AtomicReview({
  review,
  sessionId,
  round,
  itemStates,
  commentCount,
  commentsDisabled,
  sendingComments,
  onUpdateItemState,
  onOpenFullReview,
  onSubmitComments,
}: AtomicReviewProps) {
  if (!review) {
    return (
      <section className="atomic-review-panel">
        <AtomicReviewTopline onOpenFullReview={onOpenFullReview} />
        <p>Atomic diff review has not been generated for this round.</p>
      </section>
    );
  }

  if (review.status === "failed") {
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
          <button className="secondary-button" type="button" onClick={onOpenFullReview}>
            Full review
          </button>
          <small title={review.analysisSessionId}>
            Session {shortId(review.analysisSessionId)}
          </small>
        </div>
      </header>
      <div className="atomic-review-list">
        {[...review.items].sort(compareAtomicReviewItems).map((item) => (
          <AtomicReviewItem
            item={item}
            sessionId={sessionId}
            round={round}
            itemState={itemStates[item.id] ?? createEmptyAtomicItemState()}
            key={item.id}
            onUpdateItemState={onUpdateItemState}
          />
        ))}
      </div>
      <button
        className="send-button atomic-review-send-comments"
        type="button"
        aria-label={
          commentCount === 1
            ? "Send 1 atomic review comment"
            : `Send ${commentCount} atomic review comments`
        }
        disabled={commentsDisabled || sendingComments || commentCount === 0}
        onClick={onSubmitComments}
      >
        <Send size={18} />
        <span>{sendingComments ? "Sending..." : "Comment"}</span>
        {commentCount > 0 && <span className="atomic-review-comment-count">{commentCount}</span>}
      </button>
    </section>
  );
}

function compareAtomicReviewItems(
  left: ApiAtomicDiffReviewItem,
  right: ApiAtomicDiffReviewItem,
): number {
  return (
    left.order - right.order ||
    left.title.localeCompare(right.title) ||
    left.id.localeCompare(right.id)
  );
}

function AtomicReviewTopline({ onOpenFullReview }: { onOpenFullReview?: () => void }) {
  return (
    <header className="atomic-review-header">
      <div>
        <span className="section-label">Atomic Review</span>
        <strong>Atomic changes</strong>
      </div>
      <button className="secondary-button" type="button" onClick={onOpenFullReview}>
        Full review
      </button>
    </header>
  );
}

function AtomicReviewItem({
  item,
  sessionId,
  round,
  itemState,
  onUpdateItemState,
}: {
  item: ApiAtomicDiffReviewItem;
  sessionId: string;
  round: number;
  itemState: AtomicReviewItemState;
  onUpdateItemState: (
    itemId: string,
    updater: (current: AtomicReviewItemState) => AtomicReviewItemState,
  ) => void;
}) {
  const collapsed = Boolean(itemState.collapsed);
  const commentOpen = Boolean(itemState.commentOpen);
  const commentDraft = itemState.commentDraft ?? "";
  const hasComment = Boolean(commentDraft.trim());
  const shouldParseLegacyDiff = !collapsed && !item.diffSummary;
  const legacyParsedFiles = shouldParseLegacyDiff ? parseDiff(item.diff ?? "") : [];
  const files = item.diffSummary?.files ?? toDiffFileSummaries(legacyParsedFiles, item.diff);
  const initialPages = toInitialPages(legacyParsedFiles);
  const activeCommentLineId =
    itemState.commentLineId ??
    (commentOpen ? findFirstCommentableLineId(initialPages, files) : undefined);
  const approvedFileIds = new Set(itemState.approvedFileIds);
  const allFilesApproved = files.length > 0 && files.every((file) => approvedFileIds.has(file.id));

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

  function toggleCommentLine(lineId: string) {
    onUpdateItemState(item.id, (current) => ({
      ...current,
      commentLineId: lineId,
      commentOpen: !(
        current.commentOpen && (current.commentLineId ?? activeCommentLineId) === lineId
      ),
    }));
  }

  function updateCommentDraft(commentDraft: string) {
    onUpdateItemState(item.id, (current) => ({
      ...current,
      commentDraft,
      commentOpen: true,
      commentLineId: current.commentLineId ?? activeCommentLineId,
    }));
  }

  return (
    <section
      className={`atomic-review-item ${commentOpen ? "has-comment-open" : ""} ${hasComment ? "has-comment-draft" : ""} ${capabilityToneClass(item.capabilityType)}`}
      id={createAtomicReviewSectionId(item.id)}
    >
      <header className="atomic-review-item-header">
        <div className="atomic-review-heading-row">
          <button
            className="atomic-review-toggle"
            type="button"
            aria-expanded={!collapsed}
            aria-label={`${collapsed ? "Expand" : "Collapse"} atomic change ${item.order}`}
            title={collapsed ? "Expand atomic change" : "Collapse atomic change"}
            onClick={toggleCollapsed}
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
          </button>
          <button
            className="atomic-review-approve-all"
            type="button"
            aria-label={allFilesApproved ? "Unapprove all" : "Approve all"}
            aria-pressed={allFilesApproved}
            title={allFilesApproved ? "Unapprove all" : "Approve all"}
            disabled={files.length === 0}
            onClick={approveAllFiles}
          >
            {allFilesApproved ? (
              <RotateCcw size={15} aria-hidden="true" />
            ) : (
              <CheckCheck size={15} aria-hidden="true" />
            )}
          </button>
          <h2>{item.title}</h2>
          <span className="atomic-review-comment-status" aria-hidden={!hasComment}>
            {hasComment ? "Commented" : ""}
          </span>
        </div>
        <p>{item.intent}</p>
      </header>
      {!collapsed && (
        <div className={`atomic-review-change-block ${commentOpen ? "has-comment-open" : ""}`}>
          <DiffFileList
            files={files}
            initialPages={initialPages}
            loadFilePage={
              item.diffSummary
                ? (fileId, options) =>
                    getAtomicDiffFilePage({
                      sessionId,
                      round,
                      itemId: item.id,
                      fileId,
                      ...options,
                    })
                : undefined
            }
            approvedFileIds={approvedFileIds}
            commentLineId={activeCommentLineId}
            commentDraft={commentDraft}
            hasComment={hasComment}
            getFileSectionId={(file) => createAtomicReviewFileSectionId(item.id, file.id)}
            onToggleFile={toggleFile}
            onToggleCommentLine={toggleCommentLine}
            onUpdateCommentDraft={updateCommentDraft}
          />
        </div>
      )}
    </section>
  );
}

function findFirstCommentableLineId(
  initialPages: Record<string, ApiDiffFilePage>,
  files: ApiDiffFileSummary[],
): string | undefined {
  for (const file of files) {
    const line = initialPages[file.id]?.lines.find((candidate) => candidate.kind !== "ellipsis");

    if (line) {
      return line.id;
    }
  }

  return undefined;
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

function capabilityToneClass(capabilityType: ApiAtomicDiffReviewItem["capabilityType"]): string {
  if (capabilityType === 0 || capabilityType === 1) {
    return "is-capability-low-risk";
  }

  if (capabilityType === 2) {
    return "is-capability-feature";
  }

  if (capabilityType === 5) {
    return "is-capability-test";
  }

  return "is-capability-change";
}
