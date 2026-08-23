import { fetchJson } from "../../../shared/api/fetchJson";
import type { ApiRound } from "../../../types";

export async function getRoundReview(sessionId: string, round: number): Promise<ApiRound> {
  const data = await fetchJson<{ review: ApiRound }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/rounds/${round}/review`,
  );

  return data.review;
}
