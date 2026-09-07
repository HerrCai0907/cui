import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitDiffService } from "../diff/GitDiffService.js";
import type { AiModel } from "../../domain/ai/AiModel.js";
import type {
  AiReasoningEffort,
  AiAtomicDiffReviewInput,
  AiContinueSessionInput,
  AiCreateSessionInput,
  AiModelInfo,
  AiModelPreferences,
  AiModelPurpose,
  AiResponse,
  AiRun,
  AiRunEvent,
  AtomicDiffReview,
  ConversationSummary,
} from "../../types.js";
import {
  createAtomicDiffReviewFormatCorrectionPrompt,
  createAtomicDiffReviewPrompt,
} from "./atomicDiffReviewPrompt.js";
import { parseAtomicDiffReviewItems } from "./atomicDiffReviewParser.js";
import { parseConversationSummary } from "./conversationSummaryParser.js";
import type { AiHarnessBinaryConfig } from "./aiBinary.js";
import {
  extractResponseDeltas,
  extractThreadId,
  formatTraceEvents,
  toTraceEvent,
} from "./aiEvents.js";
import { runAiProcess, type AiProcessRun } from "./aiProcess.js";

export type AiProcessRunner = (input: Parameters<typeof runAiProcess>[0]) => AiProcessRun;

export type CliAiModelOptions = {
  binary?: string;
  diffService?: GitDiffService;
  processRunner?: AiProcessRunner;
  timeoutMs?: number;
};

/** Shared session, streaming, summary, and review workflows for CLI backends. */
export abstract class CliAiModel implements AiModel {
  private readonly diffService: GitDiffService;
  private readonly processRunner: AiProcessRunner;
  private readonly timeoutMs: number;

  protected constructor(
    protected readonly binaryConfig: AiHarnessBinaryConfig,
    options: CliAiModelOptions,
  ) {
    this.diffService = options.diffService ?? new GitDiffService();
    this.processRunner = options.processRunner ?? runAiProcess;
    this.timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
  }

  abstract listModels(): Promise<AiModelInfo[]>;
  protected abstract get permissionArgs(): string[];
  protected abstract resolveResponseContent(content: string, rawEvents: unknown[]): string;

  async createSession(input: AiCreateSessionInput): Promise<AiResponse> {
    const args = this.createExecArgs(input.workspace, input.models, "normal");

    return this.run(undefined, args, input.prompt, input.workspace, true);
  }

  createSessionStream(input: AiCreateSessionInput, onEvent: (event: AiRunEvent) => void): AiRun {
    const args = this.createExecArgs(input.workspace, input.models, "normal");

    return this.startRun(undefined, args, input.prompt, input.workspace, true, onEvent);
  }

  async continueSession(input: AiContinueSessionInput): Promise<AiResponse> {
    const args = this.createResumeArgs(input.sessionId, input.models, "normal");

    return this.run(input.sessionId, args, input.prompt, input.workspace, true);
  }

  async summarizeConversation(input: AiCreateSessionInput): Promise<ConversationSummary> {
    const args = this.createExecArgs(input.workspace, input.models, "summary");
    const response = await this.run(undefined, args, input.prompt, input.workspace, false);

    return parseConversationSummary(response.content);
  }

  async createAtomicDiffReview(input: AiAtomicDiffReviewInput): Promise<AtomicDiffReview> {
    const createArgs = this.createExecArgs(input.workspace, input.models, "atomicReview");
    let response: AiResponse | undefined;
    const inputFiles = await createAtomicReviewInputFiles({
      diff: input.diff,
      executionTrace: input.executionTrace,
    });
    const reviewInput = {
      ...input,
      diffFilePath: inputFiles.diffPath,
      executionTraceFilePath: inputFiles.executionTracePath,
    };

    try {
      response = await this.run(
        undefined,
        createArgs,
        createAtomicDiffReviewPrompt(reviewInput),
        input.workspace,
        false,
      );
      const parsedItems = parseAtomicDiffReviewItems(response.content);

      return {
        status: "ready",
        generatedAt: new Date().toISOString(),
        analysisSessionId: response.sessionId,
        items: parsedItems,
        rawResponse: response.content,
      };
    } catch (error) {
      if (response) {
        let correctionResponse: AiResponse | undefined;

        try {
          correctionResponse = await this.run(
            response.sessionId,
            this.createResumeArgs(response.sessionId, input.models, "atomicReview"),
            createAtomicDiffReviewFormatCorrectionPrompt({
              validationError:
                error instanceof Error ? error.message : "Atomic diff review format was invalid",
              previousResponse: response.content,
              diffFilePath: inputFiles.diffPath,
            }),
            input.workspace,
            false,
          );
          const parsedItems = parseAtomicDiffReviewItems(correctionResponse.content);

          return {
            status: "ready",
            generatedAt: new Date().toISOString(),
            analysisSessionId: correctionResponse.sessionId,
            items: parsedItems,
            rawResponse: correctionResponse.content,
          };
        } catch (correctionError) {
          return {
            status: "failed",
            generatedAt: new Date().toISOString(),
            error:
              correctionError instanceof Error
                ? correctionError.message
                : "Failed to create atomic diff review",
            rawResponse: correctionResponse?.content ?? response.content,
          };
        }
      }

      return {
        status: "failed",
        generatedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Failed to create atomic diff review",
      };
    } finally {
      await cleanupAtomicReviewInputFiles(inputFiles.directory);
    }
  }

