import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { JsonRpcLanguageClient, LanguageServerProcessError } from "./JsonRpcLanguageClient.js";

const SKIPPED_DISCOVERY_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "target",
  "dist",
  "build",
  ".idea",
]);
const DEFINITION_RETRY_COUNT = 30;
const DEFINITION_RETRY_DELAY_MS = 500;

export type LspRange = {
  start: {
    line: number;
    character: number;
  };
  end: {
    line: number;
    character: number;
  };
};

export type LspLocation = {
  uri: string;
  range: LspRange;
};

type LspLocationLink = {
  targetUri: string;
  targetRange: LspRange;
};

type CachedRustAnalyzerClient = {
  client: JsonRpcLanguageClient;
  openDocuments: Map<string, number>;
};

export class RustAnalyzerProvider {
  private readonly clients = new Map<string, CachedRustAnalyzerClient>();

  async definition(input: {
    workspace: string;
    filePath: string;
    line: number;
    character: number;
  }): Promise<LspLocation | undefined> {
    const cached = await this.getClient(input.workspace);
    const documentUri = pathToFileURL(input.filePath).toString();

    await this.openDocumentIfNeeded(cached, input.filePath, documentUri);

    for (let attempt = 1; attempt <= DEFINITION_RETRY_COUNT; attempt += 1) {
      try {
        const result = await cached.client.request("textDocument/definition", {
          textDocument: { uri: documentUri },
          position: {
            line: input.line - 1,
            character: input.character,
          },
        });
        const location = firstLocation(result);

        if (location || attempt === DEFINITION_RETRY_COUNT) {
          return location;
        }
      } catch (error) {
        if (!isTransientDefinitionError(error) || attempt === DEFINITION_RETRY_COUNT) {
          throw error;
        }

        await this.reopenDocument(cached, input.filePath, documentUri);
      }

      await delay(DEFINITION_RETRY_DELAY_MS);
    }

    return undefined;
  }

  close(): void {
    for (const cached of this.clients.values()) {
      cached.client.close();
    }

    this.clients.clear();
  }

  private async getClient(workspace: string): Promise<CachedRustAnalyzerClient> {
    const existing = this.clients.get(workspace);

    if (existing) {
      return existing;
    }

    const workspaceFolders = await discoverRustWorkspaceFolders(workspace);
    const initializationOptions = await readRustAnalyzerOptions(workspace, workspaceFolders);
    const client = new JsonRpcLanguageClient({
      command: process.env.RUST_ANALYZER_BINARY ?? "rust-analyzer",
      initializationOptions,
      initializeParams: {
        processId: process.pid,
        rootUri: pathToFileURL(workspace).toString(),
        capabilities: {
          textDocument: {
            definition: {
              dynamicRegistration: false,
              linkSupport: true,
            },
          },
          workspace: {
            configuration: true,
            workspaceFolders: true,
          },
        },
        workspaceFolders: workspaceFolders.map((folder) => ({
          uri: pathToFileURL(folder).toString(),
          name: basename(folder) || folder,
        })),
      },
    });
    const cached = { client, openDocuments: new Map<string, number>() };

    this.clients.set(workspace, cached);
    try {
      await client.initialize();
    } catch (error) {
      this.clients.delete(workspace);
      client.close();
      throw error;
    }

    return cached;
  }

  private async openDocumentIfNeeded(
    cached: CachedRustAnalyzerClient,
    filePath: string,
    documentUri: string,
  ): Promise<void> {
    if (cached.openDocuments.has(documentUri)) {
      return;
    }

    await this.openDocument(cached, filePath, documentUri, 1);
  }

  private async reopenDocument(
    cached: CachedRustAnalyzerClient,
    filePath: string,
    documentUri: string,
  ): Promise<void> {
    const version = cached.openDocuments.get(documentUri);

    if (version !== undefined) {
      await cached.client.notify("textDocument/didClose", {
        textDocument: { uri: documentUri },
      });
      cached.openDocuments.delete(documentUri);
    }

    await this.openDocument(cached, filePath, documentUri, (version ?? 0) + 1);
  }

  private async openDocument(
    cached: CachedRustAnalyzerClient,
    filePath: string,
    documentUri: string,
    version: number,
  ): Promise<void> {
    const text = await readFile(filePath, "utf8");

    await cached.client.notify("textDocument/didOpen", {
      textDocument: {
        uri: documentUri,
        languageId: "rust",
        version,
        text,
      },
    });
    cached.openDocuments.set(documentUri, version);
  }
}

