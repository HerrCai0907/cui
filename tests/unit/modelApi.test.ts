import assert from "node:assert/strict";
import test from "node:test";
import { listModels } from "../../apps/web/src/features/config/api/modelApi.js";

type FetchCall = {
  url: string;
  init?: RequestInit;
};

test("listModels requests the selected harness catalog", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const calls: FetchCall[] = [];

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: { href: "http://localhost:5173/" },
      sessionStorage: {
        getItem: () => null,
        key: () => null,
        length: 0,
        setItem: () => undefined,
        removeItem: () => undefined,
      },
    },
  });
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (url: string, init?: RequestInit) => {
      calls.push({ url, init });

      return new Response(
        JSON.stringify({
          models: [
            {
              name: "gpt-6-astra",
              supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    },
  });

  try {
    const models = await listModels("codex");
    const url = new URL(calls[0]?.url ?? "", "http://localhost");

    assert.equal(url.pathname, "/api/v1/models");
    assert.equal(url.searchParams.get("harness"), "codex");
    assert.deepEqual(models, [
      {
        name: "gpt-6-astra",
        supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
      },
    ]);
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
});
