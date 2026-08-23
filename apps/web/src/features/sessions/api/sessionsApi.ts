import { fetchJson } from "../../../shared/api/fetchJson";
import type { ApiSession, SubmittedTurn } from "../../../types";

export async function listSessions(): Promise<ApiSession[]> {
  const data = await fetchJson<{ sessions: ApiSession[] }>("/api/sessions");

  return data.sessions;
}

export async function getSession(sessionId: string): Promise<ApiSession> {
  const data = await fetchJson<{ session: ApiSession }>(`/api/sessions/${sessionId}`);

  return data.session;
}

export async function createSession(input: {
  workspace: string;
  prompt: string;
}): Promise<SubmittedTurn> {
  return fetchJson<SubmittedTurn>("/api/sessions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
}

export async function continueSession(
  sessionId: string,
  input: { prompt: string },
): Promise<SubmittedTurn> {
  return fetchJson<SubmittedTurn>(`/api/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
}
