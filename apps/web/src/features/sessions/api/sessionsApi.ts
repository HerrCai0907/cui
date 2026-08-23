import { fetchJson } from "../../../shared/api/fetchJson";
import type { paths } from "../../../shared/api/generated/schema";
import type { ApiSession, SubmittedTurn } from "../../../types";

type ListSessionsResponse =
  paths["/api/sessions"]["get"]["responses"][200]["content"]["application/json"];
type GetSessionResponse =
  paths["/api/sessions/{sessionId}"]["get"]["responses"][200]["content"]["application/json"];
type CreateSessionRequest =
  paths["/api/sessions"]["post"]["requestBody"]["content"]["application/json"];
type CreateSessionResponse =
  paths["/api/sessions"]["post"]["responses"][202]["content"]["application/json"];
type ContinueSessionRequest =
  paths["/api/sessions/{sessionId}/messages"]["post"]["requestBody"]["content"]["application/json"];
type ContinueSessionResponse =
  paths["/api/sessions/{sessionId}/messages"]["post"]["responses"][202]["content"]["application/json"];
type UpdateSessionRequest =
  paths["/api/sessions/{sessionId}"]["patch"]["requestBody"]["content"]["application/json"];
type UpdateSessionResponse =
  paths["/api/sessions/{sessionId}"]["patch"]["responses"][200]["content"]["application/json"];
type StopSessionResponse =
  paths["/api/sessions/{sessionId}/stop"]["post"]["responses"][202]["content"]["application/json"];

export async function listSessions(): Promise<ApiSession[]> {
  const data = await fetchJson<ListSessionsResponse>("/api/sessions");

  return data.sessions;
}

export async function getSession(sessionId: string): Promise<ApiSession> {
  const data = await fetchJson<GetSessionResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}`,
  );

  return data.session;
}

export async function createSession(input: CreateSessionRequest): Promise<SubmittedTurn> {
  return fetchJson<CreateSessionResponse>("/api/sessions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
}

export async function continueSession(
  sessionId: string,
  input: ContinueSessionRequest,
): Promise<SubmittedTurn> {
  return fetchJson<ContinueSessionResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    },
  );
}

export async function updateSession(
  sessionId: string,
  input: UpdateSessionRequest,
): Promise<ApiSession> {
  const data = await fetchJson<UpdateSessionResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    },
  );

  return data.session;
}

export async function stopSession(sessionId: string): Promise<void> {
  await fetchJson<StopSessionResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/stop`, {
    method: "POST",
  });
}
