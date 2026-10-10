import assert from "node:assert/strict";
import test from "node:test";
import {
  formatModelLabel,
  getMessageTitle,
} from "../../apps/web/src/features/sessions/model/messages.js";
import type { ApiMessage } from "../../apps/web/src/types.js";

test("getMessageTitle appends model names to assistant messages", () => {
  assert.equal(
    getMessageTitle(createMessage({ kind: "trace", model: "GPT-5.4" })),
    "Execution Trace (GPT-5.4)",
  );
  assert.equal(
    getMessageTitle(createMessage({ kind: "response", model: "Seed-2.1-Turbo" })),
    "Assistant (Seed-2.1-Turbo)",
  );
});

test("getMessageTitle keeps legacy and user titles unchanged", () => {
  assert.equal(getMessageTitle(createMessage({ kind: "trace" })), "Execution Trace");
  assert.equal(getMessageTitle(createMessage({ kind: "response" })), "Assistant");
  assert.equal(getMessageTitle(createMessage({ role: "user" })), "You");
});

test("getMessageTitle uses a fallback model for legacy assistant messages", () => {
  assert.equal(
    getMessageTitle(createMessage({ kind: "trace" }), formatModelLabel("GPT-5.5", "high")),
    "Execution Trace (GPT-5.5 / High)",
  );
  assert.equal(
    getMessageTitle(createMessage({ kind: "response" }), formatModelLabel("GPT-5.5", "high")),
    "Assistant (GPT-5.5 / High)",
  );
  assert.equal(getMessageTitle(createMessage({ role: "user" }), "GPT-5.5"), "You");
});

test("formatModelLabel includes reasoning effort in model labels", () => {
  assert.equal(formatModelLabel("GPT-5.4", "xhigh"), "GPT-5.4 / XHigh");
  assert.equal(formatModelLabel(undefined, "low"), "Harness default / Low");
  assert.equal(formatModelLabel("Seed-2.1-Turbo", undefined), "Seed-2.1-Turbo");
  assert.equal(formatModelLabel(undefined, undefined), undefined);
});

function createMessage(overrides: Partial<ApiMessage>): ApiMessage {
  return {
    id: "message-1",
    role: "assistant",
    kind: "response",
    content: "Hello.",
    createdAt: "2026-08-22T00:00:00.000Z",
    ...overrides,
  };
}
