import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { GitDiffService } from "../../apps/api/src/infrastructure/diff/GitDiffService.js";

test("createRoundDiff only includes changes from the current round", () => {
  const diffService = new GitDiffService();
  const previousDiff = [
    "diff --git a/src/example.ts b/src/example.ts",
    "--- a/src/example.ts",
    "+++ b/src/example.ts",
    "@@ -1,2 +1,2 @@",
    " const a = 1;",
    "-const b = 2;",
    "+const b = 20;",
  ].join("\n");
  const currentDiff = [
    "diff --git a/src/example.ts b/src/example.ts",
    "--- a/src/example.ts",
    "+++ b/src/example.ts",
    "@@ -1,2 +1,2 @@",
    "-const a = 1;",
    "+const a = 10;",
    " const b = 20;",
  ].join("\n");

  assert.equal(
    diffService.createRoundDiff(previousDiff, currentDiff),
    [
      "diff --git a/src/example.ts b/src/example.ts",
      "--- a/src/example.ts",
      "+++ b/src/example.ts",
      "@@ -1,2 +1,2 @@",
      "-const a = 1;",
      "+const a = 10;",
      " const b = 20;",
    ].join("\n"),
  );
});

test("createRoundDiff treats deleting a previous-round new file as a deletion", () => {
  const diffService = new GitDiffService();
  const previousDiff = [
    "diff --git a/src/new.ts b/src/new.ts",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/src/new.ts",
    "@@ -0,0 +1,2 @@",
    "+export const value = 1;",
    "+export const next = 2;",
  ].join("\n");

  assert.equal(
    diffService.createRoundDiff(previousDiff, ""),
    [
      "diff --git a/src/new.ts b/src/new.ts",
      "deleted file mode 100644",
      "--- a/src/new.ts",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "-export const value = 1;",
      "-export const next = 2;",
    ].join("\n"),
  );
});

test("createRoundDiff includes end-of-file newline-only changes", () => {
  const diffService = new GitDiffService();
  const previousDiff = [
    "diff --git a/src/example.ts b/src/example.ts",
    "--- a/src/example.ts",
    "+++ b/src/example.ts",
    "@@ -1 +1 @@",
    "-export const value = 1;",
    "\\ No newline at end of file",
    "+export const value = 1;",
  ].join("\n");
  const currentDiff = [
    "diff --git a/src/example.ts b/src/example.ts",
    "--- a/src/example.ts",
    "+++ b/src/example.ts",
    "@@ -1 +1 @@",
    "-export const value = 1;",
    "+export const value = 1;",
    "\\ No newline at end of file",
  ].join("\n");

  assert.equal(
    diffService.createRoundDiff(previousDiff, currentDiff),
    [
      "diff --git a/src/example.ts b/src/example.ts",
      "--- a/src/example.ts",
      "+++ b/src/example.ts",
      "@@ -1,1 +1,1 @@",
      "-export const value = 1;",
      "+export const value = 1;",
      "\\ No newline at end of file",
    ].join("\n"),
  );
});

test("captureWorkspaceDiff can stay based on the round start commit", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "cui-git-diff-"));
  const diffService = new GitDiffService();

  try {
    await runGit(["init"], cwd);
    await runGit(["config", "user.email", "test@example.com"], cwd);
    await runGit(["config", "user.name", "Test User"], cwd);
    await writeFile(join(cwd, "example.ts"), "export const value = 1;\n");
    await runGit(["add", "example.ts"], cwd);
    await runGit(["commit", "-m", "initial"], cwd);

    const beforeSnapshot = await diffService.captureWorkspaceSnapshot(cwd);

    await writeFile(join(cwd, "example.ts"), "export const value = 2;\n");
    await runGit(["add", "example.ts"], cwd);
    await runGit(["commit", "-m", "round change"], cwd);

    assert.equal(await diffService.captureWorkspaceDiff(cwd), "");

    const afterDiff = await diffService.captureWorkspaceDiff(cwd, beforeSnapshot.gitCommit);

    assert.equal(beforeSnapshot.diff, "");
    assert.match(beforeSnapshot.gitCommit, /^[0-9a-f]{40}$/);
    assert.equal(
      diffService.createRoundDiff(beforeSnapshot.diff, afterDiff),
      [
        "diff --git a/example.ts b/example.ts",
        "--- a/example.ts",
        "+++ b/example.ts",
        "@@ -1,1 +1,1 @@",
        "-export const value = 1;",
        "+export const value = 2;",
      ].join("\n"),
    );
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("captureCurrentBranch returns the active workspace branch name", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "cui-git-branch-"));
  const diffService = new GitDiffService();

  try {
    await runGit(["init"], cwd);
    await runGit(["checkout", "-b", "feature/session-branch"], cwd);

    assert.equal(await diffService.captureCurrentBranch(cwd), "feature/session-branch");
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

function runGit(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd }, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
