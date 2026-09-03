import type { z } from "zod";
import {
  CodeRangeQuerySchema,
  CreateRoundReviewRunRequestSchema,
  CreateRunRequestSchema,
  CreateSessionRequestSchema,
  GetSessionMessagesQuerySchema,
  GetSessionQuerySchema,
  ListSessionsQuerySchema,
  RoundReviewParamsSchema,
  RunEventsQuerySchema,
  UpdateSessionRequestSchema,
} from "../../contracts/apiSchemas.js";

export type ParsedBody<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseCreateSessionBody(
  body: unknown,
): ParsedBody<z.infer<typeof CreateSessionRequestSchema>> {
  return parseWithSchema(CreateSessionRequestSchema, body);
}

export function parseCreateRunBody(
  body: unknown,
): ParsedBody<z.infer<typeof CreateRunRequestSchema>> {
  return parseWithSchema(CreateRunRequestSchema, body);
}

export function parseCreateRoundReviewRunBody(
  body: unknown,
): ParsedBody<z.infer<typeof CreateRoundReviewRunRequestSchema>> {
  return parseWithSchema(CreateRoundReviewRunRequestSchema, body);
}

export function parseUpdateSessionBody(
  body: unknown,
): ParsedBody<z.infer<typeof UpdateSessionRequestSchema>> {
  return parseWithSchema(UpdateSessionRequestSchema, body);
}

export function parseListSessionsQuery(
  query: unknown,
): ParsedBody<z.infer<typeof ListSessionsQuerySchema>> {
  return parseWithSchema(ListSessionsQuerySchema, query);
}

export function parseGetSessionQuery(
  query: unknown,
): ParsedBody<z.infer<typeof GetSessionQuerySchema>> {
  return parseWithSchema(GetSessionQuerySchema, query);
}

export function parseGetSessionMessagesQuery(
  query: unknown,
): ParsedBody<z.infer<typeof GetSessionMessagesQuerySchema>> {
  return parseWithSchema(GetSessionMessagesQuerySchema, query);
}

export function parseRoundReviewParams(
  params: unknown,
): ParsedBody<z.infer<typeof RoundReviewParamsSchema>> {
  return parseWithSchema(RoundReviewParamsSchema, params);
}

export function parseRunEventsQuery(
  query: unknown,
): ParsedBody<z.infer<typeof RunEventsQuerySchema>> {
  return parseWithSchema(RunEventsQuerySchema, query);
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
