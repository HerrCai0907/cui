import { fetchJson } from "../../../shared/api/fetchJson";
import type { paths } from "../../../shared/api/generated/schema";
import type { AiHarness, ModelOption } from "../model/appConfig";

type ListModelsResponse =
  paths["/api/v1/models"]["get"]["responses"][200]["content"]["application/json"];

export async function listModels(harness: AiHarness): Promise<ModelOption[]> {
  const params = new URLSearchParams({ harness });
  const data = await fetchJson<ListModelsResponse>(`/api/v1/models?${params}`);

  return data.models;
}
