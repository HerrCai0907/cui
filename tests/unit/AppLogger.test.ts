import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AppLogger } from "../../apps/api/src/infrastructure/logging/AppLogger.js";

test("AppLogger writes framework logs to a date-stamped file", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "cui-app-logger-"));

  try {
    const logger = new AppLogger(logDir);

    await logger.framework.info("server.started", { port: 5173 });

    const files = await readdir(logDir);
    const frameworkLogFile = files.find((file) => /^framework-\d{4}-\d{2}-\d{2}\.log$/.test(file));

    assert.ok(frameworkLogFile);
    assert.equal(files.includes("framework.log"), false);

    const content = await readFile(join(logDir, frameworkLogFile), "utf8");
    const entry = JSON.parse(content.trim()) as {
      data: { port: number };
      event: string;
      level: string;
      time: string;
    };

    assert.equal(entry.event, "server.started");
    assert.equal(entry.level, "info");
    assert.equal(entry.data.port, 5173);
    assert.match(entry.time, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    await rm(logDir, { force: true, recursive: true });
  }
});
