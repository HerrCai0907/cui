import { fetchJson } from "../../../shared/api/fetchJson";
import type { paths } from "../../../shared/api/generated/schema";
import type { ApiDiffFilePage, ApiRoundReview } from "../../../types";

type GetRoundReviewResponse =
  paths["/api/v1/sessions/{sessionId}/rounds/{round}/review"]["get"]["responses"][200]["content"]["application/json"];
type GetRoundDiffFilePageResponse =
  paths["/api/v1/sessions/{sessionId}/rounds/{round}/diff/files/{fileId}"]["get"]["responses"][200]["content"]["application/json"];
type GetAtomicDiffFilePageResponse =
  paths["/api/v1/sessions/{sessionId}/rounds/{round}/atomic/items/{itemId}/diff/files/{fileId}"]["get"]["responses"][200]["content"]["application/json"];

export type DiffFilePageRequest = {
  sessionId: string;
  round: number;
  fileId: string;
  context?: number;
  cursor?: string;
  limit?: number;
};

export type AtomicDiffFilePageRequest = DiffFilePageRequest & {
  itemId: string;
};

export async function getRoundReview(sessionId: string, round: number): Promise<ApiRoundReview> {
  const data = await fetchJson<GetRoundReviewResponse>(
    `/api/v1/sessions/${encodeURIComponent(sessionId)}/rounds/${round}/review`,
  );

  return data.review;
}

export async function getRoundDiffFilePage(input: DiffFilePageRequest): Promise<ApiDiffFilePage> {
  const data = await fetchJson<GetRoundDiffFilePageResponse>(
    createDiffFilePageUrl(
      `/api/v1/sessions/${encodeURIComponent(input.sessionId)}/rounds/${input.round}/diff/files/${encodeURIComponent(input.fileId)}`,
      input,
    ),
  );

  return data.page;
}

export async function getAtomicDiffFilePage(
  input: AtomicDiffFilePageRequest,
): Promise<ApiDiffFilePage> {
  const data = await fetchJson<GetAtomicDiffFilePageResponse>(
    createDiffFilePageUrl(
      `/api/v1/sessions/${encodeURIComponent(input.sessionId)}/rounds/${input.round}/atomic/items/${encodeURIComponent(input.itemId)}/diff/files/${encodeURIComponent(input.fileId)}`,
      input,
    ),
  );

  return data.page;
}

function createDiffFilePageUrl(
  path: string,
  input: Pick<DiffFilePageRequest, "context" | "cursor" | "limit">,
): string {
  const params = new URLSearchParams();

  if (input.context !== undefined) {
    params.set("context", String(input.context));
  }

  if (input.cursor) {
    params.set("cursor", input.cursor);
  }

  if (input.limit !== undefined) {
    params.set("limit", String(input.limit));
  }

  const query = params.toString();

  return query ? `${path}?${query}` : path;
}
