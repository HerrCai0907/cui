import assert from "node:assert/strict";
import test from "node:test";
import { TraexModel } from "../../apps/api/src/infrastructure/ai/TraexModel.js";

test("TraeX lists and normalizes its model catalog", async () => {
  const model = new TraexModel({
    modelListRunner: async () => [
      {
        name: " GPT-5.4 ",
        provider: "trae",
        description: "Default coding model",
        context_window: 200000,
      },
      null,
      { name: " " },
    ],
  });
  assert.deepEqual(await model.listModels(), [
    {
      name: "GPT-5.4",
      provider: "trae",
      description: "Default coding model",
      contextWindow: 200000,
    },
  ]);
});
