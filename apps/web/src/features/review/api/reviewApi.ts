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
  query: Pick<
    NonNullable<GetRoundReviewQuery>,
    "atomicReviewModel" | "atomicReviewReasoningEffort"
  > = {},
): Promise<ApiRound> {
  const searchParams = new URLSearchParams({ mode });

  if (query.atomicReviewModel) {
    searchParams.set("atomicReviewModel", query.atomicReviewModel);
  }

  if (query.atomicReviewReasoningEffort) {
    searchParams.set("atomicReviewReasoningEffort", query.atomicReviewReasoningEffort);
  }

  const data = await fetchJson<GetRoundReviewResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/rounds/${round}/review?${searchParams}`,
  );

  return data.review;
}
