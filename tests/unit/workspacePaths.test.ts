import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";
import { suggestWorkspacePaths } from "../../apps/api/src/domain/paths/workspacePaths.js";
import { parseWorkspacePathSuggestionsQuery } from "../../apps/api/src/http/validation/requestParsers.js";

test("workspace completion filters directories and follows directory symlinks", async () => {
  const root = await mkdtemp(join(tmpdir(), "cui-paths-"));
  try {
    await mkdir(join(root, "project with spaces"));
    await mkdir(join(root, "project-two"));
    await mkdir(join(root, ".hidden"));
    await writeFile(join(root, "project.txt"), "");
    await symlink(join(root, "project-two"), join(root, "project-link"));
    await symlink(join(root, "missing"), join(root, "project-broken"));
    await symlink(join(root, "project.txt"), join(root, "project-file"));

    assert.deepEqual(await suggestWorkspacePaths(`${root}/proj`), [
      `${root}/project with spaces/`,
      `${root}/project-link/`,
      `${root}/project-two/`,
    ]);
    assert.deepEqual(await suggestWorkspacePaths(`${root}/.`), [`${root}/.hidden/`]);
    assert.equal((await suggestWorkspacePaths(`${root}/`)).length, 3);
    assert.deepEqual(await suggestWorkspacePaths(`${root}/missing/`), []);
    assert.deepEqual(await suggestWorkspacePaths(`${root}/project.txt/`), []);
    const relativeRoot = relative(process.cwd(), root);
    assert.deepEqual(await suggestWorkspacePaths(`${relativeRoot}/project-t`), [
      `${relativeRoot}/project-two/`,
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace completion expands home paths while preserving the tilde", async () => {
  const suggestions = await suggestWorkspacePaths("~");
  assert.deepEqual(suggestions, await suggestWorkspacePaths("~/"));
  assert(suggestions.every((path) => path.startsWith("~/") && path.endsWith("/")));
  const entries = await readdir(homedir(), { withFileTypes: true });
  if (entries.some((entry) => entry.isDirectory() && !entry.name.startsWith("."))) {
    assert(suggestions.length > 0);
  }
});

test("workspace completion limits large directory listings", async () => {
  const root = await mkdtemp(join(tmpdir(), "cui-path-limit-"));
  try {
    await Promise.all(
      Array.from({ length: 60 }, (_, index) => mkdir(join(root, `project-${index}`))),
    );
    assert.equal((await suggestWorkspacePaths(`${root}/`)).length, 50);
    assert.deepEqual(await suggestWorkspacePaths(`${root}/project-59`), [`${root}/project-59/`]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace completion validates queries and ignores empty input", async () => {
  assert.deepEqual(await suggestWorkspacePaths(""), []);
  assert.deepEqual(await suggestWorkspacePaths("  "), []);
  for (const query of [{}, { path: ["/"] }, { path: "a\0b" }, { path: "a".repeat(4097) }]) {
    assert.equal(parseWorkspacePathSuggestionsQuery(query).ok, false);
  }
  assert.equal(parseWorkspacePathSuggestionsQuery({ path: "~/dev/" }).ok, true);
});
