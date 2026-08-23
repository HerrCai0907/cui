export type ReviewRoute = {
  sessionId: string;
  round: number;
  mode: "atomic" | "full";
};

export function parseReviewRoute(pathname: string): ReviewRoute | null {
  const match = /^\/ui\/sessions\/([^/]+)\/rounds\/(\d+)\/(atomic_review|full_review)\/?$/.exec(
    pathname,
  );

  if (!match) {
    return null;
  }

  try {
    return {
      sessionId: decodeURIComponent(match[1]),
      round: Number(match[2]),
      mode: match[3] === "full_review" ? "full" : "atomic",
    };
  } catch {
    return null;
  }
}

export function createReviewPath(
  sessionId: string,
  round: number,
  mode: ReviewRoute["mode"],
): string {
  const reviewType = mode === "full" ? "full_review" : "atomic_review";

  return `/ui/sessions/${encodeURIComponent(sessionId)}/rounds/${round}/${reviewType}`;
}

export function reviewBrowserStateKey(route: ReviewRoute): string {
  return `cui:review-state:v1:${route.sessionId}:${route.round}`;
}
