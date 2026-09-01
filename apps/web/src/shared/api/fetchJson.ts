import { resolveApiUrl } from "./apiBaseUrl";

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(resolveApiUrl(url), init);

  if (!response.ok) {
    throw new Error(`Request failed: HTTP ${response.status}`);
  }

  return (await response.json()) as T;
}
