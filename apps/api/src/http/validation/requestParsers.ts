import type { CreateSessionRequest } from "../../domain/sessions/SessionService.js";
import type { UpdateSessionRequest } from "../../domain/sessions/SessionService.js";

export type ParsedBody<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseCreateSessionBody(body: unknown): ParsedBody<CreateSessionRequest> {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "body must be an object" };
  }

  const workspace = "workspace" in body ? body.workspace : undefined;
  const prompt = "prompt" in body ? body.prompt : undefined;

  if (typeof workspace !== "string" || !workspace.trim()) {
    return { ok: false, error: "workspace must be a non-empty string" };
  }

  if (typeof prompt !== "string" || !prompt.trim()) {
    return { ok: false, error: "prompt must be a non-empty string" };
  }

  return {
    ok: true,
    value: {
      workspace: workspace.trim(),
      prompt: prompt.trim(),
    },
  };
}

export function parsePrompt(body: unknown): string | undefined {
  if (!body || typeof body !== "object") {
    return undefined;
  }

  const prompt = "prompt" in body ? body.prompt : undefined;

  if (typeof prompt !== "string" || !prompt.trim()) {
    return undefined;
  }

  return prompt.trim();
}

export function parseUpdateSessionBody(body: unknown): ParsedBody<UpdateSessionRequest> {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "body must be an object" };
  }

  const done = "done" in body ? body.done : undefined;

  if (typeof done !== "boolean") {
    return { ok: false, error: "done must be a boolean" };
  }

  return {
    ok: true,
    value: {
      done,
    },
  };
}
