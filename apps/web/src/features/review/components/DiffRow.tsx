import { ChevronsDown, ChevronsUp, MessageSquare, X } from "lucide-react";
import { markerForKind, type DiffLine } from "../model/diffParser";
import { HighlightedCode } from "./HighlightedCode";

type DiffRowProps = {
  filePath: string;
  line: DiffLine;
  commentOpen?: boolean;
  commentDraft?: string;
  hasComment?: boolean;
  onExpandDown?: () => void;
  onExpandUp?: () => void;
  onToggleComment?: () => void;
  onUpdateCommentDraft?: (commentDraft: string) => void;
};

export function DiffRow({
  filePath,
  line,
  commentOpen = false,
  commentDraft = "",
  hasComment = false,
  onExpandDown,
  onExpandUp,
  onToggleComment,
  onUpdateCommentDraft,
}: DiffRowProps) {
  if (line.kind === "ellipsis") {
    return (
      <>
        {line.canExpandDown && (
          <DiffContextExpandRow
            direction="down"
            label="Expand 10 lines down"
            onExpand={onExpandDown}
          />
        )}
        {line.canExpandUp && (
          <DiffContextExpandRow direction="up" label="Expand 10 lines up" onExpand={onExpandUp} />
        )}
        {!line.canExpandDown && !line.canExpandUp && (
          <div className="review-diff-row review-diff-row-ellipsis is-gap">
            <span className="review-diff-context-gap">Lines omitted between diff hunks</span>
          </div>
        )}
      </>
    );
  }

  const canComment = Boolean(onToggleComment);
  const commentTargetLabel = formatCommentTargetLabel(line);

  return (
    <>
      <div
        className={`review-diff-row review-diff-row-${line.kind} ${canComment ? "has-comment-control" : ""} ${commentOpen ? "has-inline-comment-open" : ""} ${hasComment ? "has-inline-comment-draft" : ""}`}
      >
        <span className="review-diff-line-number">{line.oldLine ?? ""}</span>
        <span className="review-diff-line-number">{line.newLine ?? ""}</span>
        <code>
          <span className="review-diff-marker">{markerForKind(line.kind)}</span>
          <HighlightedCode content={line.content} filePath={filePath} />
        </code>
        {canComment && (
          <span className="review-diff-comment-cell">
            <button
              className="review-diff-comment-toggle"
              type="button"
              aria-expanded={commentOpen}
              aria-label={`${commentOpen ? "Close comment on" : "Comment on"} ${commentTargetLabel}`}
              title={commentOpen ? "Close comment" : "Comment"}
              onClick={onToggleComment}
            >
              {commentOpen ? <X size={14} /> : <MessageSquare size={14} />}
              {hasComment && <span className="review-diff-comment-dot" />}
            </button>
          </span>
        )}
      </div>
      {commentOpen && (
        <label className="review-diff-inline-comment">
          <span className="section-label">Comment</span>
          <textarea
            value={commentDraft}
            placeholder="Comment on this diff line..."
            rows={5}
            onChange={(event) => onUpdateCommentDraft?.(event.target.value)}
          />
        </label>
      )}
    </>
  );
}

function DiffContextExpandRow({
  direction,
  label,
  onExpand,
}: {
  direction: "down" | "up";
  label: string;
  onExpand?: () => void;
}) {
  return (
    <div className={`review-diff-row review-diff-row-ellipsis is-${direction}`}>
      <button
        className="review-diff-context-expand-button"
        type="button"
        aria-label={label}
        title={label}
        onClick={onExpand}
      >
        {direction === "up" ? <ChevronsUp size={14} /> : <ChevronsDown size={14} />}
        <span>{label}</span>
      </button>
    </div>
  );
}

function formatCommentTargetLabel(line: DiffLine): string {
  if (line.kind === "add") {
    return `added diff line ${line.newLine ?? ""}`;
  }

  if (line.kind === "remove") {
    return `removed diff line ${line.oldLine ?? ""}`;
  }

  if (line.kind === "context") {
    return `context diff line ${line.newLine ?? line.oldLine ?? ""}`;
  }

  return "diff metadata line";
}
