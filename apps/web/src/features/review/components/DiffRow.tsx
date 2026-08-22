import { markerForKind, type DiffLine } from '../model/diffParser';

export function DiffRow({ line }: { line: DiffLine }) {
  if (line.kind === 'ellipsis') {
    return (
      <div className="review-diff-row review-diff-row-ellipsis">
        <span />
        <span />
        <code>{line.content}</code>
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
