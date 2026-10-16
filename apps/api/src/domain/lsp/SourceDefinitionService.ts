import { stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  SourceDefinitionRequestContract,
  SourceDefinitionResponseContract,
} from "../../contracts/apiSchemas.js";
import { RustAnalyzerProvider } from "../../infrastructure/lsp/RustAnalyzerProvider.js";
import { expandHomePath, InvalidPathError } from "../paths/pathValidation.js";

export type SourceDefinitionRequest = SourceDefinitionRequestContract;
export type SourceDefinitionResult = SourceDefinitionResponseContract;

export class UnsupportedLanguageServerError extends Error {
  constructor(language: string) {
    super(`Unsupported language server: ${language}`);
    this.name = "UnsupportedLanguageServerError";
  }
}

export class SourceDefinitionService {
  constructor(private readonly rustAnalyzer = new RustAnalyzerProvider()) {}

  async findDefinition(request: SourceDefinitionRequest): Promise<SourceDefinitionResult> {
    const workspace = await assertExistingDirectory(request.workspace);
    const filePath = normalizeSourceFilePath(workspace, request.filePath);
    const language = request.language ?? inferLanguage(filePath);

    if (language !== "rust") {
      throw new UnsupportedLanguageServerError(language);
    }

    const location = await this.rustAnalyzer.definition({
      workspace,
      filePath,
      line: request.line,
      character: request.character,
    });

    if (!location) {
      return {
        found: false,
        language,
      };
    }

    return {
      found: true,
      language,
      target: {
        filePath: fileURLToPath(location.uri),
        startLine: location.range.start.line + 1,
        startCharacter: location.range.start.character,
        endLine: location.range.end.line + 1,
        endCharacter: location.range.end.character,
      },
    };
  }

  close(): void {
    this.rustAnalyzer.close();
  }
}

async function assertExistingDirectory(inputPath: string): Promise<string> {
  const directory = normalizeAbsolutePath(inputPath);

  if (!directory) {
    throw new InvalidPathError(inputPath, "Path must not be empty.");
  }

  let pathStat;

  try {
    pathStat = await stat(directory);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new InvalidPathError(directory, "Path does not exist.");
    }

    throw error;
  }

  if (!pathStat.isDirectory()) {
    throw new InvalidPathError(directory, "Path is not a directory.");
  }

  return directory;
}

function normalizeSourceFilePath(workspace: string, inputPath: string): string {
  const trimmedPath = inputPath.trim();

  if (!trimmedPath) {
    throw new InvalidPathError(inputPath, "Path must not be empty.");
  }

  if (trimmedPath.startsWith("file://")) {
    try {
      return fileURLToPath(trimmedPath);
    } catch {
      throw new InvalidPathError(inputPath, "Invalid file URL.");
    }
  }

  if (isAbsolute(trimmedPath) || trimmedPath.startsWith("~")) {
    return expandHomePath(trimmedPath);
  }

  return resolve(workspace, trimmedPath);
}

function normalizeAbsolutePath(inputPath: string): string {
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

function inferLanguage(filePath: string): "rust" | string {
  if (filePath.endsWith(".rs")) {
    return "rust";
  }

  return "unknown";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
