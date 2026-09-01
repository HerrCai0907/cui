import { fetchJson } from "../../../shared/api/fetchJson";
import type { paths } from "../../../shared/api/generated/schema";
import type { ApiSession, ApiSessionListItem, SubmittedRun } from "../../../types";

type ListSessionsResponse =
  paths["/api/v1/sessions"]["get"]["responses"][200]["content"]["application/json"];
type GetSessionResponse =
  paths["/api/v1/sessions/{sessionId}"]["get"]["responses"][200]["content"]["application/json"];
type CreateSessionRequest =
  paths["/api/v1/sessions"]["post"]["requestBody"]["content"]["application/json"];
type CreateSessionResponse =
  paths["/api/v1/sessions"]["post"]["responses"][201]["content"]["application/json"];
type CreateRunRequest =
  paths["/api/v1/sessions/{sessionId}/runs"]["post"]["requestBody"]["content"]["application/json"];
type CreateRunResponse =
  paths["/api/v1/sessions/{sessionId}/runs"]["post"]["responses"][202]["content"]["application/json"];
type UpdateSessionRequest =
  paths["/api/v1/sessions/{sessionId}"]["patch"]["requestBody"]["content"]["application/json"];
type UpdateSessionResponse =
  paths["/api/v1/sessions/{sessionId}"]["patch"]["responses"][200]["content"]["application/json"];
type CancelRunResponse =
  paths["/api/v1/runs/{runId}/cancellation"]["post"]["responses"][202]["content"]["application/json"];

export type SessionListPage = ListSessionsResponse;
export type CreateRunInput = CreateRunRequest;

export async function listSessions(page = 1, pageSize = 30): Promise<SessionListPage> {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  const data = await fetchJson<ListSessionsResponse>(`/api/v1/sessions?${params.toString()}`);

  return data;
}

export async function getSession(sessionId: string): Promise<ApiSession> {
  const data = await fetchJson<GetSessionResponse>(
    `/api/v1/sessions/${encodeURIComponent(sessionId)}`,
  );

  return data.session;
}

export async function createSession(input: CreateSessionRequest): Promise<ApiSession> {
  const data = await fetchJson<CreateSessionResponse>("/api/v1/sessions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  return data.session;
}

export async function createRun(sessionId: string, input: CreateRunRequest): Promise<SubmittedRun> {
  return fetchJson<CreateRunResponse>(`/api/v1/sessions/${encodeURIComponent(sessionId)}/runs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
}

export async function updateSession(
  sessionId: string,
  input: UpdateSessionRequest,
): Promise<ApiSession> {
  const data = await fetchJson<UpdateSessionResponse>(
    `/api/v1/sessions/${encodeURIComponent(sessionId)}`,
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

export async function cancelRun(runId: string): Promise<void> {
  await fetchJson<CancelRunResponse>(`/api/v1/runs/${encodeURIComponent(runId)}/cancellation`, {
    method: "POST",
  });
}
