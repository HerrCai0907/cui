import assert from "node:assert/strict";
import test from "node:test";
import { listModels } from "../../apps/web/src/features/config/api/modelApi.js";
import { withWebSocketRpcStub } from "./rpcTestHelpers.js";

test("listModels requests the selected harness catalog through JSON-RPC", async () => {
  await withWebSocketRpcStub(
    (request) => {
      assert.equal(request.method, "models.list");
      assert.deepEqual(request.params, { harness: "codex" });

      return {
        models: [
          {
            name: "gpt-6-astra",
            supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
          },
        ],
      };
    },
    async () => {
      assert.deepEqual(await listModels("codex"), [
        {
          name: "gpt-6-astra",
          supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
        },
      ]);
    },
  );
});
