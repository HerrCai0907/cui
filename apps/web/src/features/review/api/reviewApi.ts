import { fetchJson } from "../../../shared/api/fetchJson";
import type { paths } from "../../../shared/api/generated/schema";
import type { ApiRound } from "../../../types";

type GetRoundReviewResponse =
  paths["/api/v1/sessions/{sessionId}/rounds/{round}/review"]["get"]["responses"][200]["content"]["application/json"];

export async function getRoundReview(sessionId: string, round: number): Promise<ApiRound> {
  const data = await fetchJson<GetRoundReviewResponse>(
    `/api/v1/sessions/${encodeURIComponent(sessionId)}/rounds/${round}/review`,
  );

  return data.review;
}