async function discoverRustWorkspaceFolders(workspace: string): Promise<string[]> {
  const folders: string[] = [];

  await walk(workspace, async (directory) => {
    const cargoTomlPath = join(directory, "Cargo.toml");

    try {
      const cargoTomlStat = await stat(cargoTomlPath);

      if (cargoTomlStat.isFile()) {
        folders.push(directory);
      }
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") {
        throw error;
      }
    }
  });

  return folders.length > 0 ? folders : [workspace];
}

async function walk(directory: string, visit: (directory: string) => Promise<void>): Promise<void> {
  await visit(directory);

  let entries;

  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !SKIPPED_DISCOVERY_DIRS.has(entry.name))
      .map((entry) => walk(join(directory, entry.name), visit)),
  );
}

async function readRustAnalyzerOptions(
  workspace: string,
  workspaceFolders: string[],
): Promise<Record<string, unknown>> {
  const settingsFiles = [
    join(workspace, ".vscode", "settings.json"),
    ...workspaceFolders.map((folder) => join(folder, ".vscode", "settings.json")),
  ];
  const merged: Record<string, unknown> = {};
  const seen = new Set<string>();

  for (const settingsFile of settingsFiles) {
    if (seen.has(settingsFile)) {
      continue;
    }

    seen.add(settingsFile);
    const settings = await readJsonSettings(settingsFile);

    if (!settings) {
      continue;
    }

    deepMerge(merged, extractRustAnalyzerSettings(settings));
  }

  return merged;
}

async function readJsonSettings(filePath: string): Promise<Record<string, unknown> | undefined> {
  let content;

  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }

  const parsed = JSON.parse(stripJsonCommentsAndTrailingCommas(content)) as unknown;

  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : undefined;
}

function extractRustAnalyzerSettings(settings: Record<string, unknown>): Record<string, unknown> {
  const extracted: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(settings)) {
    if (key === "rust-analyzer" && value && typeof value === "object" && !Array.isArray(value)) {
      deepMerge(extracted, value as Record<string, unknown>);
      continue;
    }

    if (!key.startsWith("rust-analyzer.")) {
      continue;
    }

    setNestedValue(extracted, key.slice("rust-analyzer.".length).split("."), value);
  }

  return extracted;
}

function setNestedValue(target: Record<string, unknown>, path: string[], value: unknown): void {
  let current = target;

  for (const [index, part] of path.entries()) {
    if (index === path.length - 1) {
      current[part] = value;
      return;
    }

    const next = current[part];

    if (!next || typeof next !== "object" || Array.isArray(next)) {
      current[part] = {};
    }

    current = current[part] as Record<string, unknown>;
  }
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(source)) {
    const existing = target[key];

    if (
      existing &&
      typeof existing === "object" &&
      !Array.isArray(existing) &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      deepMerge(existing as Record<string, unknown>, value as Record<string, unknown>);
      continue;
    }

    target[key] = value;
  }
}

function stripJsonCommentsAndTrailingCommas(content: string): string {
  let output = "";
  let inString = false;
  let quote = "";
  let escaping = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index] ?? "";
    const next = content[index + 1] ?? "";

    if (inString) {
      output += char;

      if (escaping) {
        escaping = false;
      } else if (char === "\\") {
        escaping = true;
      } else if (char === quote) {
        inString = false;
      }

      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      output += char;
      continue;
    }

    if (char === "/" && next === "/") {
      while (index < content.length && content[index] !== "\n") {
        index += 1;
      }

      output += "\n";
      continue;
    }

    if (char === "/" && next === "*") {
      index += 2;

      while (index < content.length && !(content[index] === "*" && content[index + 1] === "/")) {
        index += 1;
      }

      index += 1;
      continue;
    }

    output += char;
  }

  return output.replace(/,\s*([}\]])/g, "$1");
}

function firstLocation(result: unknown): LspLocation | undefined {
  if (!result) {
    return undefined;
  }

  const candidate = Array.isArray(result) ? result[0] : result;

  if (!candidate || typeof candidate !== "object") {
    return undefined;
  }

  const record = candidate as Partial<LspLocation & LspLocationLink>;

  if (record.uri && record.range) {
    return {
      uri: record.uri,
      range: record.range,
    };
  }

  if (record.targetUri && record.targetRange) {
    return {
      uri: record.targetUri,
      range: record.targetRange,
    };
  }

  return undefined;
}

function isTransientDefinitionError(error: unknown): boolean {
  return error instanceof LanguageServerProcessError && /content modified/i.test(error.message);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
