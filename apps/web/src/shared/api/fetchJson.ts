import { resolveApiUrl } from "./apiBaseUrl";

const JSON_CACHE_STORAGE_KEY = "cui:api-json-cache:v1";
const JSON_CACHE_ENTRY_STORAGE_PREFIX = "cui:api-json-cache-entry:v1:";
const RESPONSE_CACHE_NAME = "cui-api-json-v1";
const MAX_CACHED_GET_RESPONSES = 80;

type CachedJsonResponse = {
  etag: string;
  body: unknown;
  storedAt: number;
};

type CachedJsonMetadata = Omit<CachedJsonResponse, "body">;

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const resolvedUrl = resolveApiUrl(url);
  const method = init?.method?.toUpperCase() ?? "GET";
  const cacheKey = method === "GET" ? createCacheKey(resolvedUrl) : undefined;
  const cachedResponse = cacheKey ? await readCachedResponse(cacheKey) : undefined;
  const headers = new Headers(init?.headers);

  if (cachedResponse && !headers.has("If-None-Match")) {
    headers.set("If-None-Match", cachedResponse.etag);
  }

  const response = await fetch(resolvedUrl, {
    ...init,
    headers,
  });

  if (response.status === 304 && cachedResponse) {
    return cachedResponse.body as T;
  }

  if (!response.ok) {
    throw new Error(`Request failed: HTTP ${response.status}`);
  }

  const body = (await response.json()) as T;

  if (cacheKey) {
    const etag = response.headers.get("ETag");

    if (etag) {
      await writeCachedResponse(cacheKey, response, { etag, body, storedAt: Date.now() });
    }
  } else if (isMutationMethod(method)) {
    await clearCachedResponses();
  }

  return body;
}

function createCacheKey(url: string): string {
  const baseUrl = typeof window === "undefined" ? "http://localhost/" : window.location.href;

  return new URL(url, baseUrl).toString();
}

function createStorageEntryKey(cacheKey: string): string {
  return `${JSON_CACHE_ENTRY_STORAGE_PREFIX}${hashString(cacheKey)}`;
}

function isMutationMethod(method: string): boolean {
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}

async function readCachedResponse(cacheKey: string): Promise<CachedJsonResponse | undefined> {
  const cachedFetchResponse = await readCachedFetchResponse(cacheKey);

  if (cachedFetchResponse) {
    return cachedFetchResponse;
  }

  const cache = readCache();
  const cachedResponse = cache[cacheKey];

  if (!cachedResponse?.etag) {
    return undefined;
  }

  const body = readCachedSessionStorageBody(cacheKey);

  return body === undefined ? undefined : { ...cachedResponse, body };
}

async function writeCachedResponse(
  cacheKey: string,
  response: Response,
  cachedResponse: CachedJsonResponse,
) {
  if (await writeCachedFetchResponse(cacheKey, response, cachedResponse)) {
    removeCachedSessionStorageResponse(cacheKey);
    return;
  }

  const cache = readCache();

  if (!writeCachedSessionStorageBody(cacheKey, cachedResponse.body)) {
    return;
  }

  cache[cacheKey] = {
    etag: cachedResponse.etag,
    storedAt: cachedResponse.storedAt,
  };
  trimCache(cache);
  writeCache(cache);
}

async function clearCachedResponses() {
  await clearCachedFetchResponses();

  if (typeof window === "undefined") {
    return;
  }

  try {
    getSessionStorageKeys()
      .filter((key) => key.startsWith(JSON_CACHE_ENTRY_STORAGE_PREFIX))
      .forEach((key) => window.sessionStorage.removeItem(key));
    window.sessionStorage.removeItem(JSON_CACHE_STORAGE_KEY);
  } catch {
    // The cache only reduces repeated transfer size; requests remain correct without it.
  }
}

async function readCachedFetchResponse(cacheKey: string): Promise<CachedJsonResponse | undefined> {
  if (!canUseCacheStorage()) {
    return undefined;
  }

  try {
    const cache = await window.caches.open(RESPONSE_CACHE_NAME);
    const response = await cache.match(cacheKey);
    const etag = response?.headers.get("ETag");

    if (!response || !etag) {
      return undefined;
    }

    return {
      etag,
      body: await response.json(),
      storedAt: Number(response.headers.get("X-CUI-Cached-At")) || 0,
    };
  } catch {
    return undefined;
  }
}

