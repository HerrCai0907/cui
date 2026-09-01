import assert from "node:assert/strict";
import test from "node:test";
import {
  API_BASE_URL_STORAGE_KEY,
  getDefaultApiBaseUrl,
  loadApiBaseUrl,
  normalizeApiBaseUrl,
  resolveApiUrl,
  saveApiBaseUrl,
} from "../../apps/web/src/shared/api/apiBaseUrl.js";

type WindowStub = {
  location?: { protocol: string };
  localStorage?: {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
  };
  CuiAndroid?: {
    getApiBaseUrl: () => string;
  };
};

function withWindowStub(stub: WindowStub, run: () => void) {
  const originalWindow = globalThis.window;

  Object.defineProperty(globalThis, "window", { configurable: true, value: stub });
  try {
    run();
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }
}

test("normalizes API server addresses and resolves API paths", () => {
  assert.equal(normalizeApiBaseUrl(" server.example:3000/ "), "http://server.example:3000");
  assert.equal(normalizeApiBaseUrl("https://server.example/base/"), "https://server.example/base");
  assert.equal(
    resolveApiUrl("/api/v1/health", "http://127.0.0.1:3000"),
    "http://127.0.0.1:3000/api/v1/health",
  );
  assert.equal(resolveApiUrl("/api/v1/health", ""), "/api/v1/health");
  assert.throws(() => normalizeApiBaseUrl("ftp://server.example"));
});

test("embedded Android defaults to no API endpoint without native tunnel config", () => {
  withWindowStub({ location: { protocol: "file:" } }, () => {
    assert.equal(getDefaultApiBaseUrl(), "");
    assert.equal(loadApiBaseUrl(), "");
  });
});

test("embedded Android ignores old persisted direct API addresses", () => {
  const storage = new Map<string, string>([[API_BASE_URL_STORAGE_KEY, "http://10.0.2.2:3000"]]);

  withWindowStub(
    {
      location: { protocol: "file:" },
      localStorage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
      },
    },
    () => {
      assert.equal(loadApiBaseUrl(), "");
    },
  );
});

test("embedded Android reads the API endpoint from the native tunnel bridge", () => {
  withWindowStub(
    {
      location: { protocol: "file:" },
      CuiAndroid: {
        getApiBaseUrl: () => "http://127.0.0.1:18443",
      },
    },
    () => {
      assert.equal(getDefaultApiBaseUrl(), "http://127.0.0.1:18443");
      assert.equal(loadApiBaseUrl(), "http://127.0.0.1:18443");
    },
  );
});

test("API server address is persisted independently for requests during reload", () => {
  const storage = new Map<string, string>();

  withWindowStub(
    {
      location: { protocol: "http:" },
      localStorage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
      },
    },
    () => {
      saveApiBaseUrl("127.0.0.1:8123/");
      assert.equal(storage.get(API_BASE_URL_STORAGE_KEY), "http://127.0.0.1:8123");
      assert.equal(loadApiBaseUrl(), "http://127.0.0.1:8123");
    },
  );
});
