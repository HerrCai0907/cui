import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type {
  AtomicDiffReview,
  AtomicDiffReviewItem,
  DiffFilePage,
  DiffFileSummary,
  DiffLine,
  DiffSummary,
  RoundDiffSummary,
} from "../../types.js";

const ARTIFACT_VERSION = 1;
const DEFAULT_CONTEXT_LINES = 3;
const DEFAULT_PAGE_LIMIT = 400;
const MAX_PAGE_LIMIT = 1000;
const LARGE_FILE_BYTE_THRESHOLD = 512 * 1024;
const LARGE_FILE_LINE_THRESHOLD = 3000;

type ParsedDiffFile = {
  summary: DiffFileSummary;
  block: string;
  hunks: ParsedHunk[];
};

type ParsedHunk = {
  lines: ParsedHunkLine[];
};

type ParsedHunkLine = Omit<DiffLine, "id" | "canExpandUp" | "canExpandDown" | "gapKey">;

type StoredDiffIndex = DiffSummary;

export type DiffPageOptions = {
  context?: number;
  cursor?: string;
  limit?: number;
};

export class DiffArtifactService {
  private readonly rootPath: string;

  constructor(rootPath = process.env.CUI_ARTIFACTS_PATH ?? "data/session-artifacts") {
    this.rootPath = resolve(process.cwd(), rootPath);
  }

  async persistRoundDiff(input: {
    sessionId: string;
    round: number;
    diff: string;
  }): Promise<RoundDiffSummary> {
    const index = await this.writeDiffArtifact(this.getRoundDiffDirectory(input), input.diff);

    return {
      ...index,
      round: input.round,
    };
  }

  async getRoundDiffSummary(input: {
    sessionId: string;
    round: number;
    diff?: string;
  }): Promise<RoundDiffSummary | undefined> {
    const directory = this.getRoundDiffDirectory(input);
    const index = await this.readDiffIndex(directory);

    if (index) {
      return {
        ...index,
        round: input.round,
      };
    }

    if (input.diff === undefined) {
      return undefined;
    }

    return this.persistRoundDiff({
      sessionId: input.sessionId,
      round: input.round,
      diff: input.diff,
    });
  }

  async getRoundDiffFilePage(input: {
    sessionId: string;
    round: number;
    fileId: string;
    diff?: string;
    options?: DiffPageOptions;
  }): Promise<DiffFilePage | undefined> {
    const directory = this.getRoundDiffDirectory(input);

    return this.getDiffFilePage({
      directory,
      fileId: input.fileId,
      diff: input.diff,
      options: input.options,
    });
  }

  async persistAtomicReview(input: {
    sessionId: string;
    round: number;
    review: AtomicDiffReview;
  }): Promise<AtomicDiffReview> {
    if (input.review.status !== "ready") {
      return input.review;
    }

    const items = await Promise.all(
      input.review.items.map((item) =>
        this.persistAtomicReviewItem({
          sessionId: input.sessionId,
          round: input.round,
          item,
        }),
      ),
    );

    return {
      ...input.review,
      items,
    };
  }

  async createAtomicReviewView(input: {
    sessionId: string;
    round: number;
    review: AtomicDiffReview | undefined;
  }): Promise<AtomicDiffReview | undefined> {
    if (input.review?.status !== "ready") {
      return input.review;
    }

    return {
      ...input.review,
      items: await Promise.all(
        input.review.items.map((item) =>
          this.createAtomicReviewItemView({
            sessionId: input.sessionId,
            round: input.round,
            item,
          }),
        ),
      ),
    };
  }

  async getAtomicReviewItemDiffFilePage(input: {
    sessionId: string;
    round: number;
    itemId: string;
    fileId: string;
    itemDiff?: string;
    options?: DiffPageOptions;
  }): Promise<DiffFilePage | undefined> {
    const directory = this.getAtomicItemDiffDirectory(input);

    return this.getDiffFilePage({
      directory,
      fileId: input.fileId,
      diff: input.itemDiff,
      options: input.options,
    });
  }

  private async persistAtomicReviewItem(input: {
    sessionId: string;
    round: number;
    item: AtomicDiffReviewItem;
  }): Promise<AtomicDiffReviewItem> {
    const diffSummary = input.item.diff
      ? await this.writeDiffArtifact(this.getAtomicItemDiffDirectory(input), input.item.diff)
      : input.item.diffSummary;
    const { diff: _diff, ...itemWithoutDiff } = input.item;

    return {
      ...itemWithoutDiff,
      ...(diffSummary ? { diffSummary } : {}),
      diffRef: {
        itemId: input.item.id,
      },
    };
  }

