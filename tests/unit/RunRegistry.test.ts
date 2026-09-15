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
