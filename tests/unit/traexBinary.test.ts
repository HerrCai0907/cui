import assert from "node:assert/strict";
import test from "node:test";
import {
  assertTraexBinaryAvailable,
  createTraexNotFoundError,
} from "../../apps/api/src/infrastructure/ai/traexBinary.js";

test("TraeX not found error includes the API process PATH", () => {
  const originalPath = process.env.PATH;

  process.env.PATH = "/usr/bin:/bin";

  try {
    const error = createTraexNotFoundError("traex");

    assert.match(error.message, /TraeX binary "traex" was not found/);
    assert.match(error.message, /API process PATH: \/usr\/bin:\/bin/);
    assert.match(error.message, /set TRAEX_BIN to the absolute traex path/);
  } finally {
    process.env.PATH = originalPath;
  }
});

test("TraeX availability check reports ENOENT with the same diagnostic", async () => {
  await assert.rejects(
    () => assertTraexBinaryAvailable("definitely-missing-traex-for-cui-test"),
    /API process PATH:/,
  );
});
