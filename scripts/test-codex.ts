import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexModel } from "../apps/api/src/infrastructure/ai/CodexModel.js";
import { runAiProcess } from "../apps/api/src/infrastructure/ai/aiProcess.js";
import type { AiModelPreferences, AiRun, AiRunEvent } from "../apps/api/src/types.js";

// Opt-in live test: uses the installed Codex CLI and its existing login/config.
const workspace = await mkdtemp(join(tmpdir(), "cui codex smoke 中文 "));
const modelId = process.env.CUI_CODEX_TEST_MODEL?.trim();
const models: AiModelPreferences = {
  harness: "codex",
  ...(modelId ? { normal: modelId, summary: modelId, atomicReview: modelId } : {}),
  reasoningEfforts: { normal: "low", summary: "low", atomicReview: "low" },
};
const model = new CodexModel({
  timeoutMs: 120_000,
  processRunner: (input) => {
    console.log(JSON.stringify({ command: input.command, args: input.args, cwd: input.cwd }));
    return runAiProcess(input);
  },
});
const nonce = randomUUID();
const fileContent =
  "--你好 \"Codex\" 'CUI' $HOME $(echo untouched) `literal` \\path\nsecond line\n";

async function finish(run: AiRun) {
  const deadline = setTimeout(() => run.cancel(), 180_000);
  try {
    const [sessionId, result] = await Promise.all([run.sessionId, run.result]);
    assert.equal(sessionId, result.sessionId);
    assert.ok(result.rawEvents.some((event: any) => event.type === "turn.completed"));
    return result;
  } finally {
    clearTimeout(deadline);
  }
}

try {
  execFileSync("git", ["init", "--quiet", workspace]);
  const events: AiRunEvent[] = [];
  const prompt = [
    "-- This line is prompt text, not a CLI option.",
    `Remember this nonce for our next turn: ${nonce}`,
    "Create greeting.txt with exactly the decoded content of this JSON string:",
    JSON.stringify(fileContent),
    "Run a shell command to print the current working directory and read greeting.txt.",
    "Do not modify any other files. Reply with exactly CUI_CODEX_CREATED.",
  ].join("\n");
  const created = await finish(
    model.createSessionStream({ workspace, prompt, models }, (event) => events.push(event)),
  );
  assert.equal(created.content, "CUI_CODEX_CREATED");
  assert.equal(await readFile(join(workspace, "greeting.txt"), "utf8"), fileContent);
  assert.ok(events.some((event) => event.type === "delta" && event.text.includes(created.content)));
  assert.ok(
    created.rawEvents.some(
      (event: any) =>
        event.type === "item.completed" &&
        event.item?.type === "command_execution" &&
        event.item.exit_code === 0 &&
        event.item.aggregated_output?.includes(workspace),
    ),
  );
  assert.match(created.gitDiff?.afterDiff ?? "", /greeting\.txt/);
  console.log(
    `PASS create: stdin, Unicode/quotes, cwd, tools, deltas, final output, diff (${created.sessionId})`,
  );

  const resumedEvents: AiRunEvent[] = [];
  const continued = await finish(
    model.continueSessionStream(
      {
        workspace,
        sessionId: created.sessionId,
        models,
        prompt:
          'Append exactly "resume-ok\\n" to greeting.txt. Reply only with the nonce I asked you to remember in the previous turn.',
      },
      (event) => resumedEvents.push(event),
    ),
  );
  assert.equal(continued.sessionId, created.sessionId);
  assert.equal(continued.content, nonce);
  assert.equal(
    await readFile(join(workspace, "greeting.txt"), "utf8"),
    fileContent + "resume-ok\n",
  );
  assert.ok(resumedEvents.some((event) => event.type === "delta" && event.text.includes(nonce)));
  assert.equal(continued.gitDiff?.beforeDiff, created.gitDiff?.afterDiff);
  assert.match(continued.gitDiff?.afterDiff ?? "", /resume-ok/);
  console.log("PASS resume: same session, remembered context, stdin, streamed output, diff");

  const summary = await model.summarizeConversation({
    workspace,
    models,
    prompt:
      'Do not use tools. Return exactly this JSON, with no other text: {"title":"Codex 验证","progress":"创建和续聊成功"}',
  });
  assert.deepEqual(summary, { title: "Codex 验证", progress: "创建和续聊成功" });
  console.log("PASS summary: purpose-specific arguments and JSON output");

  const review = await model.createAtomicDiffReview({
    workspace,
    models,
    originalSessionId: created.sessionId,
    round: 1,
    sessionInput: prompt,
    assistantOutput: created.content,
    executionTrace: created.trace ?? "",
    diff: created.gitDiff!.afterDiff,
  });
  assert.equal(review.status, "ready", JSON.stringify(review));
  if (review.status === "ready") {
    assert.ok(review.items.length > 0);
    assert.ok(review.items.some((item) => item.files.includes("greeting.txt")));
  }
  assert.equal(
    await readFile(join(workspace, "greeting.txt"), "utf8"),
    fileContent + "resume-ok\n",
  );
  console.log("PASS atomic review: temporary input files, real tools and validated JSON/diff");
} finally {
  await rm(workspace, { recursive: true, force: true });
}
