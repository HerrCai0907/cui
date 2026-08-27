import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  assertExistingDirectory,
  expandHomePath,
  InvalidPathError,
  PathNotDirectoryError,
  PathNotFoundError,
} from "../../apps/api/src/domain/paths/pathValidation.js";

test("expandHomePath resolves home-relative paths", () => {
  assert.equal(expandHomePath("~"), homedir());
  assert.equal(expandHomePath("~/project"), join(homedir(), "project"));
  assert.equal(expandHomePath("relative/project"), resolve("relative/project"));
});

test("assertExistingDirectory accepts directories and rejects invalid paths", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "cui-path-validation-"));
  const filePath = join(cwd, "file.txt");

  try {
    await writeFile(filePath, "content\n");

    assert.equal(await assertExistingDirectory(cwd), cwd);
    await assert.rejects(() => assertExistingDirectory(join(cwd, "missing")), PathNotFoundError);
    await assert.rejects(() => assertExistingDirectory(filePath), PathNotDirectoryError);
    await assert.rejects(() => assertExistingDirectory("bad\0path"), InvalidPathError);
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});
