import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

extendZodWithOpenApi(z);

const nonEmptyStringSchema = z.string().trim().min(1);
const jsonRecordSchema = z.record(z.string(), z.unknown());

export const ErrorResponseSchema = z.object({
  error: z.string(),
});

export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("@cui/api"),
  time: z.string().datetime(),
});

export const ChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["assistant", "user"]),
  kind: z.enum(["response", "trace"]).optional(),
  round: z.number().int().positive().optional(),
  content: z.string(),
  createdAt: z.string().datetime(),
});

export const AtomicCapabilityTypeSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(5),
]);

export const AtomicDiffReviewItemSchema = z.object({
  id: z.string(),
  order: z.number().int(),
  capabilityType: AtomicCapabilityTypeSchema,
  capabilityLabel: z.string(),
  title: z.string(),
  intent: z.string(),
  files: z.array(z.string()),
  diff: z.string(),
  outputJson: jsonRecordSchema,
});

export const AtomicDiffReviewSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    generatedAt: z.string().datetime(),
    analysisSessionId: z.string(),
    items: z.array(AtomicDiffReviewItemSchema),
    rawResponse: z.string(),
  }),
  z.object({
    status: z.literal("failed"),
    generatedAt: z.string().datetime(),
    error: z.string(),
    rawResponse: z.string().optional(),
  }),
]);

export const ChatRoundSchema = z.object({
  round: z.number().int().positive(),
  baseCommit: z.string().optional(),
  beforeDiff: z.string(),
  afterDiff: z.string(),
  diff: z.string(),
  hasChanges: z.boolean(),
  createdAt: z.string().datetime(),
  atomicReview: AtomicDiffReviewSchema.optional(),
});

export const ChatRoundSummarySchema = ChatRoundSchema.pick({
  round: true,
  hasChanges: true,
  createdAt: true,
}).extend({
  atomicReviewStatus: AtomicDiffReviewSchema.options[0].shape.status
    .or(AtomicDiffReviewSchema.options[1].shape.status)
    .optional(),
});

export const ChatSessionViewSchema = z.object({
  id: z.string(),
  workspace: z.string(),
  title: z.string(),
  summary: z.string().optional(),
  doneAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  messages: z.array(ChatMessageSchema),
  rounds: z.array(ChatRoundSummarySchema).optional(),
  currentRound: z.number().int().nonnegative(),
  isRunning: z.boolean(),
  runningTurnId: z.string().optional(),
});

export const CreateSessionRequestSchema = z.object({
  workspace: nonEmptyStringSchema,
  prompt: nonEmptyStringSchema,
});

export const ContinueSessionRequestSchema = z.object({
  prompt: nonEmptyStringSchema,
});

export const UpdateSessionRequestSchema = z.object({
  done: z.boolean(),
});

export const SubmittedTurnResponseSchema = z.object({
  status: z.literal("ok"),
  session: ChatSessionViewSchema,
  turnId: z.string(),
});

export const OkResponseSchema = z.object({
  status: z.literal("ok"),
});

export const ListSessionsResponseSchema = z.object({
  sessions: z.array(ChatSessionViewSchema),
});

export const GetSessionResponseSchema = z.object({
  session: ChatSessionViewSchema,
});

export const GetRoundReviewResponseSchema = z.object({
  review: ChatRoundSchema,
});

export const SessionIdParamsSchema = z.object({
  sessionId: z.string().min(1),
});

export const RoundReviewParamsSchema = z.object({
  sessionId: z.string().min(1),
  round: z.coerce.number().int().positive(),
});

export const RoundReviewQuerySchema = z.object({
  mode: z.enum(["atomic", "full"]).optional(),
});

export const TurnIdParamsSchema = z.object({
  turnId: z.string().min(1),
});

export const TurnStreamEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("delta"),
    text: z.string(),
  }),
  z.object({
    type: z.literal("raw"),
    event: z.unknown(),
  }),
  z.object({
    type: z.literal("session.updated"),
    session: ChatSessionViewSchema,
  }),
  z.object({
    type: z.literal("done"),
    session: ChatSessionViewSchema,
  }),
  z.object({
    type: z.literal("failed"),
    error: z.string(),
  }),
  z.object({
    type: z.literal("cancelled"),
  }),
]);

export type CreateSessionRequestContract = z.infer<typeof CreateSessionRequestSchema>;
export type ContinueSessionRequestContract = z.infer<typeof ContinueSessionRequestSchema>;
export type UpdateSessionRequestContract = z.infer<typeof UpdateSessionRequestSchema>;
