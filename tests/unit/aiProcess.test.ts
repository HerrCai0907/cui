import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { GitDiffService } from "../../apps/api/src/infrastructure/diff/GitDiffService.js";
import { runAiProcess } from "../../apps/api/src/infrastructure/ai/aiProcess.js";
import { AiRunCancelledError } from "../../apps/api/src/types.js";

async function fixture(t: test.TestContext, script: string) {
  const cwd = await mkdtemp(join(tmpdir(), "cui process 中文 "));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const path = join(cwd, "fake cli.cjs");
  await writeFile(path, script);
  const events: unknown[] = [];
  return {
    events,
    input: {
      command: process.execPath,
      binaryConfig: {
        harness: "codex" as const,
        command: process.execPath,
        displayName: "Codex",
        envVar: "CODEX_BIN",
      },
      args: [path, "-"],
      cwd,
      input: "",
      timeoutMs: 5_000,
      captureDiff: false,
      diffService: new GitDiffService(),
      onRawEvent: (event: unknown) => events.push(event),
    },
  };
}

test("process passes exact UTF-8 stdin and output path; parses split JSONL and trailing event", async (t) => {
  const { input, events } = await fixture(
    t,
    `
    const fs = require('node:fs');
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => input += chunk);
    process.stdin.on('end', () => {
      const args = process.argv.slice(2);
      if (args.at(-1) !== '-') process.exit(2);
      fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], input);
      const data = Buffer.from(JSON.stringify({type:'item.completed', item:{type:'agent_message',text:input}}));
      const split = data.indexOf(Buffer.from('你')) + 1;
      process.stdout.write(data.subarray(0, split));
      setTimeout(() => process.stdout.write(Buffer.concat([data.subarray(split), Buffer.from('\\n{"type":"turn.completed"}')])), 20);
    });
  `,
  );
  input.input = "--你好 \"quotes\" 'single' $HOME $(echo no) `literal` \\path\nline two\n";
  const result = await runAiProcess(input).promise;
  assert.equal(result.content, input.input);
  assert.deepEqual(events, [
    { type: "item.completed", item: { type: "agent_message", text: input.input } },
    { type: "turn.completed" },
  ]);
  assert.deepEqual(result.rawEvents, events);
});

for (const code of [0, 1]) {
  test(`process reports JSON turn.failed even with exit ${code} and empty stderr`, async (t) => {
    const { input } = await fixture(
      t,
      `
      process.stdin.resume();
      process.stdin.on('end', () => {
        process.stdout.write(JSON.stringify({type:'turn.failed',error:{message:'model unavailable'}}));
        process.exitCode = ${code};
      });
    `,
    );
    await assert.rejects(runAiProcess(input).promise, /Codex command failed.*model unavailable/);
  });
}

test("process keeps CLI errors when a large stdin write is closed early", async (t) => {
  const { input } = await fixture(
    t,
    'process.stderr.write("invalid CLI option"); process.exit(2);',
  );
  input.input = "x".repeat(4 * 1024 * 1024);
  await assert.rejects(runAiProcess(input).promise, /invalid CLI option/);
});

test("process rejects snapshot failures after successful CLI exit", async (t) => {
  const { input } = await fixture(t, "process.stdin.resume();");
  input.captureDiff = true;
  input.diffService.captureWorkspaceSnapshot = async () => ({ gitCommit: "base", diff: "" });
  input.diffService.captureWorkspaceDiff = async () => {
    throw new Error("snapshot failed");
  };
  await assert.rejects(runAiProcess(input).promise, /snapshot failed/);
});

test("process cancellation settles and kills a running CLI", async (t) => {
  const { input } = await fixture(t, "setInterval(() => {}, 1000);");
  const run = runAiProcess(input);
  run.cancel();
  await assert.rejects(run.promise, AiRunCancelledError);
});
