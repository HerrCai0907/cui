import { OpenAPIRegistry, OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import {
  ChatMessageSchema,
  ChatRoundSchema,
  ChatRoundSummarySchema,
  ChatSessionViewSchema,
  ContinueSessionRequestSchema,
  CreateSessionRequestSchema,
  ErrorResponseSchema,
  GetRoundReviewResponseSchema,
  GetSessionResponseSchema,
  HealthResponseSchema,
  ListSessionsResponseSchema,
  OkResponseSchema,
  RoundReviewParamsSchema,
  RoundReviewQuerySchema,
  SessionIdParamsSchema,
  SubmittedTurnResponseSchema,
  TurnIdParamsSchema,
  TurnStreamEventSchema,
  UpdateSessionRequestSchema,
} from "./apiSchemas.js";

const registry = new OpenAPIRegistry();

registry.register("ErrorResponse", ErrorResponseSchema);
registry.register("HealthResponse", HealthResponseSchema);
registry.register("ChatMessage", ChatMessageSchema);
registry.register("ChatRoundSummary", ChatRoundSummarySchema);
registry.register("ChatRound", ChatRoundSchema);
registry.register("ChatSessionView", ChatSessionViewSchema);
registry.register("CreateSessionRequest", CreateSessionRequestSchema);
registry.register("ContinueSessionRequest", ContinueSessionRequestSchema);
registry.register("UpdateSessionRequest", UpdateSessionRequestSchema);
registry.register("SubmittedTurnResponse", SubmittedTurnResponseSchema);
registry.register("OkResponse", OkResponseSchema);
registry.register("TurnStreamEvent", TurnStreamEventSchema);

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
  path: "/api/health",
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
  path: "/api/sessions",
  summary: "List sessions",
  responses: {
    200: {
      description: "List of session summaries with current running state.",
      content: {
        "application/json": {
          schema: ListSessionsResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/sessions",
  summary: "Create a session and start its first turn",
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
    202: {
      description: "The turn was accepted and started.",
      content: {
        "application/json": {
          schema: SubmittedTurnResponseSchema,
        },
      },
    },
    400: errorResponse,
    409: errorResponse,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/sessions/{sessionId}",
  summary: "Get a session",
  request: {
    params: SessionIdParamsSchema,
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
  method: "patch",
  path: "/api/sessions/{sessionId}",
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
  path: "/api/sessions/{sessionId}/rounds/{round}/review",
  summary: "Get a round review",
  request: {
    params: RoundReviewParamsSchema,
    query: RoundReviewQuerySchema,
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
  path: "/api/sessions/{sessionId}/messages",
  summary: "Continue a session with a user prompt",
  request: {
    params: SessionIdParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: ContinueSessionRequestSchema,
        },
      },
    },
  },
  responses: {
    202: {
      description: "The continuation turn was accepted and started.",
      content: {
        "application/json": {
          schema: SubmittedTurnResponseSchema,
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
  path: "/api/sessions/{sessionId}/stop",
  summary: "Stop the running turn for a session",
  request: {
    params: SessionIdParamsSchema,
  },
  responses: {
    202: {
      description: "The running turn was cancelled.",
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
  path: "/api/turns/{turnId}/events",
  summary: "Stream turn events",
  request: {
    params: TurnIdParamsSchema,
  },
  responses: {
    200: {
      description: "Server-sent event stream. Each event payload matches TurnStreamEvent.",
      content: {
        "text/event-stream": {
          schema: TurnStreamEventSchema,
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
