export const DEFAULT_CONTEXT_LINE_COUNT = 3;

export type DiffLineKind = 'add' | 'remove' | 'context' | 'meta' | 'ellipsis';

export type DiffLine = {
  id: string;
  kind: DiffLineKind;
  oldLine?: number;
  newLine?: number;
  content: string;
};

export type DiffFile = {
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

export function parseDiff(
  diff: string,
  contextLineCount = DEFAULT_CONTEXT_LINE_COUNT,
): DiffFile[] {
  return splitFileBlocks(diff).map((block, fileIndex) => {
    const parsed = parseFileBlock(block, contextLineCount, fileIndex);

    return {
      ...parsed,
      id: `${fileIndex}:${parsed.path}`,
    };
  });
}

export function markerForKind(kind: DiffLineKind): string {
  if (kind === 'add') {
    return '+';
  }

  if (kind === 'remove') {
    return '-';
  }

  return ' ';
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
    (block) =>
      block.header !== 'Diff' || block.lines.some((line) => line.trim()),
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

  const clippedLines = clipHunks(hunks, contextLineCount).map(
    (line, lineIndex) => ({
      ...line,
      id: `${fileIndex}:${lineIndex}:${line.kind}:${line.oldLine ?? ''}:${
        line.newLine ?? ''
      }`,
    }),
  );

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
      .map((line, index) =>
        line.kind === 'add' || line.kind === 'remove' ? index : -1,
      )
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
  return ranges.reduce<Array<{ start: number; end: number }>>(
    (merged, range) => {
      const previous = merged[merged.length - 1];

      if (!previous || range.start > previous.end + 1) {
        merged.push({ ...range });
      } else {
        previous.end = Math.max(previous.end, range.end);
      }

      return merged;
    },
    [],
  );
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
