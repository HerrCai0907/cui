import type { z } from "zod";
import {
  CodeRangeQuerySchema,
  ContinueSessionRequestSchema,
  CreateShellSessionRequestSchema,
  CreateSessionRequestSchema,
  RoundReviewParamsSchema,
  RoundReviewQuerySchema,
  RunShellCommandRequestSchema,
  UpdateSessionRequestSchema,
} from "../../contracts/apiSchemas.js";

export type ParsedBody<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseCreateSessionBody(
  body: unknown,
): ParsedBody<z.infer<typeof CreateSessionRequestSchema>> {
  return parseWithSchema(CreateSessionRequestSchema, body);
}

export function parseCreateShellSessionBody(
  body: unknown,
): ParsedBody<z.infer<typeof CreateShellSessionRequestSchema>> {
  return parseWithSchema(CreateShellSessionRequestSchema, body);
}

export function parseContinueSessionBody(
  body: unknown,
): ParsedBody<z.infer<typeof ContinueSessionRequestSchema>> {
  return parseWithSchema(ContinueSessionRequestSchema, body);
}

export function parseRunShellCommandBody(
  body: unknown,
): ParsedBody<z.infer<typeof RunShellCommandRequestSchema>> {
  return parseWithSchema(RunShellCommandRequestSchema, body);
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

export function parseCodeRangeQuery(
  query: unknown,
): ParsedBody<z.infer<typeof CodeRangeQuerySchema>> {
  return parseWithSchema(CodeRangeQuerySchema, query);
}
