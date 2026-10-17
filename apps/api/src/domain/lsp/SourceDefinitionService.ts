import { readFile, stat } from "node:fs/promises";
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

    const rustPosition =
      language === "rust"
        ? await readRustDefinitionPosition(filePath, request.line, request.character)
        : { character: request.character };
    const location = await this.rustAnalyzer.definition({
      workspace,
      filePath,
      line: request.line,
      character: rustPosition.character,
    });

    if (!location) {
      if (language === "rust" && rustPosition.declaration) {
        return {
          found: true,
          language,
          target: {
            filePath,
            startLine: request.line,
            startCharacter: rustPosition.declaration.startCharacter,
            endLine: request.line,
            endCharacter: rustPosition.declaration.endCharacter,
          },
        };
      }

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

type RustDefinitionPosition = {
  character: number;
  declaration?: {
    startCharacter: number;
    endCharacter: number;
  };
};

type RustIdentifierToken = {
  startCharacter: number;
  endCharacter: number;
};

async function readRustDefinitionPosition(
  filePath: string,
  line: number,
  character: number,
): Promise<RustDefinitionPosition> {
  const content = await readFile(filePath, "utf8");
  const lines = content.split("\n");
  const lineIndex = line - 1;
  const lineText = lines[lineIndex];

  if (lineText === undefined) {
    return { character };
  }

  const token = readRustIdentifierToken(lineText, character);

  if (!token) {
    return { character };
  }

  return {
    character: Math.max(token.startCharacter, Math.min(character, token.endCharacter - 1)),
    ...(isRustFieldDeclarationToken(lines, lineIndex, token) ? { declaration: token } : {}),
  };
}

function readRustIdentifierToken(
  lineText: string,
  character: number,
): RustIdentifierToken | undefined {
  const clamped = Math.max(0, Math.min(character, lineText.length));

  if (isRustIdentifierCharacter(lineText[clamped])) {
    return expandRustIdentifierToken(lineText, clamped);
  }

  if (lineText[clamped] === ".") {
    const rightToken = readRustRightIdentifierToken(lineText, clamped + 1);

    if (rightToken) {
      return rightToken;
    }
  }

  if (clamped > 0 && isRustIdentifierCharacter(lineText[clamped - 1])) {
    return expandRustIdentifierToken(lineText, clamped - 1);
  }

  let left = clamped - 1;

  while (left >= 0 && /\s/.test(lineText[left] ?? "")) {
    left -= 1;
  }
  if (isRustSoftSeparator(lineText[left])) {
    left -= 1;
    while (left >= 0 && /\s/.test(lineText[left] ?? "")) {
      left -= 1;
    }
    if (isRustIdentifierCharacter(lineText[left])) {
      return expandRustIdentifierToken(lineText, left);
    }
  }

  let right = clamped;

  while (right < lineText.length && /\s/.test(lineText[right] ?? "")) {
    right += 1;
  }
  if (isRustIdentifierCharacter(lineText[right])) {
    return expandRustIdentifierToken(lineText, right);
  }

  return undefined;
}

function readRustRightIdentifierToken(
  lineText: string,
  character: number,
): RustIdentifierToken | undefined {
  let right = character;

  while (right < lineText.length && /\s/.test(lineText[right] ?? "")) {
    right += 1;
  }

  return isRustIdentifierCharacter(lineText[right])
    ? expandRustIdentifierToken(lineText, right)
    : undefined;
}

function expandRustIdentifierToken(lineText: string, character: number): RustIdentifierToken {
  let startCharacter = character;
  let endCharacter = character + 1;

  while (startCharacter > 0 && isRustIdentifierCharacter(lineText[startCharacter - 1])) {
    startCharacter -= 1;
  }

  while (endCharacter < lineText.length && isRustIdentifierCharacter(lineText[endCharacter])) {
    endCharacter += 1;
  }

  return { startCharacter, endCharacter };
}

function isRustFieldDeclarationToken(
  lines: string[],
  lineIndex: number,
  token: RustIdentifierToken,
): boolean {
  const lineText = lines[lineIndex] ?? "";
  let index = token.endCharacter;

  while (index < lineText.length && /\s/.test(lineText[index] ?? "")) {
    index += 1;
  }

  if (lineText[index] !== ":") {
    return false;
  }

  const enclosingBraceLine = findNearestRustEnclosingBraceLine(lines, lineIndex);

  return enclosingBraceLine !== undefined && /\b(?:struct|union)\b/.test(enclosingBraceLine);
}

function findNearestRustEnclosingBraceLine(lines: string[], lineIndex: number): string | undefined {
  let nestedCloseBraces = 0;

  for (let index = lineIndex - 1; index >= 0; index -= 1) {
    const lineText = lines[index] ?? "";

    for (let characterIndex = lineText.length - 1; characterIndex >= 0; characterIndex -= 1) {
      const character = lineText[characterIndex];

      if (character === "}") {
        nestedCloseBraces += 1;
        continue;
      }

      if (character !== "{") {
        continue;
      }

      if (nestedCloseBraces === 0) {
        return lineText;
      }

      nestedCloseBraces -= 1;
    }
  }

  return undefined;
}

function isRustIdentifierCharacter(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9_]/.test(character);
}

function isRustSoftSeparator(character: string | undefined): boolean {
  return character !== undefined && /[:.,;()[\]{}]/.test(character);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
