import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";

type JsonFileEntry = {
  hasCache: boolean;
  cachedData: unknown;
  queue: Promise<void>;
};

const DEFAULT_MAX_CACHED_CONTENT_BYTES = 1024 * 1024;

export class JsonFileDb {
  private readonly entries = new Map<string, JsonFileEntry>();

  constructor(private readonly maxCachedContentBytes = DEFAULT_MAX_CACHED_CONTENT_BYTES) {}

  async read<T>(filePath: string): Promise<T> {
    const entry = this.getEntry(filePath);

    if (entry.hasCache) {
      return cloneJsonData(entry.cachedData) as T;
    }

    const result = entry.queue.then(async () => {
      if (entry.hasCache) {
        return cloneJsonData(entry.cachedData) as T;
      }

      const raw = await readFile(resolve(filePath), "utf8");
      const data = JSON.parse(raw) as unknown;

      if (this.shouldCache(raw)) {
        entry.cachedData = data;
        entry.hasCache = true;

        return cloneJsonData(data) as T;
      }

      entry.cachedData = undefined;
      entry.hasCache = false;

      return data as T;
    });

    entry.queue = result.then(
      () => undefined,
      () => undefined,
    );

    return result;
  }

  async write(filePath: string, data: unknown): Promise<void> {
    const entry = this.getEntry(filePath);
    const content = stringifyJsonData(data);
    const shouldCache = this.shouldCache(content);
    const storedData = shouldCache ? (JSON.parse(content) as unknown) : undefined;
    const result = entry.queue.then(async () => {
      await writeJsonFileAtomically(resolve(filePath), content);
      entry.cachedData = storedData;
      entry.hasCache = shouldCache;
    });

    entry.queue = result.then(
      () => undefined,
      () => undefined,
    );

    return result;
  }

  clearCache(filePath?: string): void {
    if (filePath) {
      const entry = this.entries.get(resolve(filePath));

      if (entry) {
        entry.cachedData = undefined;
        entry.hasCache = false;
      }
      return;
    }

    for (const entry of this.entries.values()) {
      entry.cachedData = undefined;
      entry.hasCache = false;
    }
  }

  private getEntry(filePath: string): JsonFileEntry {
    const resolvedPath = resolve(filePath);
    const existing = this.entries.get(resolvedPath);

    if (existing) {
      return existing;
    }

    const entry: JsonFileEntry = {
      hasCache: false,
      cachedData: undefined,
      queue: Promise.resolve(),
    };
    this.entries.set(resolvedPath, entry);

    return entry;
  }

  private shouldCache(content: string): boolean {
    return Buffer.byteLength(content, "utf8") <= this.maxCachedContentBytes;
  }
}

export const defaultJsonFileDb = new JsonFileDb();

async function writeJsonFileAtomically(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });

  const temporaryPath = join(dirname(filePath), `.${randomUUID()}.tmp`);

  try {
    await writeFile(temporaryPath, `${content}\n`, "utf8");
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

function cloneJsonData<T>(data: T): T {
  return structuredClone(data);
}

function stringifyJsonData(data: unknown): string {
  const content = JSON.stringify(data, null, 2);

  if (content === undefined) {
    throw new TypeError("JSON file data must be serializable");
  }

  return content;
}
