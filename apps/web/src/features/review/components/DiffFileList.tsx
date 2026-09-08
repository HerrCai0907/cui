import { useEffect, useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";
import type { ApiDiffFilePage, ApiDiffFileSummary } from "../../../types";
import {
  CONTEXT_EXPAND_LINE_COUNT,
  DEFAULT_CONTEXT_LINE_COUNT,
  type DiffLine,
} from "../model/diffParser";
import { DiffRow } from "./DiffRow";

export type DiffFileListFile = ApiDiffFileSummary;

const AUTO_LOAD_DIFF_LINE_THRESHOLD = 80;

type DiffFileListProps = {
  files: DiffFileListFile[];
  initialPages?: Record<string, ApiDiffFilePage>;
  loadFilePage?: (
    fileId: string,
    options: { context: number; cursor?: string },
  ) => Promise<ApiDiffFilePage>;
  approvedFileIds?: Set<string>;
  commentLineId?: string;
  commentDraft?: string;
  hasComment?: boolean;
  getFileSectionId?: (file: DiffFileListFile) => string;
  onToggleFile?: (fileId: string, approved: boolean) => void;
  onToggleCommentLine?: (lineId: string) => void;
  onUpdateCommentDraft?: (commentDraft: string) => void;
};

export function DiffFileList({
  files,
  initialPages,
  loadFilePage,
  approvedFileIds,
  commentLineId,
  commentDraft,
  hasComment,
  getFileSectionId,
  onToggleFile,
  onToggleCommentLine,
  onUpdateCommentDraft,
}: DiffFileListProps) {
  const [localApprovedFileIds, setLocalApprovedFileIds] = useState<Set<string>>(() => new Set());
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
          <DiffFilePanel
            approved={approved}
            commentDraft={commentDraft}
            commentLineId={commentLineId}
            file={file}
            getFileSectionId={getFileSectionId}
            hasComment={hasComment}
            initialPage={initialPages?.[file.id]}
            key={file.id}
            loadFilePage={loadFilePage}
            onToggleCommentLine={onToggleCommentLine}
            onToggleFile={toggleFile}
            onUpdateCommentDraft={onUpdateCommentDraft}
          />
        );
      })}
    </>
  );
}

