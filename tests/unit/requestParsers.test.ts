import assert from "node:assert/strict";
import test from "node:test";
import {
  parseGetSessionMessagesQuery,
  parseGetSessionQuery,
  parseRunEventsQuery,
} from "../../apps/api/src/http/validation/requestParsers.js";

test("parseGetSessionQuery accepts comma-separated trace message types", () => {
  const parsed = parseGetSessionQuery({
    messageWindow: "tail",
    messageLimit: "4",
    traceMessageTypes: "assistant_message,todo_list",
  });

  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.ok ? parsed.value : undefined, {
    messageWindow: "tail",
    messageLimit: 4,
    traceMessageTypes: ["assistant_message", "todo_list"],
  });
});

test("parseGetSessionMessagesQuery accepts repeated trace message type query params", () => {
  const parsed = parseGetSessionMessagesQuery({
    limit: "4",
    traceMessageTypes: ["assistant_message", "todo_list"],
  });

  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.ok ? parsed.value : undefined, {
    limit: 4,
    traceMessageTypes: ["assistant_message", "todo_list"],
  });
});

test("parseGetSessionQuery rejects unknown trace message types", () => {
  const parsed = parseGetSessionQuery({
    traceMessageTypes: "assistant_message,nope",
  });

  assert.equal(parsed.ok, false);
});

test("parseRunEventsQuery accepts trace message type filters", () => {
  const parsed = parseRunEventsQuery({
    traceMessageTypes: "assistant_message,todo_list",
  });

  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.ok ? parsed.value : undefined, {
    traceMessageTypes: ["assistant_message", "todo_list"],
  });
});
