import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ApiAtomicDiffReview, ApiAtomicDiffReviewItem } from '../types';

const CONTEXT_LINE_COUNT = 3;

type DiffLineKind = 'add' | 'remove' | 'context' | 'meta' | 'ellipsis';

type DiffLine = {
  id: string;
  kind: DiffLineKind;
  oldLine?: number;
  newLine?: number;
  content: string;
};

type DiffFile = {
  id: string;
  path: string;
  additions: number;
  deletions: number;
  lines: DiffLine[];
  metadata: string[];
};

type ParsedHunkLine = Omit<DiffLine, 'id'>;

type ParsedHunk = {
  lines: ParsedHunkLine[];
};

type ParsedFileBlock = {
  header: string;
  lines: string[];
};

type ReviewDiffProps = {
  diff: string;
  atomicReview?: ApiAtomicDiffReview;
  mode: 'atomic' | 'full';
  onOpenFullReview?: () => void;
};

export function ReviewDiff({
  diff,
  atomicReview,
  mode,
  onOpenFullReview,
}: ReviewDiffProps) {
  const files = parseDiff(diff, CONTEXT_LINE_COUNT);

  if (files.length === 0) {
    return <p className="empty-review">No code changes in this round.</p>;
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
          <DiffFileList files={files} />
        </section>
      </div>
    );
  }

  return (
    <div className="review-diff" aria-label="Atomic review diff">
      <AtomicReview review={atomicReview} onOpenFullReview={onOpenFullReview} />
    </div>
  );
}

function AtomicReview({
  review,
  onOpenFullReview,
}: {
  review?: ApiAtomicDiffReview;
  onOpenFullReview?: () => void;
}) {
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
          <AtomicReviewItem item={item} key={item.id} />
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
      <button className="secondary-button" type="button" onClick={onOpenFullReview}>
        Full review
      </button>
    </header>
  );
}

