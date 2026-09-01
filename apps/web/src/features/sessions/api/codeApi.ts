import { fetchJson } from "../../../shared/api/fetchJson";
import type { paths } from "../../../shared/api/generated/schema";

type GetCodeQuery = paths["/api/v1/source-files/content"]["get"]["parameters"]["query"];
type GetCodeResponse =
  paths["/api/v1/source-files/content"]["get"]["responses"][200]["content"]["application/json"];

export type CodeRangeResult = GetCodeResponse;

export async function getCodeRange(query: GetCodeQuery): Promise<CodeRangeResult> {
  const params = new URLSearchParams({ filePath: query.filePath });

  if (query.startLine !== undefined && query.endLine !== undefined) {
    params.set("startLine", String(query.startLine));
    params.set("endLine", String(query.endLine));
  }

  return fetchJson<GetCodeResponse>(`/api/v1/source-files/content?${params.toString()}`);
}
