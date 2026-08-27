import { stat, readFile } from "node:fs/promises";
import type {
  CodeRangeRequestContract,
  CodeRangeResponseContract,
} from "../../contracts/apiSchemas.js";
import { expandHomePath, InvalidPathError } from "../paths/pathValidation.js";

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

export class CodeQueryService {
  async getCodeRange(request: CodeRangeRequest): Promise<CodeRangeResult> {
    const filePath = expandHomePath(request.filePath.trim());

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

    const content = await readFile(filePath, "utf8");
    const allLines = content.split(/\r?\n/);
    const startLine = request.startLine ?? 1;
    const endLine = request.endLine ?? allLines.length;
    const selectedLines = allLines.slice(startLine - 1, endLine).map((line, index) => ({
      lineNumber: startLine + index,
      content: line,
    }));

    return {
      filePath,
      startLine,
      endLine,
      code: selectedLines.map((line) => line.content).join("\n"),
      lines: selectedLines,
    };
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