function DiffFilePanel({
  file,
  approved,
  initialPage,
  loadFilePage,
  commentLineId,
  commentDraft,
  hasComment,
  getFileSectionId,
  onToggleFile,
  onToggleCommentLine,
  onUpdateCommentDraft,
}: {
  file: DiffFileListFile;
  approved: boolean;
  initialPage?: ApiDiffFilePage;
  loadFilePage?: DiffFileListProps["loadFilePage"];
  commentLineId?: string;
  commentDraft?: string;
  hasComment?: boolean;
  getFileSectionId?: (file: DiffFileListFile) => string;
  onToggleFile: (fileId: string, approved: boolean) => void;
  onToggleCommentLine?: (lineId: string) => void;
  onUpdateCommentDraft?: (commentDraft: string) => void;
}) {
  const [state, setState] = useState<{
    context: number;
    lines: DiffLine[];
    pageInfo?: ApiDiffFilePage["pageInfo"];
    loaded: boolean;
    loading: boolean;
    error?: string;
  }>(() => ({
    context: DEFAULT_CONTEXT_LINE_COUNT,
    lines: (initialPage?.lines ?? []) as DiffLine[],
    pageInfo: initialPage?.pageInfo,
    loaded: Boolean(initialPage),
    loading: false,
  }));
  const autoLoadedFileIds = useRef<Set<string>>(new Set());
  const metadata = useMemo(() => file.metadata.join("\n"), [file.metadata]);

  useEffect(() => {
    setState({
      context: DEFAULT_CONTEXT_LINE_COUNT,
      lines: (initialPage?.lines ?? []) as DiffLine[],
      pageInfo: initialPage?.pageInfo,
      loaded: Boolean(initialPage),
      loading: false,
    });
  }, [file.id, initialPage]);

  useEffect(() => {
    if (
      approved ||
      state.loaded ||
      state.loading ||
      !loadFilePage ||
      !shouldAutoLoadDiffFile(file) ||
      autoLoadedFileIds.current.has(file.id)
    ) {
      return;
    }

    autoLoadedFileIds.current.add(file.id);
    void loadPage({ context: DEFAULT_CONTEXT_LINE_COUNT });
  }, [approved, file, loadFilePage, state.loaded, state.loading]);

  async function loadPage(options: { context: number; cursor?: string; append?: boolean }) {
    if (!loadFilePage) {
      return;
    }

    setState((current) => ({ ...current, loading: true, error: undefined }));

    try {
      const page = await loadFilePage(file.id, {
        context: options.context,
        cursor: options.cursor,
      });

      setState((current) => ({
        context: options.context,
        lines: options.append
          ? [...current.lines, ...(page.lines as DiffLine[])]
          : (page.lines as DiffLine[]),
        pageInfo: page.pageInfo,
        loaded: true,
        loading: false,
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : "Failed to load diff",
      }));
    }
  }

  function expandContext(lineId: string, direction: "down" | "up") {
    if (!loadFilePage) {
      setState((current) => ({
        ...current,
        lines: expandDiffLines(current.lines, lineId, direction),
      }));
      return;
    }

    void loadPage({ context: state.context + CONTEXT_EXPAND_LINE_COUNT });
  }

  function loadMore() {
    const cursor = state.pageInfo?.nextCursor;

    if (!cursor) {
      return;
    }

    void loadPage({ context: state.context, cursor, append: true });
  }

  return (
    <section className="review-diff-file" id={getFileSectionId?.(file)}>
      <header className="review-diff-file-header">
        <label
          className={`review-diff-collapse-control ${approved ? "is-approved" : ""}`}
          title={approved ? `Unapprove ${file.path}` : `Approve ${file.path}`}
        >
          <input
            type="checkbox"
            checked={approved}
            aria-label={`Approve ${file.path}`}
            onChange={(event) => onToggleFile(file.id, event.currentTarget.checked)}
          />
          <span aria-hidden="true">
            <Check size={14} />
          </span>
        </label>
        <strong title={file.path}>{file.path}</strong>
        <span className="review-diff-stats" aria-label="Changed lines">
          <span className="review-diff-addition">+{file.additions}</span>
          <span className="review-diff-deletion">-{file.deletions}</span>
        </span>
      </header>
      {!approved && (
        <>
          {!state.loaded && (
            <div className="review-diff-lazy-panel">
              <pre className="review-diff-metadata">{metadata || "No textual diff available."}</pre>
              {file.isBinary ? (
                <p>Binary diff is not available.</p>
              ) : loadFilePage ? (
                <button
                  className="secondary-button"
                  type="button"
                  disabled={state.loading}
                  onClick={() => loadPage({ context: state.context })}
                >
                  {state.loading ? "Loading..." : file.isLarge ? "Load large diff" : "Load diff"}
                </button>
              ) : (
                <p>Large diff. Load this file from the review server to inspect it.</p>
              )}
              {state.error && <p className="error-line">{state.error}</p>}
            </div>
          )}
          {state.loaded && state.lines.length > 0 && (
            <div className="review-diff-table" role="table">
              {state.lines.map((line) => (
                <DiffRow
                  filePath={file.path}
                  line={line}
                  key={line.id}
                  commentOpen={commentLineId === line.id}
                  commentDraft={commentDraft}
                  hasComment={hasComment && commentLineId === line.id}
                  onExpandDown={() => expandContext(line.id, "down")}
                  onExpandUp={() => expandContext(line.id, "up")}
                  onToggleComment={
                    onToggleCommentLine ? () => onToggleCommentLine(line.id) : undefined
                  }
                  onUpdateCommentDraft={onUpdateCommentDraft}
                />
              ))}
              {state.pageInfo?.hasMoreAfter && (
                <div className="review-diff-load-more">
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={state.loading}
                    onClick={loadMore}
                  >
                    {state.loading ? "Loading..." : "Load more"}
                  </button>
                </div>
              )}
            </div>
          )}
          {state.loaded && state.lines.length === 0 && (
            <pre className="review-diff-metadata">{metadata || "No textual diff available."}</pre>
          )}
        </>
      )}
    </section>
  );
}

function shouldAutoLoadDiffFile(file: DiffFileListFile): boolean {
  return !file.isBinary && !file.isLarge && file.lineCount <= AUTO_LOAD_DIFF_LINE_THRESHOLD;
}

function expandDiffLines(
  lines: DiffLine[],
  targetLineId: string,
  direction: "down" | "up",
): DiffLine[] {
  return lines.flatMap((line) => {
    if (line.id !== targetLineId || !line.hiddenLines?.length) {
      return [line];
    }

    const { nextLine, expandedLines } = expandHiddenLines(line, direction);

    if (direction === "up") {
      return nextLine ? [nextLine, ...expandedLines] : expandedLines;
    }

    return nextLine ? [...expandedLines, nextLine] : expandedLines;
  });
}

function expandHiddenLines(
  line: DiffLine,
  direction: "down" | "up",
): {
  nextLine?: DiffLine;
  expandedLines: DiffLine[];
} {
  const hiddenLines = line.hiddenLines ?? [];

  if (direction === "up") {
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
