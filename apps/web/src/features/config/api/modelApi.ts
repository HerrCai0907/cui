import { rpcRequest } from "../../../shared/api/rpcClient";
import type { AiHarness, ModelOption } from "../model/appConfig";

export async function listModels(harness: AiHarness): Promise<ModelOption[]> {
  const data = await rpcRequest<{ models: ModelOption[] }>("models.list", { harness });

  return data.models;
}
