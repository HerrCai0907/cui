import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitDiffService } from "../diff/GitDiffService.js";
import {
  AiReasoningEffort,
  AiAtomicDiffReviewInput,
  AiContinueSessionInput,
  AiCreateSessionInput,
  AiModel,
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
import {
  createTraexEnv,
  createTraexNotFoundError,
  getConfiguredTraexBinary,
} from "./traexBinary.js";
import { extractResponseDeltas, extractThreadId, formatRawEvents } from "./traexEvents.js";
import { runTraexProcess, type TraexProcessRun } from "./traexProcess.js";

type TraexProcessRunner = (input: Parameters<typeof runTraexProcess>[0]) => TraexProcessRun;
type TraexModelListRunner = () => Promise<unknown>;

type TraexModelOptions = {
  binary?: string;
  diffService?: GitDiffService;
  modelListRunner?: TraexModelListRunner;
  permissionMode?: string;
  processRunner?: TraexProcessRunner;
  timeoutMs?: number;
};

export class TraexModel implements AiModel {
  private readonly binary: string;
  private readonly diffService: GitDiffService;
  private readonly modelListRunner: TraexModelListRunner;
  private readonly permissionMode: string;
  private readonly processRunner: TraexProcessRunner;
  private readonly timeoutMs: number;

  constructor(options: TraexModelOptions = {}) {
    this.binary = options.binary ?? getConfiguredTraexBinary();
    this.diffService = options.diffService ?? new GitDiffService();
    this.modelListRunner =
      options.modelListRunner ?? (() => execFileJson(this.binary, ["models", "--json"]));
    this.permissionMode =
      options.permissionMode ?? process.env.TRAEX_PERMISSION_MODE ?? "bypass_permissions";
    this.processRunner = options.processRunner ?? runTraexProcess;
    this.timeoutMs = Number(options.timeoutMs ?? process.env.TRAEX_TIMEOUT_MS ?? 10 * 60 * 1000);
  }

  async listModels(): Promise<AiModelInfo[]> {
    const rawModels = await this.modelListRunner();

    if (!Array.isArray(rawModels)) {
      throw new Error("TraeX models output was not an array");
    }

    return rawModels.map(parseTraexModelInfo).filter((model) => model.name);
  }

  async createSession(input: AiCreateSessionInput): Promise<AiResponse> {
    const args = this.createExecArgs(input.workspace, input.models, "normal");

    return this.run(undefined, args, input.prompt, input.workspace);
  }

  createSessionStream(input: AiCreateSessionInput, onEvent: (event: AiRunEvent) => void): AiRun {
    const args = this.createExecArgs(input.workspace, input.models, "normal");

    return this.startRun(undefined, args, input.prompt, input.workspace, true, onEvent);
  }

  async continueSession(input: AiContinueSessionInput): Promise<AiResponse> {
    const args = this.createResumeArgs(input.sessionId, input.models, "normal");

    return this.run(input.sessionId, args, input.prompt, input.workspace);
  }

  async summarizeConversation(input: AiCreateSessionInput): Promise<ConversationSummary> {
    const args = this.createExecArgs(input.workspace, input.models, "summary");
    const response = await this.run(undefined, args, input.prompt, input.workspace, false);

    return parseConversationSummary(response.content);
  }

  async createAtomicDiffReview(input: AiAtomicDiffReviewInput): Promise<AtomicDiffReview> {
    const createArgs = this.createExecArgs(input.workspace, input.models, "atomicReview");
    let response: AiResponse | undefined;
    const diffFile = await createAtomicReviewDiffFile(input.diff);
    const reviewInput = {
      ...input,
      diffFilePath: diffFile.path,
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
              diffFilePath: diffFile.path,
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
      await cleanupAtomicReviewDiffFile(diffFile.directory);
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
      [
        "exec",
        "-C",
        workspace,
        "--permission-mode",
        this.permissionMode,
        "--skip-git-repo-check",
        "--json",
        "-",
      ],
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
      [
        "exec",
        "resume",
        sessionId,
        "--permission-mode",
        this.permissionMode,
        "--skip-git-repo-check",
        "--json",
        "-",
      ],
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

function execFileJson(command: string, args: string[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { env: createTraexEnv() }, (error, stdout, stderr) => {
      if (error) {
        reject(createTraexModelsError(command, stderr, error));
        return;
      }

      try {
        resolve(JSON.parse(stdout));
      } catch (parseError) {
        reject(
          new Error(
            `TraeX models command returned invalid JSON: ${
              parseError instanceof Error ? parseError.message : "parse failed"
            }`,
          ),
        );
      }
    });
  });
}

function createTraexModelsError(command: string, stderr: string, error: Error): Error {
  if ((error as NodeJS.ErrnoException).code === "ENOENT") {
    return createTraexNotFoundError(command);
  }

  return new Error(`TraeX models command failed: ${stderr.trim() || error.message}`);
}

function parseTraexModelInfo(value: unknown): AiModelInfo {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { name: "" };
  }

  const record = value as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const provider = typeof record.provider === "string" ? record.provider.trim() : undefined;
  const description =
    typeof record.description === "string" ? record.description.trim() : undefined;
  const contextWindow =
    typeof record.context_window === "number" && Number.isFinite(record.context_window)
      ? record.context_window
      : undefined;

  return {
    name,
    ...(provider ? { provider } : {}),
    ...(description ? { description } : {}),
    ...(contextWindow ? { contextWindow } : {}),
  };
}

async function createAtomicReviewDiffFile(
  diff: string,
): Promise<{ directory: string; path: string }> {
  const directory = await mkdtemp(join(tmpdir(), "cui-atomic-review-"));
  const path = join(directory, "round.diff");

  await writeFile(path, diff || "无", "utf8");

  return { directory, path };
}

async function cleanupAtomicReviewDiffFile(directory: string): Promise<void> {
  await rm(directory, { force: true, recursive: true });
}
