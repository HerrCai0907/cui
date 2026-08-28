import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { JsonFileDb } from "../../apps/api/src/infrastructure/store/JsonFileDb.js";

test("JsonFileDb serves cached data instead of rereading a partially written file", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "cui-json-file-db-"));
  const filePath = join(cwd, "data.json");
  const db = new JsonFileDb();

  try {
    await writeFile(filePath, `${JSON.stringify({ value: "stable" }, null, 2)}\n`, "utf8");

    assert.deepEqual(await db.read(filePath), { value: "stable" });

    await writeFile(filePath, '{"value":"partial', "utf8");

    assert.deepEqual(await db.read(filePath), { value: "stable" });
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("JsonFileDb writes JSON through the shared cache and final data file", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "cui-json-file-db-"));
  const filePath = join(cwd, "data.json");
  const db = new JsonFileDb();

  try {
    await db.write(filePath, { nested: { value: "created", omitted: undefined } });

    const cached = await db.read<{ nested: { value: string } }>(filePath);
    const persisted = JSON.parse(await readFile(filePath, "utf8")) as unknown;

    assert.deepEqual(cached, { nested: { value: "created" } });
    assert.deepEqual(persisted, { nested: { value: "created" } });
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("JsonFileDb serializes first reads and writes for the same file", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "cui-json-file-db-"));
  const filePath = join(cwd, "data.json");
  const db = new JsonFileDb();

  try {
    await writeFile(filePath, `${JSON.stringify({ value: "initial" }, null, 2)}\n`, "utf8");

    const initialRead = db.read(filePath);
    const write = db.write(filePath, { value: "updated" });

    assert.deepEqual(await initialRead, { value: "initial" });
    await write;
    assert.deepEqual(await db.read(filePath), { value: "updated" });
    assert.deepEqual(JSON.parse(await readFile(filePath, "utf8")), { value: "updated" });
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});
