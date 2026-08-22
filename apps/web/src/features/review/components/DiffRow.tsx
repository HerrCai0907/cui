import { ChevronsDown, ChevronsUp } from 'lucide-react';
import { markerForKind, type DiffLine } from '../model/diffParser';

type DiffRowProps = {
  line: DiffLine;
  onExpandDown?: () => void;
  onExpandUp?: () => void;
};

export function DiffRow({ line, onExpandDown, onExpandUp }: DiffRowProps) {
  if (line.kind === 'ellipsis') {
    return (
      <div className="review-diff-row review-diff-row-ellipsis">
        <span />
        <span />
        <code>
          <span className="review-diff-ellipsis-actions">
            {line.canExpandUp && (
              <button
                type="button"
                aria-label="Expand 10 lines up"
                title="Expand 10 lines up"
                onClick={onExpandUp}
              >
                <ChevronsUp size={14} />
              </button>
            )}
            {line.canExpandDown && (
              <button
                type="button"
                aria-label="Expand 10 lines down"
                title="Expand 10 lines down"
                onClick={onExpandDown}
              >
                <ChevronsDown size={14} />
              </button>
            )}
          </span>
          <span>{line.content}</span>
        </code>
      </div>
    );
  }

  return (
    <div className={`review-diff-row review-diff-row-${line.kind}`}>
      <span className="review-diff-line-number">{line.oldLine ?? ''}</span>
      <span className="review-diff-line-number">{line.newLine ?? ''}</span>
      <code>
        <span className="review-diff-marker">{markerForKind(line.kind)}</span>
        {line.content}
      </code>
    </div>
  );
}
