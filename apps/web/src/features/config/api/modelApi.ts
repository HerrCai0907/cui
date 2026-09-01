import { fetchJson } from "../../../shared/api/fetchJson";
import type { paths } from "../../../shared/api/generated/schema";
import type { ModelOption } from "../model/appConfig";

type ListModelsResponse =
  paths["/api/v1/models"]["get"]["responses"][200]["content"]["application/json"];

export async function listModels(): Promise<ModelOption[]> {
  const data = await fetchJson<ListModelsResponse>("/api/v1/models");

  return data.models;
}
