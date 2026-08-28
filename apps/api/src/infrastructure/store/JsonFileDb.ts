import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";

type JsonFileEntry = {
  hasCache: boolean;
  cachedData: unknown;
  queue: Promise<void>;
};

export class JsonFileDb {
  private readonly entries = new Map<string, JsonFileEntry>();

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
      entry.cachedData = data;
      entry.hasCache = true;

      return cloneJsonData(data) as T;
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
    const storedData = JSON.parse(content) as unknown;
    const result = entry.queue.then(async () => {
      await writeJsonFileAtomically(resolve(filePath), content);
      entry.cachedData = storedData;
      entry.hasCache = true;
    });

    entry.queue = result.then(
      () => undefined,
      () => undefined,
    );

    return result;
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