function AtomicReviewItem({ item }: { item: ApiAtomicDiffReviewItem }) {
  const [collapsed, setCollapsed] = useState(false);
  const files = parseDiff(item.diff, CONTEXT_LINE_COUNT);
  const [approvedFileIds, setApprovedFileIds] = useState<Set<string>>(
    () => new Set(),
  );
  const allFilesApproved =
    files.length > 0 && files.every((file) => approvedFileIds.has(file.id));

  function approveAllFiles() {
    setApprovedFileIds((current) => {
      if (allFilesApproved) {
        return new Set();
      }

      const next = new Set(current);
      files.forEach((file) => next.add(file.id));
      return next;
    });
  }

  function toggleFile(fileId: string, approved: boolean) {
    setApprovedFileIds((current) => {
      const next = new Set(current);

      if (approved) {
        next.add(fileId);
      } else {
        next.delete(fileId);
      }

      return next;
    });
  }

  return (
    <article className={`atomic-review-item ${capabilityToneClass(item.capabilityType)}`}>
      <header className="atomic-review-item-header">
        <div className="atomic-review-heading-row">
          <button
            className="atomic-review-toggle"
            type="button"
            aria-expanded={!collapsed}
            aria-label={`${collapsed ? 'Expand' : 'Collapse'} atomic change ${item.order}`}
            title={collapsed ? 'Expand atomic change' : 'Collapse atomic change'}
            onClick={() => setCollapsed((current) => !current)}
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

function DiffFileList({
  files,
  approvedFileIds,
  onToggleFile,
}: {
  files: DiffFile[];
  approvedFileIds?: Set<string>;
  onToggleFile?: (fileId: string, approved: boolean) => void;
}) {
  const [localApprovedFileIds, setLocalApprovedFileIds] = useState<Set<string>>(
    () => new Set(),
  );
  const activeApprovedFileIds = approvedFileIds ?? localApprovedFileIds;
  if (files.length === 0) {
    return <p className="empty-review">No textual diff available.</p>;
  }

  function toggleFile(fileId: string, approved: boolean) {
    if (onToggleFile) {
      onToggleFile(fileId, approved);
      return;
    }

    setLocalApprovedFileIds((current) => {
      const next = new Set(current);

      if (approved) {
        next.add(fileId);
      } else {
        next.delete(fileId);
      }

      return next;
    });
  }

  return (
    <>
      {files.map((file) => {
        const approved = activeApprovedFileIds.has(file.id);

        return (
          <section className="review-diff-file" key={file.id}>
            <header className="review-diff-file-header">
              <label className="review-diff-collapse-control">
                <input
                  type="checkbox"
                  checked={approved}
                  aria-label={`Approve ${file.path}`}
                  onChange={(event) =>
                    toggleFile(file.id, event.currentTarget.checked)
                  }
                />
                <span>Approve</span>
              </label>
              <strong title={file.path}>{file.path}</strong>
              <span className="review-diff-stats" aria-label="Changed lines">
                <span className="review-diff-addition">+{file.additions}</span>
                <span className="review-diff-deletion">-{file.deletions}</span>
              </span>
            </header>
            {!approved && file.lines.length > 0 ? (
              <div className="review-diff-table" role="table">
                {file.lines.map((line) => (
                  <DiffRow line={line} key={line.id} />
                ))}
              </div>
            ) : !approved ? (
              <pre className="review-diff-metadata">
                {file.metadata.join('\n') || 'No textual diff available.'}
              </pre>
            ) : null}
          </section>
        );
      })}
    </>
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

function DiffRow({ line }: { line: DiffLine }) {
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

function parseDiff(diff: string, contextLineCount: number): DiffFile[] {
  return splitFileBlocks(diff).map((block, fileIndex) => {
    const parsed = parseFileBlock(block, contextLineCount, fileIndex);

    return {
      ...parsed,
      id: `${fileIndex}:${parsed.path}`,
    };
  });
}

function splitFileBlocks(diff: string): ParsedFileBlock[] {
  const blocks: ParsedFileBlock[] = [];
  let current: ParsedFileBlock | undefined;

  for (const line of diff.replace(/\r\n?/g, '\n').split('\n')) {
    if (line.startsWith('diff --git ')) {
      current = { header: line, lines: [] };
      blocks.push(current);
      continue;
    }

    if (!current) {
      if (line.trim()) {
        current = { header: 'Diff', lines: [line] };
        blocks.push(current);
      }
      continue;
    }

    current.lines.push(line);
  }

  return blocks.filter(
    (block) => block.header !== 'Diff' || block.lines.some((line) => line.trim()),
  );
}

function parseFileBlock(
  block: ParsedFileBlock,
  contextLineCount: number,
  fileIndex: number,
): Omit<DiffFile, 'id'> {
  const metadata: string[] = [block.header];
  const hunks: ParsedHunk[] = [];
  let additions = 0;
  let deletions = 0;
  let index = 0;

  while (index < block.lines.length) {
    const line = block.lines[index];

    if (!line.startsWith('@@ ')) {
      if (line.trim()) {
        metadata.push(line);
      }
      index += 1;
      continue;
    }

    const parsedHunk = parseHunk(block.lines, index);
    hunks.push(parsedHunk.hunk);
    additions += parsedHunk.additions;
    deletions += parsedHunk.deletions;
    index = parsedHunk.nextIndex;
  }

  const clippedLines = clipHunks(hunks, contextLineCount).map((line, lineIndex) => ({
    ...line,
    id: `${fileIndex}:${lineIndex}:${line.kind}:${line.oldLine ?? ''}:${line.newLine ?? ''}`,
  }));

  return {
    path: getFilePath(block.header, metadata),
    additions,
    deletions,
    lines: clippedLines,
    metadata,
  };
}

function parseHunk(
  lines: string[],
  hunkStartIndex: number,
): {
  hunk: ParsedHunk;
  additions: number;
  deletions: number;
  nextIndex: number;
} {
  const hunkHeader = lines[hunkStartIndex];
  const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(hunkHeader);
  let oldLine = match ? Number(match[1]) : undefined;
  let newLine = match ? Number(match[2]) : undefined;
  const hunkLines: ParsedHunkLine[] = [];
  let additions = 0;
  let deletions = 0;
  let index = hunkStartIndex + 1;

  while (index < lines.length && !lines[index].startsWith('@@ ')) {
    const rawLine = lines[index];

    if (rawLine.startsWith('+')) {
      hunkLines.push({
        kind: 'add',
        newLine,
        content: rawLine.slice(1),
      });
      newLine = incrementLine(newLine);
      additions += 1;
    } else if (rawLine.startsWith('-')) {
      hunkLines.push({
        kind: 'remove',
        oldLine,
        content: rawLine.slice(1),
      });
      oldLine = incrementLine(oldLine);
      deletions += 1;
    } else if (rawLine.startsWith(' ')) {
      hunkLines.push({
        kind: 'context',
        oldLine,
        newLine,
        content: rawLine.slice(1),
      });
      oldLine = incrementLine(oldLine);
      newLine = incrementLine(newLine);
    } else if (rawLine.startsWith('\\')) {
      hunkLines.push({
        kind: 'meta',
        content: rawLine,
      });
    }

    index += 1;
  }

  return {
    hunk: { lines: hunkLines },
    additions,
    deletions,
    nextIndex: index,
  };
}

function clipHunks(
  hunks: ParsedHunk[],
  contextLineCount: number,
): ParsedHunkLine[] {
  const lines: ParsedHunkLine[] = [];

  hunks.forEach((hunk, hunkIndex) => {
    const changedIndexes = hunk.lines
      .map((line, index) => (line.kind === 'add' || line.kind === 'remove' ? index : -1))
      .filter((index) => index >= 0);

    if (changedIndexes.length === 0) {
      return;
    }

    const ranges = mergeRanges(
      changedIndexes.map((index) => ({
        start: Math.max(0, index - contextLineCount),
        end: Math.min(hunk.lines.length - 1, index + contextLineCount),
      })),
    );

    ranges.forEach((range, rangeIndex) => {
      if (lines.length > 0 && (hunkIndex > 0 || rangeIndex > 0)) {
        lines.push({ kind: 'ellipsis', content: '...' });
      }

      lines.push(...hunk.lines.slice(range.start, range.end + 1));
    });
  });

  return lines;
}

function mergeRanges(ranges: Array<{ start: number; end: number }>) {
  return ranges.reduce<Array<{ start: number; end: number }>>((merged, range) => {
    const previous = merged[merged.length - 1];

    if (!previous || range.start > previous.end + 1) {
      merged.push({ ...range });
    } else {
      previous.end = Math.max(previous.end, range.end);
    }

    return merged;
  }, []);
}

function getFilePath(header: string, metadata: string[]): string {
  const newPath = metadata.find((line) => line.startsWith('+++ '))?.slice(4);
  const oldPath = metadata.find((line) => line.startsWith('--- '))?.slice(4);
  const path = cleanDiffPath(newPath) ?? cleanDiffPath(oldPath);

  if (path) {
    return path;
  }

  const match = /^diff --git a\/(.+) b\/(.+)$/.exec(header);

  return match?.[2] ?? header;
}

function cleanDiffPath(path: string | undefined): string | undefined {
  if (!path || path === '/dev/null') {
    return undefined;
  }

  return path.replace(/^[ab]\//, '');
}

function incrementLine(line: number | undefined): number | undefined {
  return line === undefined ? undefined : line + 1;
}

function markerForKind(kind: DiffLineKind): string {
  if (kind === 'add') {
    return '+';
  }

  if (kind === 'remove') {
    return '-';
  }

  return ' ';
}

function shortId(value: string): string {
  return value.length <= 14 ? value : `${value.slice(0, 8)}...${value.slice(-4)}`;
}
