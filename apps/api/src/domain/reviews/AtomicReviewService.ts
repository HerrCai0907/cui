import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AiModel,
  AiModelPreferences,
  AiRunResult,
  AtomicDiffReview,
  ChatRound,
} from "../../types.js";
import type { AppLogger } from "../../infrastructure/logging/AppLogger.js";
import type { SessionStore } from "../../infrastructure/store/SessionStore.js";

export class AtomicReviewService {
  private readonly activeReviews = new Map<string, Promise<AtomicDiffReview>>();

  constructor(
    private readonly aiModel: AiModel,
    private readonly logger: AppLogger,
    private readonly store?: Pick<SessionStore, "listRunEvents">,
  ) {}

  async createAtomicDiffReview(input: {
    sessionId: string;
    workspace: string;
    prompt: string;
    aiResponse: AiRunResult;
    round: ChatRound;
    models?: AiModelPreferences;
  }): Promise<AtomicDiffReview> {
    const key = createAtomicReviewKey(input.sessionId, input.round.round);
    const activeReview = this.activeReviews.get(key);

    if (activeReview) {
      return activeReview;
    }

    const review = this.runAtomicDiffReview(input).finally(() => {
      this.activeReviews.delete(key);
    });

    this.activeReviews.set(key, review);

    return review;
  }

  private async runAtomicDiffReview(input: {
    sessionId: string;
    workspace: string;
    prompt: string;
    aiResponse: AiRunResult;
    round: ChatRound;
    models?: AiModelPreferences;
  }): Promise<AtomicDiffReview> {
    let traceInputFiles: TraceInputFiles | undefined;

    try {
      traceInputFiles = await this.createExecutionTraceFile(
        input.aiResponse.traceRunId ?? input.round.traceRunId,
      );
      const review = await this.aiModel.createAtomicDiffReview({
        workspace: input.workspace,
        originalSessionId: input.sessionId,
        round: input.round.round,
        sessionInput: input.prompt,
        assistantOutput: input.aiResponse.content,
        diff: input.round.diff,
        executionTraceFilePath: traceInputFiles.filePath,
        models: input.models,
      });

      await this.logger.session(input.sessionId).info("round.review.created", {
        sessionId: input.sessionId,
        round: input.round.round,
        status: review.status,
        itemCount: review.status === "ready" ? review.items.length : 0,
      });

      return review;
    } catch (error) {
      await this.logger.session(input.sessionId).warn("round.review.failed", {
        sessionId: input.sessionId,
        round: input.round.round,
        error,
      });

      return {
        status: "failed",
        generatedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Failed to create atomic diff review",
      };
    } finally {
      if (traceInputFiles) {
        await rm(traceInputFiles.directory, { force: true, recursive: true });
      }
    }
  }

  private async createExecutionTraceFile(runId: string | undefined): Promise<TraceInputFiles> {
    const directory = await mkdtemp(join(tmpdir(), "cui-atomic-trace-"));
    const filePath = join(directory, "execution-trace.jsonl");

    if (!runId || !this.store) {
      await writeFile(filePath, "无", "utf8");
      return { directory, filePath };
    }

    const stream = createWriteStream(filePath, { encoding: "utf8" });
    let afterSeq = 0;
    let wroteTrace = false;

    try {
      while (true) {
        const events = await this.store.listRunEvents(runId, {
          afterSeq,
          limit: 1000,
        });

        if (events.length === 0) {
          break;
        }

        for (const event of events) {
          afterSeq = event.id;

          if (event.event.type !== "run.trace") {
            continue;
          }

          wroteTrace = true;
          if (!stream.write(`${JSON.stringify(event.event.event)}\n`)) {
            await once(stream, "drain");
          }
        }
      }

      if (!wroteTrace) {
        stream.write("无");
      }
    } finally {
      stream.end();
      await once(stream, "finish");
    }

    return { directory, filePath };
  }
}

function createAtomicReviewKey(sessionId: string, round: number): string {
  return `${sessionId}:${round}`;
}

type TraceInputFiles = {
  directory: string;
  filePath: string;
};
