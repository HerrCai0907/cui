import type { z } from "zod";
import {
  ContinueSessionRequestSchema,
  CreateSessionRequestSchema,
  RoundReviewParamsSchema,
  RoundReviewQuerySchema,
  UpdateSessionRequestSchema,
} from "../../contracts/apiSchemas.js";

export type ParsedBody<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseCreateSessionBody(
  body: unknown,
): ParsedBody<z.infer<typeof CreateSessionRequestSchema>> {
  return parseWithSchema(CreateSessionRequestSchema, body);
}

export function parsePrompt(body: unknown): string | undefined {
  const parsed = parseWithSchema(ContinueSessionRequestSchema, body);

  return parsed.ok ? parsed.value.prompt : undefined;
}

export function parseUpdateSessionBody(
  body: unknown,
): ParsedBody<z.infer<typeof UpdateSessionRequestSchema>> {
  return parseWithSchema(UpdateSessionRequestSchema, body);
}

export function parseRoundReviewParams(
  params: unknown,
): ParsedBody<z.infer<typeof RoundReviewParamsSchema>> {
  return parseWithSchema(RoundReviewParamsSchema, params);
}

export function parseRoundReviewQuery(
  query: unknown,
): ParsedBody<z.infer<typeof RoundReviewQuerySchema>> {
  return parseWithSchema(RoundReviewQuerySchema, query);
}

function parseWithSchema<T extends z.ZodType>(schema: T, input: unknown): ParsedBody<z.infer<T>> {
  const parsed = schema.safeParse(input);

  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }

  return { ok: false, error: parsed.error.issues[0]?.message ?? "invalid request" };
}
