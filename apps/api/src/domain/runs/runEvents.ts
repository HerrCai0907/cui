import type { ChatSessionView } from "../../types.js";

export type RunStreamEvent =
  | {
      type: "run.output.delta";
      text: string;
    }
  | {
      type: "run.trace";
      event: unknown;
    }
  | {
      type: "session.updated";
      session: ChatSessionView;
    }
  | {
      type: "run.succeeded";
      session: ChatSessionView;
    }
  | {
      type: "run.failed";
      error: string;
    }
  | {
      type: "run.cancelled";
    };
