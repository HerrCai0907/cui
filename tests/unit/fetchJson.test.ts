import assert from "node:assert/strict";
import test from "node:test";
import { fetchJson } from "../../apps/web/src/shared/api/fetchJson.js";

type MemoryStorage = {
  getItem: (key: string) => string | null;
  key: (index: number) => string | null;
  readonly length: number;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  keys: () => string[];
};

type CacheStorageStub = {
  open: (name: string) => Promise<CacheStub>;
  delete: (name: string) => Promise<boolean>;
};

type CacheStub = {
  match: (request: RequestInfo | URL) => Promise<Response | undefined>;
  put: (request: RequestInfo | URL, response: Response) => Promise<void>;
  keys: () => Promise<Request[]>;
  delete: (request: RequestInfo | URL) => Promise<boolean>;
};

type FetchCall = {
  url: string;
  init?: RequestInit;
};

function createMemoryStorage(): MemoryStorage {
  const storage = new Map<string, string>();
  const memoryStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    key: (index: number) => [...storage.keys()][index] ?? null,
    get length() {
      return storage.size;
    },
    setItem: (key: string, value: string) => {
      storage.set(key, value);
      Object.defineProperty(memoryStorage, key, {
        configurable: true,
        enumerable: true,
        value,
      });
    },
    removeItem: (key: string) => {
      storage.delete(key);
      delete (memoryStorage as Record<string, unknown>)[key];
    },
    keys: () => [...storage.keys()],
  };

  return memoryStorage;
}

async function withBrowserStubs<T>(
  input: {
    sessionStorage: MemoryStorage;
    caches?: CacheStorageStub;
    fetch: (url: string, init?: RequestInit) => Promise<Response>;
  },
  run: (calls: FetchCall[]) => Promise<T>,
): Promise<T> {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const calls: FetchCall[] = [];

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: { href: "http://localhost:5173/" },
      sessionStorage: input.sessionStorage,
      ...(input.caches ? { caches: input.caches } : {}),
    },
  });
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return input.fetch(url, init);
    },
  });

  try {
    return await run(calls);
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: originalFetch,
    });
  }
}

function createCacheStorageStub(): CacheStorageStub {
  const caches = new Map<string, Map<string, Response>>();

  return {
    open: async (name) => {
      const cache = caches.get(name) ?? new Map<string, Response>();

      caches.set(name, cache);

      return {
        match: async (request) => cache.get(String(request)),
        put: async (request, response) => {
          cache.set(String(request), response);
        },
        keys: async () => [...cache.keys()].map((key) => new Request(key)),
        delete: async (request) => cache.delete(String(request)),
      };
    },
    delete: async (name) => caches.delete(name),
  };
}

test("fetchJson reuses cached GET response when the API returns 304", async () => {
  const storage = createMemoryStorage();
  let requestCount = 0;

  await withBrowserStubs(
    {
      sessionStorage: storage,
      fetch: async () => {
        requestCount += 1;

        if (requestCount === 1) {
          return new Response(JSON.stringify({ value: "fresh" }), {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              ETag: '"first"',
            },
          });
        }

        return new Response(null, { status: 304 });
      },
    },
    async (calls) => {
      assert.deepEqual(await fetchJson("/api/v1/models"), { value: "fresh" });
      assert.deepEqual(await fetchJson("/api/v1/models"), { value: "fresh" });

      const secondHeaders = new Headers(calls[1].init?.headers);

      assert.equal(secondHeaders.get("If-None-Match"), '"first"');
      assert.equal(requestCount, 2);
    },
  );
});

test("fetchJson clears cached GET responses after a successful mutation", async () => {
  const storage = createMemoryStorage();
  let nextValue = "first";

  await withBrowserStubs(
    {
      sessionStorage: storage,
      fetch: async (_url, init) => {
        if (init?.method === "POST") {
          nextValue = "second";
          return new Response(JSON.stringify({ ok: true }), {
            status: 202,
            headers: { "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({ value: nextValue }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            ETag: `"${nextValue}"`,
          },
        });
      },
    },
    async (calls) => {
      assert.deepEqual(await fetchJson("/api/v1/sessions"), { value: "first" });
      assert.deepEqual(await fetchJson("/api/v1/sessions/session-1/runs", { method: "POST" }), {
        ok: true,
      });
      assert.deepEqual(await fetchJson("/api/v1/sessions"), { value: "second" });

      const thirdHeaders = new Headers(calls[2].init?.headers);

      assert.equal(thirdHeaders.has("If-None-Match"), false);
    },
  );
});

test("fetchJson stores GET responses in Cache API when available", async () => {
  const storage = createMemoryStorage();
  const caches = createCacheStorageStub();
  let requestCount = 0;

  await withBrowserStubs(
    {
      sessionStorage: storage,
      caches,
      fetch: async () => {
        requestCount += 1;

        if (requestCount === 1) {
          return new Response(JSON.stringify({ value: "large".repeat(10_000) }), {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              ETag: '"large-session"',
            },
          });
        }

        return new Response(null, { status: 304 });
      },
    },
    async (calls) => {
      const first = await fetchJson<{ value: string }>("/api/v1/sessions/session-1");
      const second = await fetchJson<{ value: string }>("/api/v1/sessions/session-1");

      assert.equal(first.value.length, 50_000);
      assert.deepEqual(second, first);
      assert.equal(storage.keys().length, 0);

      const secondHeaders = new Headers(calls[1].init?.headers);

      assert.equal(secondHeaders.get("If-None-Match"), '"large-session"');
    },
  );
});
