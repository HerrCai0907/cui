import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createSseStreamWriter } from "../../apps/api/src/http/sse/writeSse.js";

test("SSE stream writer drains queued events asynchronously in bounded batches", async () => {
  const response = new FakeResponse();
  const writer = createSseStreamWriter(response);

  for (let index = 0; index < 20; index += 1) {
    assert.equal(
      writer.enqueue("run.output.delta", { type: "run.output.delta", text: `${index}` }),
      true,
    );
  }

  assert.equal(response.writeCalls.length, 0);

  await waitForImmediate();
  assert.equal(response.writeCalls.length, 16);

  await waitForImmediate();
  assert.equal(response.writeCalls.length, 20);
});

test("SSE stream writer waits for writable drain before continuing", async () => {
  const response = new FakeResponse();
  response.failWriteAt = 1;
  const writer = createSseStreamWriter(response);

  assert.equal(writer.enqueue("run.output.delta", { type: "run.output.delta", text: "one" }), true);
  assert.equal(writer.enqueue("run.output.delta", { type: "run.output.delta", text: "two" }), true);

  await waitForImmediate();
  assert.equal(response.writeCalls.length, 1);

  response.writableNeedDrain = false;
  response.emit("drain");
  await waitForImmediate();

  assert.equal(response.writeCalls.length, 2);
});

class FakeResponse extends EventEmitter {
  destroyed = false;
  writableEnded = false;
  writableNeedDrain = false;
  writeCalls: string[] = [];
  failWriteAt: number | undefined;

  write(chunk: string): boolean {
    this.writeCalls.push(chunk);

    if (this.failWriteAt === this.writeCalls.length) {
      this.writableNeedDrain = true;
      return false;
    }

    return true;
  }

  end(): void {
    this.writableEnded = true;
  }
}

function waitForImmediate(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}
