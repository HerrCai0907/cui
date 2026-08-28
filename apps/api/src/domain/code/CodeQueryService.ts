import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import type {
  CodeRangeRequestContract,
  CodeRangeResponseContract,
} from "../../contracts/apiSchemas.js";
import { expandHomePath, InvalidPathError } from "../paths/pathValidation.js";

const MAX_PREVIEW_FILE_BYTES = 5 * 1024 * 1024;
const DEFAULT_PREVIEW_LINE_COUNT = 200;
const MAX_PREVIEW_LINE_COUNT = 500;
const MAX_PREVIEW_LINE_CHARS = 4000;

export type CodeLine = {
  lineNumber: number;
  content: string;
};

export type CodeRangeRequest = CodeRangeRequestContract;
export type CodeRangeResult = CodeRangeResponseContract;

export class CodeFileNotFoundError extends Error {
  constructor(filePath: string) {
    super(`Code file not found: ${filePath}`);
    this.name = "CodeFileNotFoundError";
  }
}

export class CodePathNotFileError extends Error {
  constructor(filePath: string) {
    super(`Code path is not a file: ${filePath}`);
    this.name = "CodePathNotFileError";
  }
}

export class CodeFileTooLargeError extends Error {
  constructor(
    filePath: string,
    readonly maxBytes: number,
  ) {
    super(`Code file is too large to preview: ${filePath}`);
    this.name = "CodeFileTooLargeError";
  }
}

export class CodeRangeTooLargeError extends Error {
  constructor(readonly maxLines: number) {
    super(`Code preview range must not exceed ${maxLines} lines`);
    this.name = "CodeRangeTooLargeError";
  }
}

export class CodeQueryService {
  async getCodeRange(request: CodeRangeRequest): Promise<CodeRangeResult> {
    const filePath = normalizeCodeFilePath(request.filePath);

    if (!filePath) {
      throw new InvalidPathError(request.filePath, "Path must not be empty.");
    }

    let fileStat;

    try {
      fileStat = await stat(filePath);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        throw new CodeFileNotFoundError(filePath);
      }

      throw error;
    }

    if (!fileStat.isFile()) {
      throw new CodePathNotFileError(filePath);
    }

    if (fileStat.size > MAX_PREVIEW_FILE_BYTES) {
      throw new CodeFileTooLargeError(filePath, MAX_PREVIEW_FILE_BYTES);
    }

    const startLine = request.startLine ?? 1;
    const requestedEndLine = request.endLine ?? startLine + DEFAULT_PREVIEW_LINE_COUNT - 1;
    const endLine = Math.min(requestedEndLine, startLine + MAX_PREVIEW_LINE_COUNT - 1);

    if (requestedEndLine - startLine + 1 > MAX_PREVIEW_LINE_COUNT) {
      throw new CodeRangeTooLargeError(MAX_PREVIEW_LINE_COUNT);
    }

    const selectedLines = await readCodeLines(filePath, startLine, endLine);
    await appendTrailingEmptyLineIfNeeded(filePath, selectedLines, endLine);
    const responseEndLine = selectedLines.at(-1)?.lineNumber ?? startLine;

    return {
      filePath,
      startLine,
      endLine: responseEndLine,
      code: selectedLines.map((line) => line.content).join("\n"),
      lines: selectedLines,
    };
  }
}

async function readCodeLines(
  filePath: string,
  startLine: number,
  endLine: number,
): Promise<CodeLine[]> {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const reader = createInterface({
    crlfDelay: Infinity,
    input: stream,
  });
  const selectedLines: CodeLine[] = [];
  let lineNumber = 0;

  try {
    for await (const line of reader) {
      lineNumber += 1;

      if (lineNumber < startLine) {
        continue;
      }

      selectedLines.push({
        lineNumber,
        content: truncateLine(line),
      });

      if (lineNumber >= endLine) {
        break;
      }
    }
  } finally {
    reader.close();
    stream.destroy();
  }

  return selectedLines;
}

async function appendTrailingEmptyLineIfNeeded(
  filePath: string,
  selectedLines: CodeLine[],
  endLine: number,
) {
  const lastLine = selectedLines.at(-1);

  if (!lastLine || lastLine.lineNumber >= endLine || !(await fileEndsWithLineBreak(filePath))) {
    return;
  }

  selectedLines.push({
    lineNumber: lastLine.lineNumber + 1,
    content: "",
  });
}

async function fileEndsWithLineBreak(filePath: string): Promise<boolean> {
  const file = await open(filePath, "r");

  try {
    const { size } = await file.stat();

    if (size === 0) {
      return false;
    }

    const buffer = Buffer.alloc(1);
    await file.read(buffer, 0, 1, size - 1);

    return buffer[0] === 10 || buffer[0] === 13;
  } finally {
    await file.close();
  }
}

function truncateLine(line: string): string {
  if (line.length <= MAX_PREVIEW_LINE_CHARS) {
    return line;
  }

  return `${line.slice(0, MAX_PREVIEW_LINE_CHARS)}...`;
}

function normalizeCodeFilePath(inputPath: string): string {
  const trimmedPath = inputPath.trim();

  if (trimmedPath.startsWith("file://")) {
    try {
      return fileURLToPath(trimmedPath);
    } catch {
      throw new InvalidPathError(inputPath, "Invalid file URL.");
    }
  }

  return expandHomePath(trimmedPath);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
