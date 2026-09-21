import assert from "node:assert/strict";
import test from "node:test";
import { RunRegistry } from "../../apps/api/src/domain/runs/RunRegistry.js";

test("RunRegistry keeps replay history bounded", () => {
  const registry = new RunRegistry(2);
  const run = registry.createRunningRun("session-1", "assistant_response", () => undefined);

  registry.emitRunEvent(run, { type: "run.output.delta", text: "one" });
  registry.emitRunEvent(run, { type: "run.output.delta", text: "two" });
  registry.emitRunEvent(run, { type: "run.output.delta", text: "three" });

  const replayed: string[] = [];

  registry.subscribeToRun(run.id, (event) => {
    if (event.type === "run.output.delta") {
      replayed.push(event.text);
    }
  });

  assert.deepEqual(replayed, ["two", "three"]);
});

test("RunRegistry compacts large trace events before storing and broadcasting", () => {
  const registry = new RunRegistry();
  const run = registry.createRunningRun("session-1", "assistant_response", () => undefined);
  const received: unknown[] = [];

  registry.subscribeToRun(run.id, (event) => {
    if (event.type === "run.trace") {
      received.push(event.event);
    }
  });
  registry.emitRunEvent(run, {
    type: "run.trace",
    event: {
      type: "command_execution",
      aggregatedOutput: "x".repeat(300_000),
      raw: {
        duplicatedOutput: "y".repeat(300_000),
      },
    },
  });

  const trace = received[0] as {
    aggregatedOutput: string;
    raw?: unknown;
  };

  assert.equal("raw" in trace, false);
  assert.ok(trace.aggregatedOutput.length < 300_000);
  assert.match(trace.aggregatedOutput, /\[truncated: \d+ more characters\]$/);
});

test("RunRegistry compacts trace messages in completed session payloads", () => {
  const registry = new RunRegistry();
  const run = registry.createRunningRun("session-1", "assistant_response", () => undefined);
  const events: unknown[] = [];

  registry.subscribeToRun(run.id, (event) => {
    events.push(event);
  });
  registry.emitRunEvent(run, {
    type: "run.succeeded",
    session: {
      id: "session-1",
      workspace: "/tmp",
      title: "Session",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      currentRound: 1,
      isRunning: false,
      messages: [
        {
          id: "trace-1",
          role: "assistant",
          kind: "trace",
          content: "x".repeat(300_000),
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    },
  });

  const completed = events[0] as {
    type: "run.succeeded";
    session: { messages: Array<{ content: string }> };
  };

  assert.equal(completed.type, "run.succeeded");
  assert.ok(completed.session.messages[0]!.content.length < 300_000);
  assert.match(completed.session.messages[0]!.content, /\[truncated: \d+ more characters\]$/);
});