  private async createAtomicReviewItemView(input: {
    sessionId: string;
    round: number;
    item: AtomicDiffReviewItem;
  }): Promise<AtomicDiffReviewItem> {
    const diffSummary =
      input.item.diffSummary ??
      (await this.readDiffIndex(this.getAtomicItemDiffDirectory(input))) ??
      (input.item.diff
        ? await this.writeDiffArtifact(this.getAtomicItemDiffDirectory(input), input.item.diff)
        : undefined);
    const { diff: _diff, ...itemWithoutDiff } = input.item;

    return {
      ...itemWithoutDiff,
      ...(diffSummary ? { diffSummary } : {}),
      diffRef: {
        itemId: input.item.id,
      },
    };
  }

  private async getDiffFilePage(input: {
    directory: string;
    fileId: string;
    diff?: string;
    options?: DiffPageOptions;
  }): Promise<DiffFilePage | undefined> {
    const index =
      (await this.readDiffIndex(input.directory)) ??
      (input.diff ? await this.writeDiffArtifact(input.directory, input.diff) : undefined);

    if (!index) {
      return undefined;
    }

    const fileSummary = index.files.find((file) => file.id === input.fileId);

    if (!fileSummary) {
      return undefined;
    }

    const fileDiff = await readTextFile(this.getDiffFilePath(input.directory, input.fileId));
    const parsedFile = parseUnifiedDiff(fileDiff).files[0];

    if (!parsedFile) {
      return {
        file: fileSummary,
        lines: [],
        pageInfo: createEmptyPageInfo(input.options),
      };
    }

    return createDiffFilePage(parsedFile, input.options);
  }

  private async writeDiffArtifact(directory: string, diff: string): Promise<StoredDiffIndex> {
    const parsed = parseUnifiedDiff(diff);

    await mkdir(join(directory, "files"), { recursive: true });
    await Promise.all([
      writeFile(join(directory, "full.patch"), diff, "utf8"),
      writeFile(join(directory, "index.json"), JSON.stringify(parsed.summary, null, 2), "utf8"),
      ...parsed.files.map((file) =>
        writeFile(this.getDiffFilePath(directory, file.summary.id), file.block, "utf8"),
      ),
    ]);

    return parsed.summary;
  }

  private async readDiffIndex(directory: string): Promise<StoredDiffIndex | undefined> {
    try {
      const raw = await readTextFile(join(directory, "index.json"));
      const parsed = JSON.parse(raw) as StoredDiffIndex;

      return parsed.version === ARTIFACT_VERSION ? parsed : undefined;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return undefined;
      }

      throw error;
    }
  }

  private getRoundDiffDirectory(input: { sessionId: string; round: number }): string {
    return join(
      this.rootPath,
      encodeURIComponent(input.sessionId),
      "rounds",
      String(input.round),
      "diff",
    );
  }

  private getAtomicItemDiffDirectory(input: {
    sessionId: string;
    round: number;
    item: Pick<AtomicDiffReviewItem, "id">;
  }): string;
  private getAtomicItemDiffDirectory(input: {
    sessionId: string;
    round: number;
    itemId: string;
  }): string;
  private getAtomicItemDiffDirectory(input: {
    sessionId: string;
    round: number;
    item?: Pick<AtomicDiffReviewItem, "id">;
    itemId?: string;
  }): string {
    return join(
      this.rootPath,
      encodeURIComponent(input.sessionId),
      "rounds",
      String(input.round),
      "atomic",
      "items",
      encodeURIComponent(input.item?.id ?? input.itemId ?? ""),
      "diff",
    );
  }

  private getDiffFilePath(directory: string, fileId: string): string {
    return join(directory, "files", `${encodeURIComponent(fileId)}.patch`);
  }
}

function parseUnifiedDiff(diff: string): {
  summary: DiffSummary;
  files: ParsedDiffFile[];
} {
  const files = splitFileBlocks(diff).map(parseFileBlock);
  const summary: DiffSummary = {
    version: ARTIFACT_VERSION,
    totalFiles: files.length,
    totalAdditions: sum(files.map((file) => file.summary.additions)),
    totalDeletions: sum(files.map((file) => file.summary.deletions)),
    totalLines: sum(files.map((file) => file.summary.lineCount)),
    totalBytes: Buffer.byteLength(diff, "utf8"),
    files: files.map((file) => file.summary),
  };

  return { summary, files };
}

