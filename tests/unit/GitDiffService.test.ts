import assert from 'node:assert/strict';
import test from 'node:test';
import { GitDiffService } from '../../apps/api/src/infrastructure/diff/GitDiffService.js';

test('createRoundDiff only includes changes from the current round', () => {
  const diffService = new GitDiffService();
  const previousDiff = [
    'diff --git a/src/example.ts b/src/example.ts',
    '--- a/src/example.ts',
    '+++ b/src/example.ts',
    '@@ -1,2 +1,2 @@',
    ' const a = 1;',
    '-const b = 2;',
    '+const b = 20;',
  ].join('\n');
  const currentDiff = [
    'diff --git a/src/example.ts b/src/example.ts',
    '--- a/src/example.ts',
    '+++ b/src/example.ts',
    '@@ -1,2 +1,2 @@',
    '-const a = 1;',
    '+const a = 10;',
    ' const b = 20;',
  ].join('\n');

  assert.equal(
    diffService.createRoundDiff(previousDiff, currentDiff),
    [
      'diff --git a/src/example.ts b/src/example.ts',
      '--- a/src/example.ts',
      '+++ b/src/example.ts',
      '@@ -1,2 +1,2 @@',
      '-const a = 1;',
      '+const a = 10;',
      ' const b = 20;',
    ].join('\n'),
  );
});

test('createRoundDiff treats deleting a previous-round new file as a deletion', () => {
  const diffService = new GitDiffService();
  const previousDiff = [
    'diff --git a/src/new.ts b/src/new.ts',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/src/new.ts',
    '@@ -0,0 +1,2 @@',
    '+export const value = 1;',
    '+export const next = 2;',
  ].join('\n');

  assert.equal(
    diffService.createRoundDiff(previousDiff, ''),
    [
      'diff --git a/src/new.ts b/src/new.ts',
      'deleted file mode 100644',
      '--- a/src/new.ts',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-export const value = 1;',
      '-export const next = 2;',
    ].join('\n'),
  );
});

test('createRoundDiff includes end-of-file newline-only changes', () => {
  const diffService = new GitDiffService();
  const previousDiff = [
    'diff --git a/src/example.ts b/src/example.ts',
    '--- a/src/example.ts',
    '+++ b/src/example.ts',
    '@@ -1 +1 @@',
    '-export const value = 1;',
    '\\ No newline at end of file',
    '+export const value = 1;',
  ].join('\n');
  const currentDiff = [
    'diff --git a/src/example.ts b/src/example.ts',
    '--- a/src/example.ts',
    '+++ b/src/example.ts',
    '@@ -1 +1 @@',
    '-export const value = 1;',
    '+export const value = 1;',
    '\\ No newline at end of file',
  ].join('\n');

  assert.equal(
    diffService.createRoundDiff(previousDiff, currentDiff),
    [
      'diff --git a/src/example.ts b/src/example.ts',
      '--- a/src/example.ts',
      '+++ b/src/example.ts',
      '@@ -1,1 +1,1 @@',
      '-export const value = 1;',
      '+export const value = 1;',
      '\\ No newline at end of file',
    ].join('\n'),
  );
});
