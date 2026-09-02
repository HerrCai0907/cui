import { OpenAPIRegistry, OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import {
  ChatMessageSchema,
  ChatRoundSchema,
  ChatRoundSummarySchema,
  ChatSessionListItemSchema,
  ChatSessionViewSchema,
  AiModelPreferencesSchema,
  CodeRangeQuerySchema,
  CodeRangeResponseSchema,
  CreateRoundReviewRunRequestSchema,
  CreateRunRequestSchema,
  CreateSessionResponseSchema,
  CreateSessionRequestSchema,
  ErrorResponseSchema,
  GetSessionMessagesQuerySchema,
  GetSessionMessagesResponseSchema,
  GetSessionQuerySchema,
  GetRoundReviewResponseSchema,
  GetSessionResponseSchema,
  HealthResponseSchema,
  ListSessionsQuerySchema,
  ListSessionsResponseSchema,
  ListModelsResponseSchema,
  OkResponseSchema,
  QueuedPromptSchema,
  RoundReviewParamsSchema,
  RunSchema,
  SessionIdParamsSchema,
  SubmittedRunResponseSchema,
  RunIdParamsSchema,
  RunStreamEventSchema,
  UpdateSessionRequestSchema,
} from "./apiSchemas.js";

const registry = new OpenAPIRegistry();

registry.register("ErrorResponse", ErrorResponseSchema);
registry.register("HealthResponse", HealthResponseSchema);
registry.register("ChatMessage", ChatMessageSchema);
registry.register("ChatRoundSummary", ChatRoundSummarySchema);
registry.register("ChatRound", ChatRoundSchema);
registry.register("ChatSessionView", ChatSessionViewSchema);
registry.register("ChatSessionListItem", ChatSessionListItemSchema);
registry.register("MessagePageInfo", GetSessionMessagesResponseSchema.shape.pageInfo);
registry.register("QueuedPrompt", QueuedPromptSchema);
registry.register("AiModelPreferences", AiModelPreferencesSchema);
registry.register("CodeRangeResponse", CodeRangeResponseSchema);
registry.register("CreateSessionRequest", CreateSessionRequestSchema);
registry.register("CreateSessionResponse", CreateSessionResponseSchema);
registry.register("CreateRunRequest", CreateRunRequestSchema);
registry.register("CreateRoundReviewRunRequest", CreateRoundReviewRunRequestSchema);
registry.register("Run", RunSchema);
registry.register("UpdateSessionRequest", UpdateSessionRequestSchema);
registry.register("SubmittedRunResponse", SubmittedRunResponseSchema);
registry.register("OkResponse", OkResponseSchema);
registry.register("RunStreamEvent", RunStreamEventSchema);
registry.register("ListModelsResponse", ListModelsResponseSchema);

const errorResponse = {
  description: "Error response.",
  content: {
    "application/json": {
      schema: ErrorResponseSchema,
    },
  },
};

registry.registerPath({
  method: "get",
  path: "/api/v1/health",
  summary: "Get API health",
  responses: {
    200: {
      description: "API health status.",
      content: {
        "application/json": {
          schema: HealthResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/source-files/content",
  summary: "Get source code from a file path and optional line range",
  request: {
    query: CodeRangeQuerySchema,
  },
  responses: {
    200: {
      description: "The requested source code.",
      content: {
        "application/json": {
          schema: CodeRangeResponseSchema,
        },
      },
    },
    400: errorResponse,
    404: errorResponse,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/models",
  summary: "List available AI models",
  responses: {
    200: {
      description: "Available AI models from the configured backend.",
      content: {
        "application/json": {
          schema: ListModelsResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/sessions",
  summary: "List sessions",
  request: {
    query: ListSessionsQuerySchema,
  },
  responses: {
    200: {
      description: "List of session summaries with current running state.",
      content: {
        "application/json": {
          schema: ListSessionsResponseSchema,
        },
      },
    },
    400: errorResponse,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/sessions",
  summary: "Create a session",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: CreateSessionRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "The session was created.",
      content: {
        "application/json": {
          schema: CreateSessionResponseSchema,
        },
      },
    },
    400: errorResponse,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/sessions/{sessionId}",
  summary: "Get a session",
  request: {
    params: SessionIdParamsSchema,
    query: GetSessionQuerySchema,
  },
  responses: {
    200: {
      description: "The requested session.",
      content: {
        "application/json": {
          schema: GetSessionResponseSchema,
        },
      },
    },
    404: errorResponse,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/sessions/{sessionId}/messages",
  summary: "Get a page of session messages",
  request: {
    params: SessionIdParamsSchema,
    query: GetSessionMessagesQuerySchema,
  },
  responses: {
    200: {
      description: "A page of session messages.",
      content: {
        "application/json": {
          schema: GetSessionMessagesResponseSchema,
        },
      },
    },
    400: errorResponse,
    404: errorResponse,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/v1/sessions/{sessionId}",
  summary: "Update session metadata",
  request: {
    params: SessionIdParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: UpdateSessionRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "The updated session.",
      content: {
        "application/json": {
          schema: GetSessionResponseSchema,
        },
      },
    },
    400: errorResponse,
    404: errorResponse,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/sessions/{sessionId}/rounds/{round}/review",
  summary: "Get a round review",
  request: {
    params: RoundReviewParamsSchema,
  },
  responses: {
    200: {
      description: "The requested round review.",
      content: {
        "application/json": {
          schema: GetRoundReviewResponseSchema,
        },
      },
    },
    400: errorResponse,
    404: errorResponse,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/sessions/{sessionId}/runs",
  summary: "Create a run in a session",
  request: {
    params: SessionIdParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: CreateRunRequestSchema,
        },
      },
    },
  },
  responses: {
    202: {
      description: "The run was accepted and either started or queued.",
      content: {
        "application/json": {
          schema: SubmittedRunResponseSchema,
        },
      },
    },
    400: errorResponse,
    404: errorResponse,
    409: errorResponse,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/sessions/{sessionId}/rounds/{round}/review-runs",
  summary: "Create a round review run",
  request: {
    params: RoundReviewParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: CreateRoundReviewRunRequestSchema,
        },
      },
    },
  },
  responses: {
    202: {
      description: "The review run was accepted.",
      content: {
        "application/json": {
          schema: SubmittedRunResponseSchema,
        },
      },
    },
    400: errorResponse,
    404: errorResponse,
    409: errorResponse,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/runs/{runId}/cancellation",
  summary: "Cancel a run",
  request: {
    params: RunIdParamsSchema,
  },
  responses: {
    202: {
      description: "The running run was cancelled.",
      content: {
        "application/json": {
          schema: OkResponseSchema,
        },
      },
    },
    404: errorResponse,
    409: errorResponse,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/runs/{runId}/events",
  summary: "Stream run events",
  request: {
    params: RunIdParamsSchema,
  },
  responses: {
    200: {
      description: "Server-sent event stream. Each event payload matches RunStreamEvent.",
      content: {
        "text/event-stream": {
          schema: RunStreamEventSchema,
        },
      },
    },
    404: errorResponse,
  },
});

export function createOpenApiDocument() {
  const generator = new OpenApiGeneratorV31(registry.definitions);

  return generator.generateDocument({
    openapi: "3.1.0",
    info: {
      title: "CUI API",
      version: "0.1.0",
    },
  });
}