function splitFileBlocks(diff: string): string[] {
  const blocks: string[] = [];
  let currentLines: string[] = [];

  for (const line of diff.replace(/\r\n?/g, "\n").split("\n")) {
    if (line.startsWith("diff --git ")) {
      if (currentLines.length > 0) {
        blocks.push(currentLines.join("\n").trimEnd());
      }

      currentLines = [line];
      continue;
    }

    if (currentLines.length > 0) {
      currentLines.push(line);
    } else if (line.trim()) {
      currentLines = ["Diff", line];
    }
  }

  if (currentLines.length > 0) {
    blocks.push(currentLines.join("\n").trimEnd());
  }

  return blocks.filter(Boolean);
}

function parseFileBlock(block: string, fileIndex: number): ParsedDiffFile {
  const lines = block.split("\n");
  const header = lines[0] ?? "";
  const metadata: string[] = [];
  const hunks: ParsedHunk[] = [];
  let additions = 0;
  let deletions = 0;
  let index = 1;

  while (index < lines.length) {
    const line = lines[index] ?? "";

    if (!line.startsWith("@@ ")) {
      if (line.trim()) {
        metadata.push(line);
      }
      index += 1;
      continue;
    }

    const parsedHunk = parseHunk(lines, index);
    hunks.push(parsedHunk.hunk);
    additions += parsedHunk.additions;
    deletions += parsedHunk.deletions;
    index = parsedHunk.nextIndex;
  }

  const path = getFilePath(header, metadata);
  const byteSize = Buffer.byteLength(block, "utf8");
  const lineCount = sum(hunks.map((hunk) => hunk.lines.length));
  const isBinary = metadata.some((line) => line.startsWith("Binary files "));
  const summary: DiffFileSummary = {
    id: `${fileIndex}:${path}`,
    path,
    ...(getOldFilePath(metadata, path) ? { oldPath: getOldFilePath(metadata, path) } : {}),
    status: getFileStatus(metadata, isBinary),
    additions,
    deletions,
    hunkCount: hunks.length,
    lineCount,
    byteSize,
    isLarge: byteSize > LARGE_FILE_BYTE_THRESHOLD || lineCount > LARGE_FILE_LINE_THRESHOLD,
    isBinary,
    metadata: [header, ...metadata],
  };

  return {
    summary,
    block,
    hunks,
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
  const hunkHeader = lines[hunkStartIndex] ?? "";
  const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(hunkHeader);
  let oldLine = match ? Number(match[1]) : undefined;
  let newLine = match ? Number(match[2]) : undefined;
  const hunkLines: ParsedHunkLine[] = [
    {
      kind: "meta",
      content: hunkHeader,
    },
  ];
  let additions = 0;
  let deletions = 0;
  let index = hunkStartIndex + 1;

  while (index < lines.length && !lines[index].startsWith("@@ ")) {
    const rawLine = lines[index] ?? "";

    if (rawLine.startsWith("+")) {
      hunkLines.push({
        kind: "add",
        newLine,
        content: rawLine.slice(1),
      });
      newLine = incrementLine(newLine);
      additions += 1;
    } else if (rawLine.startsWith("-")) {
      hunkLines.push({
        kind: "remove",
        oldLine,
        content: rawLine.slice(1),
      });
      oldLine = incrementLine(oldLine);
      deletions += 1;
    } else if (rawLine.startsWith(" ")) {
      hunkLines.push({
        kind: "context",
        oldLine,
        newLine,
        content: rawLine.slice(1),
      });
      oldLine = incrementLine(oldLine);
      newLine = incrementLine(newLine);
    } else if (rawLine.startsWith("\\")) {
      hunkLines.push({
        kind: "meta",
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

function createDiffFilePage(file: ParsedDiffFile, options: DiffPageOptions = {}): DiffFilePage {
  const contextLines = normalizeContext(options.context);
  const limit = normalizeLimit(options.limit);
  const cursor = normalizeCursor(options.cursor);
  const visibleLines = clipHunks(file.hunks, contextLines).map((line, lineIndex) => ({
    ...line,
    id: `${file.summary.id}:${lineIndex}:${line.kind}:${line.oldLine ?? ""}:${line.newLine ?? ""}`,
  }));
  const lines = visibleLines.slice(cursor, cursor + limit);
  const nextCursor =
    cursor + lines.length < visibleLines.length ? String(cursor + lines.length) : undefined;

  return {
    file: file.summary,
    lines,
    pageInfo: {
      ...(cursor > 0 ? { cursor: String(cursor) } : {}),
      ...(nextCursor ? { nextCursor } : {}),
      returned: lines.length,
      totalVisible: visibleLines.length,
      hasMoreBefore: cursor > 0,
      hasMoreAfter: Boolean(nextCursor),
      hasExpandableContext: visibleLines.some((line) => line.kind === "ellipsis"),
      contextLines,
      truncated: Boolean(nextCursor) || cursor > 0,
    },
  };
}

function clipHunks(hunks: ParsedHunk[], contextLineCount: number): DiffLine[] {
  const lines: DiffLine[] = [];

  hunks.forEach((hunk, hunkIndex) => {
    const changedIndexes = hunk.lines
      .map((line, index) => (line.kind === "add" || line.kind === "remove" ? index : -1))
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

    if (lines.length > 0 && hunkIndex > 0) {
      lines.push(createGapLine(lines.length, { canExpandDown: false, canExpandUp: false }));
    }

    let nextLineIndex = 0;

    ranges.forEach((range, rangeIndex) => {
      appendGap(lines, hunk.lines.slice(nextLineIndex, range.start), {
        canExpandDown: rangeIndex > 0,
        canExpandUp: true,
      });

      lines.push(...hunk.lines.slice(range.start, range.end + 1).map(toDiffLineWithoutId));
      nextLineIndex = range.end + 1;
    });

    appendGap(lines, hunk.lines.slice(nextLineIndex), {
      canExpandDown: true,
      canExpandUp: false,
    });
  });

  return lines;
}

function appendGap(
  lines: DiffLine[],
  hiddenLines: ParsedHunkLine[],
  options: {
    canExpandUp: boolean;
    canExpandDown: boolean;
  },
) {
  if (hiddenLines.length === 0) {
    return;
  }

  lines.push(createGapLine(lines.length, options));
}

function createGapLine(
  index: number,
  options: {
    canExpandUp: boolean;
    canExpandDown: boolean;
  },
): DiffLine {
  return {
    id: `gap:${index}`,
    kind: "ellipsis",
    content: "...",
    gapKey: `gap:${index}`,
    canExpandDown: options.canExpandDown,
    canExpandUp: options.canExpandUp,
  };
}

function toDiffLineWithoutId(line: ParsedHunkLine): DiffLine {
  return {
    id: "",
    kind: line.kind,
    ...(line.oldLine !== undefined ? { oldLine: line.oldLine } : {}),
    ...(line.newLine !== undefined ? { newLine: line.newLine } : {}),
    content: line.content,
  };
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

function createEmptyPageInfo(options: DiffPageOptions = {}): DiffFilePage["pageInfo"] {
  return {
    returned: 0,
    totalVisible: 0,
    hasMoreBefore: false,
    hasMoreAfter: false,
    hasExpandableContext: false,
    contextLines: normalizeContext(options.context),
    truncated: false,
  };
}

function getFilePath(header: string, metadata: string[]): string {
  const newPath = metadata.find((line) => line.startsWith("+++ "))?.slice(4);
  const oldPath = metadata.find((line) => line.startsWith("--- "))?.slice(4);
  const path = cleanDiffPath(newPath) ?? cleanDiffPath(oldPath);

  if (path) {
    return path;
  }

  const match = /^diff --git a\/(.+) b\/(.+)$/.exec(header);

  return match?.[2] ?? header;
}

function getOldFilePath(metadata: string[], path: string): string | undefined {
  const oldPath = cleanDiffPath(metadata.find((line) => line.startsWith("--- "))?.slice(4));

  return oldPath && oldPath !== path ? oldPath : undefined;
}

function cleanDiffPath(path: string | undefined): string | undefined {
  if (!path || path === "/dev/null") {
    return undefined;
  }

  return path.replace(/^[ab]\//, "");
}

function getFileStatus(metadata: string[], isBinary: boolean): DiffFileSummary["status"] {
  if (isBinary) {
    return "binary";
  }

  if (metadata.some((line) => line.startsWith("new file mode "))) {
    return "added";
  }

  if (metadata.some((line) => line.startsWith("deleted file mode "))) {
    return "deleted";
  }

  if (metadata.some((line) => line.startsWith("rename from ") || line.startsWith("rename to "))) {
    return "renamed";
  }

  return "modified";
}

function normalizeContext(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_CONTEXT_LINES;
  }

  return Math.max(0, Math.min(200, Math.trunc(value)));
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_PAGE_LIMIT;
  }

  return Math.max(1, Math.min(MAX_PAGE_LIMIT, Math.trunc(value)));
}

function normalizeCursor(value: string | undefined): number {
  const cursor = Number(value);

  return Number.isInteger(cursor) && cursor > 0 ? cursor : 0;
}

function incrementLine(line: number | undefined): number | undefined {
  return line === undefined ? undefined : line + 1;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

async function readTextFile(path: string): Promise<string> {
  return readFile(path, "utf8");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