  continueSessionStream(
    input: AiContinueSessionInput,
    onEvent: (event: AiRunEvent) => void,
  ): AiRun {
    const args = this.createResumeArgs(input.sessionId, input.models, "normal");

    return this.startRun(input.sessionId, args, input.prompt, input.workspace, true, onEvent);
  }

  private async run(
    expectedSessionId: string | undefined,
    args: string[],
    prompt: string,
    workspace: string,
    captureDiff = true,
  ): Promise<AiResponse> {
    return this.startRun(expectedSessionId, args, prompt, workspace, captureDiff, () => undefined)
      .result;
  }

  private createExecArgs(
    workspace: string,
    models: AiModelPreferences | undefined,
    purpose: AiModelPurpose,
  ): string[] {
    return this.withModelArg(
      ["exec", "-C", workspace, ...this.permissionArgs, "--skip-git-repo-check", "--json", "-"],
      models,
      purpose,
    );
  }

  private createResumeArgs(
    sessionId: string,
    models: AiModelPreferences | undefined,
    purpose: AiModelPurpose,
  ): string[] {
    return this.withModelArg(
      ["exec", "resume", sessionId, ...this.permissionArgs, "--skip-git-repo-check", "--json", "-"],
      models,
      purpose,
    );
  }

  private withModelArg(
    args: string[],
    models: AiModelPreferences | undefined,
    purpose: AiModelPurpose,
  ): string[] {
    const model = models?.[purpose]?.trim();
    const reasoningEffort = models?.reasoningEfforts?.[purpose];
    const argsWithReasoningEffort = this.withReasoningEffortArg(args, reasoningEffort);

    if (!model) {
      return argsWithReasoningEffort;
    }

    return [
      ...argsWithReasoningEffort.slice(0, -1),
      "--model",
      model,
      argsWithReasoningEffort.at(-1)!,
    ];
  }

  private withReasoningEffortArg(
    args: string[],
    reasoningEffort: AiReasoningEffort | undefined,
  ): string[] {
    if (!reasoningEffort) {
      return args;
    }

    return [
      ...args.slice(0, -1),
      "-c",
      `model_reasoning_effort="${reasoningEffort}"`,
      args.at(-1)!,
    ];
  }

  private startRun(
    expectedSessionId: string | undefined,
    args: string[],
    prompt: string,
    workspace: string,
    captureDiff: boolean,
    onEvent: (event: AiRunEvent) => void,
  ): AiRun {
    const sessionIdSignal = createDeferred<string>();
    let observedSessionId = expectedSessionId;
    const binaryConfig = this.binaryConfig;

    if (expectedSessionId) {
      sessionIdSignal.resolve(expectedSessionId);
      onEvent({ type: "session", sessionId: expectedSessionId });
    }

    const processRun = this.processRunner({
      command: binaryConfig.command,
      binaryConfig,
      args,
      cwd: workspace,
      input: prompt,
      timeoutMs: this.timeoutMs,
      captureDiff,
      diffService: this.diffService,
      onRawEvent: (event) => {
        const sessionId = extractThreadId([event]);

        if (sessionId && !observedSessionId) {
          observedSessionId = sessionId;
          sessionIdSignal.resolve(sessionId);
          onEvent({ type: "session", sessionId });
        }

        for (const text of extractResponseDeltas(event)) {
          onEvent({ type: "delta", text });
        }

        const traceEvent = toTraceEvent(event);

        if (traceEvent) {
          onEvent({ type: "raw", event: traceEvent });
        }
      },
    });
    const result = processRun.promise.then(
      async ({ content, beforeSnapshot, afterSnapshot, rawEvents }) => {
        const sessionId = expectedSessionId ?? observedSessionId ?? extractThreadId(rawEvents);

        if (!sessionId) {
          throw new Error(`${binaryConfig.displayName} did not return a thread id`);
        }

        sessionIdSignal.resolve(sessionId);

        const responseContent = this.resolveResponseContent(content, rawEvents);

        return {
          sessionId,
          content: responseContent,
          trace: formatTraceEvents(rawEvents),
          ...(captureDiff
            ? {
                gitDiff: {
                  baseCommit: beforeSnapshot.gitCommit,
                  beforeDiff: beforeSnapshot.diff,
                  afterDiff: afterSnapshot.diff,
                },
              }
            : {}),
          rawEvents,
        };
      },
    );

    result.catch((error: unknown) => {
      sessionIdSignal.reject(error);
    });

    return {
      sessionId: sessionIdSignal.promise,
      result,
      cancel: processRun.cancel,
    };
  }
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  // Non-streaming callers only await result; a startup failure rejects both.
  void promise.catch(() => undefined);

  return { promise, resolve, reject };
}

async function createAtomicReviewInputFiles(input: {
  diff: string;
  executionTrace: string;
}): Promise<{ directory: string; diffPath: string; executionTracePath: string }> {
  const directory = await mkdtemp(join(tmpdir(), "cui-atomic-review-"));
  const diffPath = join(directory, "round.diff");
  const executionTracePath = join(directory, "execution-trace.jsonl");

  await Promise.all([
    writeFile(diffPath, input.diff || "无", "utf8"),
    writeFile(executionTracePath, input.executionTrace || "无", "utf8"),
  ]);

  return { directory, diffPath, executionTracePath };
}

async function cleanupAtomicReviewInputFiles(directory: string): Promise<void> {
  await rm(directory, { force: true, recursive: true });
}
