import { fetchJson } from "../../../shared/api/fetchJson";
import type { paths } from "../../../shared/api/generated/schema";
import type { ModelOption } from "../model/appConfig";

type ListModelsResponse =
  paths["/api/models"]["get"]["responses"][200]["content"]["application/json"];

export async function listModels(): Promise<ModelOption[]> {
  const data = await fetchJson<ListModelsResponse>("/api/models");

  return data.models;
}
