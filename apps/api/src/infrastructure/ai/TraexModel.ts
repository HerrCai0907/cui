import { GitDiffService } from "../diff/GitDiffService.js";
import {
  AiAtomicDiffReviewInput,
  AiContinueSessionInput,
  AiCreateSessionInput,
  AiModel,
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
import { extractResponseDeltas, extractThreadId, formatRawEvents } from "./traexEvents.js";
import { runTraexProcess, type TraexProcessRun } from "./traexProcess.js";

type TraexProcessRunner = (input: Parameters<typeof runTraexProcess>[0]) => TraexProcessRun;

type TraexModelOptions = {
  binary?: string;
  diffService?: GitDiffService;
  permissionMode?: string;
  processRunner?: TraexProcessRunner;
  timeoutMs?: number;
};

export class TraexModel implements AiModel {
  private readonly binary: string;
  private readonly diffService: GitDiffService;
  private readonly permissionMode: string;
  private readonly processRunner: TraexProcessRunner;
  private readonly timeoutMs: number;

  constructor(options: TraexModelOptions = {}) {
    this.binary = options.binary ?? process.env.TRAEX_BIN ?? "traecli";
    this.diffService = options.diffService ?? new GitDiffService();
    this.permissionMode =
      options.permissionMode ?? process.env.TRAEX_PERMISSION_MODE ?? "bypass_permissions";
    this.processRunner = options.processRunner ?? runTraexProcess;
    this.timeoutMs = Number(options.timeoutMs ?? process.env.TRAEX_TIMEOUT_MS ?? 10 * 60 * 1000);
  }

  async createSession(input: AiCreateSessionInput): Promise<AiResponse> {
    const args = [
      "exec",
      "-C",
      input.workspace,
      "--permission-mode",
      this.permissionMode,
      "--skip-git-repo-check",
      "--json",
      "-",
    ];

    return this.run(undefined, args, input.prompt, input.workspace);
  }

  createSessionStream(input: AiCreateSessionInput, onEvent: (event: AiRunEvent) => void): AiRun {
    const args = [
      "exec",
      "-C",
      input.workspace,
      "--permission-mode",
      this.permissionMode,
      "--skip-git-repo-check",
      "--json",
      "-",
    ];

    return this.startRun(undefined, args, input.prompt, input.workspace, true, onEvent);
  }

  async continueSession(input: AiContinueSessionInput): Promise<AiResponse> {
    const args = [
      "exec",
      "resume",
      input.sessionId,
      "--permission-mode",
      this.permissionMode,
      "--skip-git-repo-check",
      "--json",
      "-",
    ];

    return this.run(input.sessionId, args, input.prompt, input.workspace);
  }

  async summarizeConversation(input: AiCreateSessionInput): Promise<ConversationSummary> {
    const args = [
      "exec",
      "-C",
      input.workspace,
      "--permission-mode",
      this.permissionMode,
      "--skip-git-repo-check",
      "--json",
      "-",
    ];
    const response = await this.run(undefined, args, input.prompt, input.workspace, false);

    return parseConversationSummary(response.content);
  }

  async createAtomicDiffReview(input: AiAtomicDiffReviewInput): Promise<AtomicDiffReview> {
    const createArgs = [
      "exec",
      "-C",
      input.workspace,
      "--permission-mode",
      this.permissionMode,
      "--skip-git-repo-check",
      "--json",
      "-",
    ];
    let response: AiResponse | undefined;

    try {
      response = await this.run(
        undefined,
        createArgs,
        createAtomicDiffReviewPrompt(input),
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
            this.createResumeArgs(response.sessionId),
            createAtomicDiffReviewFormatCorrectionPrompt({
              validationError:
                error instanceof Error ? error.message : "Atomic diff review format was invalid",
              previousResponse: response.content,
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
    }
  }

  continueSessionStream(
    input: AiContinueSessionInput,
    onEvent: (event: AiRunEvent) => void,
  ): AiRun {
    const args = [
      "exec",
      "resume",
      input.sessionId,
      "--permission-mode",
      this.permissionMode,
      "--skip-git-repo-check",
      "--json",
      "-",
    ];

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

  private createResumeArgs(sessionId: string): string[] {
    return [
      "exec",
      "resume",
      sessionId,
      "--permission-mode",
      this.permissionMode,
      "--skip-git-repo-check",
      "--json",
      "-",
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

    if (expectedSessionId) {
      sessionIdSignal.resolve(expectedSessionId);
      onEvent({ type: "session", sessionId: expectedSessionId });
    }

    const processRun = this.processRunner({
      command: this.binary,
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

        onEvent({ type: "raw", event });
      },
    });
    const result = processRun.promise.then(
      async ({ content, beforeSnapshot, afterSnapshot, rawEvents }) => {
        const sessionId = expectedSessionId ?? observedSessionId ?? extractThreadId(rawEvents);

        if (!sessionId) {
          throw new Error("TraeX did not return a thread id");
        }

        sessionIdSignal.resolve(sessionId);

        return {
          sessionId,
          content: content.trim(),
          trace: formatRawEvents(rawEvents),
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

  return { promise, resolve, reject };
}
