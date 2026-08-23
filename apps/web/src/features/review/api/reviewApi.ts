import { fetchJson } from "../../../shared/api/fetchJson";
import type { paths } from "../../../shared/api/generated/schema";
import type { ApiRound } from "../../../types";

type GetRoundReviewResponse =
  paths["/api/sessions/{sessionId}/rounds/{round}/review"]["get"]["responses"][200]["content"]["application/json"];
type GetRoundReviewQuery =
  paths["/api/sessions/{sessionId}/rounds/{round}/review"]["get"]["parameters"]["query"];

export async function getRoundReview(
  sessionId: string,
  round: number,
  mode: NonNullable<GetRoundReviewQuery>["mode"] = "atomic",
): Promise<ApiRound> {
  const data = await fetchJson<GetRoundReviewResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/rounds/${round}/review?mode=${mode}`,
  );

  return data.review;
}