async function writeCachedFetchResponse(
  cacheKey: string,
  response: Response,
  cachedResponse: CachedJsonResponse,
): Promise<boolean> {
  if (!canUseCacheStorage()) {
    return false;
  }

  try {
    const cache = await window.caches.open(RESPONSE_CACHE_NAME);
    const headers = new Headers(response.headers);

    headers.set("X-CUI-Cached-At", String(Date.now()));
    await cache.put(
      cacheKey,
      new Response(JSON.stringify(cachedResponse.body), {
        headers,
        status: response.status,
        statusText: response.statusText,
      }),
    );
    await trimFetchCache(cache);
    return true;
  } catch {
    return false;
  }
}

async function clearCachedFetchResponses() {
  if (!canUseCacheStorage()) {
    return;
  }

  try {
    await window.caches.delete(RESPONSE_CACHE_NAME);
  } catch {
    // Ignore cache eviction failures; a later conditional GET still validates stale entries.
  }
}

async function trimFetchCache(cache: Cache) {
  try {
    const requests = await cache.keys();

    if (requests.length <= MAX_CACHED_GET_RESPONSES) {
      return;
    }

    const responses = await Promise.all(
      requests.map(async (request) => ({
        request,
        response: await cache.match(request),
      })),
    );

    await Promise.all(
      responses
        .sort(
          (left, right) =>
            (Number(left.response?.headers.get("X-CUI-Cached-At")) || 0) -
            (Number(right.response?.headers.get("X-CUI-Cached-At")) || 0),
        )
        .slice(0, responses.length - MAX_CACHED_GET_RESPONSES)
        .map(({ request }) => cache.delete(request)),
    );
  } catch {
    // Cache trimming is best effort.
  }
}

function canUseCacheStorage(): boolean {
  return typeof window !== "undefined" && "caches" in window;
}

function removeCachedSessionStorageResponse(cacheKey: string) {
  const cache = readCache();

  removeCachedSessionStorageBody(cacheKey);

  if (!(cacheKey in cache)) {
    return;
  }

  delete cache[cacheKey];
  writeCache(cache);
}

function readCache(): Record<string, CachedJsonMetadata> {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const rawCache = window.sessionStorage.getItem(JSON_CACHE_STORAGE_KEY);

    if (!rawCache) {
      return {};
    }

    const parsed = JSON.parse(rawCache);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return parsed as Record<string, CachedJsonMetadata>;
  } catch {
    return {};
  }
}

function writeCache(cache: Record<string, CachedJsonMetadata>) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(JSON_CACHE_STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Quota or private-mode storage failures should not block network requests.
  }
}

function trimCache(cache: Record<string, CachedJsonMetadata>) {
  const entries = Object.entries(cache);

  if (entries.length <= MAX_CACHED_GET_RESPONSES) {
    return;
  }

  entries
    .sort(([, left], [, right]) => left.storedAt - right.storedAt)
    .slice(0, entries.length - MAX_CACHED_GET_RESPONSES)
    .forEach(([cacheKey]) => {
      delete cache[cacheKey];
      removeCachedSessionStorageBody(cacheKey);
    });
}

function readCachedSessionStorageBody(cacheKey: string): unknown | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    const rawBody = window.sessionStorage.getItem(createStorageEntryKey(cacheKey));

    return rawBody === null ? undefined : JSON.parse(rawBody);
  } catch {
    return undefined;
  }
}

function writeCachedSessionStorageBody(cacheKey: string, body: unknown): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    window.sessionStorage.setItem(createStorageEntryKey(cacheKey), JSON.stringify(body));
    return true;
  } catch {
    removeCachedSessionStorageBody(cacheKey);
    return false;
  }
}

function removeCachedSessionStorageBody(cacheKey: string) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.removeItem(createStorageEntryKey(cacheKey));
  } catch {
    // Best-effort cleanup only.
  }
}

function getSessionStorageKeys(): string[] {
  if (typeof window === "undefined") {
    return [];
  }

  const keys: string[] = [];

  try {
    for (let index = 0; index < window.sessionStorage.length; index += 1) {
      const key = window.sessionStorage.key(index);

      if (key) {
        keys.push(key);
      }
    }

    return keys;
  } catch {
    return Object.keys(window.sessionStorage);
  }
}

function hashString(value: string): string {
  let firstHash = 0x811c9dc5;
  let secondHash = 0x01000193;

  for (let index = 0; index < value.length; index += 1) {
    const charCode = value.charCodeAt(index);

    firstHash ^= charCode;
    firstHash = Math.imul(firstHash, 0x01000193);
    secondHash ^= charCode;
    secondHash = Math.imul(secondHash, 0x811c9dc5);
  }

  const firstPart = (firstHash >>> 0).toString(36);
  const secondPart = (secondHash >>> 0).toString(36);

  return `${firstPart}${secondPart}`;
}
