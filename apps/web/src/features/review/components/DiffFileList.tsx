import { useState } from 'react';
import type { DiffFile } from '../model/diffParser';
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
