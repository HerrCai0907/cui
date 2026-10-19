import { rpcRequest } from "../../../shared/api/rpcClient";
import type { ApiDiffFilePage, ApiRoundReview } from "../../../types";

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
  const data = await rpcRequest<{ review: ApiRoundReview }>("reviews.getRound", {
    sessionId,
    round,
  });

  return data.review;
}

export async function getRoundDiffFilePage(input: DiffFilePageRequest): Promise<ApiDiffFilePage> {
  const data = await rpcRequest<{ page: ApiDiffFilePage }>("reviews.getRoundDiffFilePage", input);

  return data.page;
}

export async function getAtomicDiffFilePage(
  input: AtomicDiffFilePageRequest,
): Promise<ApiDiffFilePage> {
  const data = await rpcRequest<{ page: ApiDiffFilePage }>("reviews.getAtomicDiffFilePage", input);

  return data.page;
}
