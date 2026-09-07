import assert from "node:assert/strict";
import test from "node:test";
import { CodexModel } from "../../apps/api/src/infrastructure/ai/CodexModel.js";
import { TraexModel } from "../../apps/api/src/infrastructure/ai/TraexModel.js";
import { RoutingAiModel } from "../../apps/api/src/infrastructure/ai/RoutingAiModel.js";
import type { AiProcessRunner } from "../../apps/api/src/infrastructure/ai/CliAiModel.js";
import { AiRunCancelledError, type AiRunEvent } from "../../apps/api/src/types.js";

for (const harness of [undefined, "traex", "codex"] as const) {
  test(`routes all session workflows to ${harness ?? "default TraeX"}`, async () => {
    const calls: Parameters<AiProcessRunner>[0][] = [];
    const processRunner: AiProcessRunner = (input) => {
      calls.push(input);
      const rawEvents = [
        { type: "thread.started", thread_id: "new-session" },
        { type: "text_delta", text: "Done." },
      ];
      rawEvents.forEach(input.onRawEvent);
      return {
        cancel: () => undefined,
        promise: Promise.resolve({
          content: JSON.stringify({ title: "Title", progress: "Progress", items: [] }),
          rawEvents,
          beforeSnapshot: { gitCommit: "base", diff: "before" },
          afterSnapshot: { gitCommit: "base", diff: "after" },
        }),
      };
    };
    const router = new RoutingAiModel({
      traex: new TraexModel({ binary: "/test/traex", permissionMode: "ask", processRunner }),
      codex: new CodexModel({ binary: "/test/codex", processRunner }),
    });
    const input = { workspace: "/tmp/workspace", prompt: "test", models: { harness } };
    const resumeInput = { ...input, sessionId: "existing-session" };
    const created = await router.createSession(input);
    assert.equal(created.sessionId, "new-session");
    assert.deepEqual(created.gitDiff, {
      baseCommit: "base",
      beforeDiff: "before",
      afterDiff: "after",
    });
    assert.equal((await router.continueSession(resumeInput)).sessionId, "existing-session");

    for (const sessionId of [undefined, "existing-session"]) {
      const events: AiRunEvent[] = [];
      const onEvent = (event: AiRunEvent) => events.push(event);
      const run = sessionId
        ? router.continueSessionStream({ ...input, sessionId }, onEvent)
        : router.createSessionStream(input, onEvent);
      const expectedSessionId = sessionId ?? "new-session";
      assert.equal(await run.sessionId, expectedSessionId);
      assert.equal((await run.result).sessionId, expectedSessionId);
      assert.deepEqual(
        events.filter((event) => event.type === "session"),
        [{ type: "session", sessionId: expectedSessionId }],
      );
      assert.ok(events.some((event) => event.type === "delta" && event.text === "Done."));
      assert.equal(
        events.filter((event) => event.type === "raw").length,
        harness === "codex" ? 1 : 2,
      );
    }

    assert.deepEqual(await router.summarizeConversation(input), {
      title: "Title",
      progress: "Progress",
    });
    const review = await router.createAtomicDiffReview({
      ...input,
      originalSessionId: created.sessionId,
      round: 1,
      sessionInput: "test",
      executionTrace: "",
      assistantOutput: "Done.",
      diff: "",
    });
    assert.equal(review.status, "ready");
    assert.equal(calls.length, 6);
    assert.deepEqual(
      calls.map((call) => call.captureDiff),
      [true, true, true, true, false, false],
    );
    for (const call of calls) {
      assert.equal(call.command, harness === "codex" ? "/test/codex" : "/test/traex");
      assert.equal(call.cwd, input.workspace);
      if (harness === "codex") {
        assert.ok(call.args.includes("--dangerously-bypass-approvals-and-sandbox"));
        assert.ok(!call.args.includes("--permission-mode"));
      } else {
        const permissionIndex = call.args.indexOf("--permission-mode");
        assert.deepEqual(call.args.slice(permissionIndex, permissionIndex + 2), [
          "--permission-mode",
          "ask",
        ]);
        assert.ok(!call.args.includes("--dangerously-bypass-approvals-and-sandbox"));
      }
    }
  });
}

test("model-list API preserves the TraeX catalog while Codex accepts configured model IDs", async () => {
  const codex = new CodexModel();
  const router = new RoutingAiModel({
    traex: new TraexModel({ modelListRunner: async () => [{ name: "traex-model" }] }),
    codex,
  });
  assert.deepEqual(await router.listModels(), [{ name: "traex-model" }]);
  assert.deepEqual(await codex.listModels(), []);
});

for (const harness of ["traex", "codex"] as const) {
  test(`${harness} cancellation propagates through the router and rejects pending promises`, async () => {
    let cancelCalls = 0;
    const processRunner: AiProcessRunner = () => {
      let rejectRun!: (error: Error) => void;
      return {
        promise: new Promise((_resolve, reject) => {
          rejectRun = reject;
        }),
        cancel: () => {
          cancelCalls += 1;
          rejectRun(new AiRunCancelledError());
        },
      };
    };
    const router = new RoutingAiModel({
      traex: new TraexModel({ processRunner }),
      codex: new CodexModel({ processRunner }),
    });
    const run = router.createSessionStream(
      { workspace: "/tmp", prompt: "test", models: { harness } },
      () => undefined,
    );
    const sessionRejected = assert.rejects(run.sessionId, AiRunCancelledError);
    const resultRejected = assert.rejects(run.result, AiRunCancelledError);
    run.cancel();
    await Promise.all([sessionRejected, resultRejected]);
    assert.equal(cancelCalls, 1);
  });
}
