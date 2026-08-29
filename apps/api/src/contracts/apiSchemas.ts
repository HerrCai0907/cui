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
  gitBranch: z.string().optional(),
  isRunning: z.boolean(),
  runningTurnId: z.string().optional(),
});

export const ChatSessionListItemSchema = ChatSessionViewSchema.omit({
  messages: true,
  rounds: true,
});

export const AiModelPreferencesSchema = z
  .object({
    normal: z.string().trim().min(1).optional(),
    summary: z.string().trim().min(1).optional(),
    atomicReview: z.string().trim().min(1).optional(),
  })
  .strict();

export const AiModelInfoSchema = z.object({
  name: z.string(),
  provider: z.string().optional(),
  description: z.string().optional(),
  contextWindow: z.number().int().positive().optional(),
});

export const CreateSessionRequestSchema = z.object({
  workspace: nonEmptyStringSchema,
  prompt: nonEmptyStringSchema,
  models: AiModelPreferencesSchema.optional(),
});

export const ContinueSessionRequestSchema = z.object({
  prompt: nonEmptyStringSchema,
  models: AiModelPreferencesSchema.optional(),
});

export const CreateShellSessionRequestSchema = z.object({
  workspace: nonEmptyStringSchema,
  command: nonEmptyStringSchema,
});

export const RunShellCommandRequestSchema = z.object({
  command: nonEmptyStringSchema,
});

export const UpdateSessionRequestSchema = z.object({
  done: z.boolean(),
});

export const ListSessionsQuerySchema = z.object({
  page: z.coerce
    .number("page must be a positive integer")
    .int("page must be a positive integer")
    .positive("page must be a positive integer")
    .optional(),
  pageSize: z.coerce
    .number("pageSize must be a positive integer")
    .int("pageSize must be a positive integer")
    .positive("pageSize must be a positive integer")
    .max(100, "pageSize must be less than or equal to 100")
    .optional(),
});

const startLineSchema = z.coerce
  .number("startLine must be a positive integer")
  .int("startLine must be a positive integer")
  .positive("startLine must be a positive integer");
const endLineSchema = z.coerce
  .number("endLine must be a positive integer")
  .int("endLine must be a positive integer")
  .positive("endLine must be a positive integer");

export const CodeRangeQuerySchema = z
  .object({
    filePath: z.string().trim().min(1, "filePath must be a non-empty string"),
    startLine: startLineSchema.optional(),
    endLine: endLineSchema.optional(),
  })
  .superRefine((value, context) => {
    if (
      (value.startLine === undefined && value.endLine !== undefined) ||
      (value.startLine !== undefined && value.endLine === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "startLine and endLine must be provided together",
      });
      return;
    }

    if (
      value.startLine !== undefined &&
      value.endLine !== undefined &&
      value.startLine > value.endLine
    ) {
      context.addIssue({
        code: "custom",
        message: "startLine must be less than or equal to endLine",
        path: ["startLine"],
      });
    }
  });

export const CodeLineSchema = z.object({
  lineNumber: z.number().int().positive(),
  content: z.string(),
});

export const CodeRangeResponseSchema = z.object({
  filePath: z.string(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  code: z.string(),
  lines: z.array(CodeLineSchema),
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
  sessions: z.array(ChatSessionListItemSchema),
  pagination: z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().positive(),
    hasPreviousPage: z.boolean(),
    hasNextPage: z.boolean(),
  }),
});

export const ListModelsResponseSchema = z.object({
  models: z.array(AiModelInfoSchema),
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
  atomicReviewModel: z.string().trim().min(1).optional(),
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
export type CreateShellSessionRequestContract = z.infer<typeof CreateShellSessionRequestSchema>;
export type RunShellCommandRequestContract = z.infer<typeof RunShellCommandRequestSchema>;
export type UpdateSessionRequestContract = z.infer<typeof UpdateSessionRequestSchema>;
export type ListSessionsQueryContract = z.infer<typeof ListSessionsQuerySchema>;
export type CodeRangeRequestContract = z.infer<typeof CodeRangeQuerySchema>;
export type CodeRangeResponseContract = z.infer<typeof CodeRangeResponseSchema>;
