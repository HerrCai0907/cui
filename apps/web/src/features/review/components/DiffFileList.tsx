import { useState } from 'react';
import {
  CONTEXT_EXPAND_LINE_COUNT,
  type DiffFile,
  type DiffLine,
} from '../model/diffParser';
import { DiffRow } from './DiffRow';

type DiffFileListProps = {
  files: DiffFile[];
  approvedFileIds?: Set<string>;
  onToggleFile?: (fileId: string, approved: boolean) => void;
};

export function DiffFileList({
  files,
  approvedFileIds,
  onToggleFile,
}: DiffFileListProps) {
  const [localApprovedFileIds, setLocalApprovedFileIds] = useState<
    Set<string>
  >(() => new Set());
  const [expandedLinesByFileId, setExpandedLinesByFileId] = useState<
    Record<string, DiffLine[]>
  >(() => ({}));
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

  function expandContextLine(
    fileId: string,
    lineId: string,
    direction: 'down' | 'up',
  ) {
    const file = files.find((currentFile) => currentFile.id === fileId);

    if (!file) {
      return;
    }

    setExpandedLinesByFileId((current) => ({
      ...current,
      [fileId]: expandDiffLines(
        current[fileId] ?? file.lines,
        lineId,
        direction,
      ),
    }));
  }

  return (
    <>
      {files.map((file) => {
        const approved = activeApprovedFileIds.has(file.id);
        const lines = expandedLinesByFileId[file.id] ?? file.lines;

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
            {!approved && lines.length > 0 ? (
              <div className="review-diff-table" role="table">
                {lines.map((line) => (
                  <DiffRow
                    line={line}
                    key={line.id}
                    onExpandDown={() =>
                      expandContextLine(file.id, line.id, 'down')
                    }
                    onExpandUp={() => expandContextLine(file.id, line.id, 'up')}
                  />
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

function expandDiffLines(
  lines: DiffLine[],
  targetLineId: string,
  direction: 'down' | 'up',
): DiffLine[] {
  return lines.flatMap((line) => {
    if (line.id !== targetLineId || !line.hiddenLines?.length) {
      return [line];
    }

    const { nextLine, expandedLines } = expandHiddenLines(line, direction);

    if (direction === 'up') {
      return nextLine ? [nextLine, ...expandedLines] : expandedLines;
    }

    return nextLine ? [...expandedLines, nextLine] : expandedLines;
  });
}

function expandHiddenLines(
  line: DiffLine,
  direction: 'down' | 'up',
): {
  nextLine?: DiffLine;
  expandedLines: DiffLine[];
} {
  const hiddenLines = line.hiddenLines ?? [];

  if (direction === 'up') {
    const splitIndex = Math.max(0, hiddenLines.length - CONTEXT_EXPAND_LINE_COUNT);
    const nextHiddenLines = hiddenLines.slice(0, splitIndex);

    return {
      nextLine: createRemainingEllipsisLine(line, nextHiddenLines),
      expandedLines: hiddenLines.slice(splitIndex),
    };
  }

  const nextHiddenLines = hiddenLines.slice(CONTEXT_EXPAND_LINE_COUNT);

  return {
    nextLine: createRemainingEllipsisLine(line, nextHiddenLines),
    expandedLines: hiddenLines.slice(0, CONTEXT_EXPAND_LINE_COUNT),
  };
}

function createRemainingEllipsisLine(
  line: DiffLine,
  hiddenLines: DiffLine[],
): DiffLine | undefined {
  if (hiddenLines.length === 0) {
    return undefined;
  }

  return {
    ...line,
    hiddenLines,
  };
}
