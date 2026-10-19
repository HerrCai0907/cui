import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { GitDiffService } from "../diff/GitDiffService.js";
import type { AiModel } from "../../domain/ai/AiModel.js";
import type {
  AiAtomicDiffReviewInput,
  AiContinueSessionInput,
  AiCreateSessionInput,
  AiModelInfo,
  AiModelPreferences,
  AiModelPurpose,
  AiReasoningEffort,
  AiResponse,
  AiRun,
  AiRunEvent,
  AtomicDiffReview,
  ConversationSummary,
} from "../../types.js";
import { AiRunCancelledError } from "../../types.js";
import {
  createAiHarnessNotFoundError,
  createAiProcessEnv,
  getAiHarnessBinaryConfig,
  type AiHarnessBinaryConfig,
} from "./aiBinary.js";
import {
  createAtomicDiffReviewFormatCorrectionPrompt,
  createAtomicDiffReviewPrompt,
} from "./atomicDiffReviewPrompt.js";
import { parseAtomicDiffReviewItems } from "./atomicDiffReviewParser.js";
import { parseConversationSummary } from "./conversationSummaryParser.js";
import { isInvalidCwdError, PathNotFoundError } from "../../domain/paths/pathValidation.js";
import type { AiProcessRun } from "./aiProcess.js";

const DSH_REASONING_EFFORTS = ["none", "low", "high", "max"] as const;

export const DSH_MODELS: AiModelInfo[] = [
  {
    name: "deepseek-flash",
    provider: "deepseek-official",
    description: "DeepSeek Flash: default fast model for general agent tasks.",
    contextWindow: 1_000_000,
    defaultReasoningEffort: "high",
    supportedReasoningEfforts: [...DSH_REASONING_EFFORTS],
  },
  {
    name: "deepseek-v4-flash",
    provider: "deepseek-official",
    description: "DeepSeek V4 Flash: fast and economical text-only model.",
    contextWindow: 1_000_000,
    defaultReasoningEffort: "low",
    supportedReasoningEfforts: [...DSH_REASONING_EFFORTS],
  },
  {
    name: "deepseek-v4-pro",
    provider: "deepseek-official",
    description: "DeepSeek V4 Pro: stronger model for complex coding and reasoning.",
    contextWindow: 1_000_000,
    defaultReasoningEffort: "high",
    supportedReasoningEfforts: [...DSH_REASONING_EFFORTS],
  },
  {
    name: "deepseek-v4-flash-vision-exp",
    provider: "deepseek-official",
    description: "DeepSeek V4 Flash Vision Exp: fast multimodal model.",
    contextWindow: 1_000_000,
    defaultReasoningEffort: "low",
    supportedReasoningEfforts: [...DSH_REASONING_EFFORTS],
  },
];

export type DshProcessInput = {
  command: string;
  binaryConfig: AiHarnessBinaryConfig;
  args: string[];
  cwd: string;
  idleTimeoutMs?: number;
  captureDiff: boolean;
  diffService: GitDiffService;
  onRawEvent: (event: unknown) => void;
};

export type DshProcessRunner = (input: DshProcessInput) => AiProcessRun;

export type DshModelOptions = {
  binary?: string;
  diffService?: GitDiffService;
  processRunner?: DshProcessRunner;
  timeoutMs?: number;
};

export const DEFAULT_DSH_IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000;

export class DshModel implements AiModel {
  private readonly binaryConfig: AiHarnessBinaryConfig;
  private readonly diffService: GitDiffService;
  private readonly processRunner: DshProcessRunner;
  private readonly idleTimeoutMs: number;

  constructor(options: DshModelOptions = {}) {
    const config = getAiHarnessBinaryConfig("dsh");
    this.binaryConfig = { ...config, command: options.binary ?? config.command };
    this.diffService = options.diffService ?? new GitDiffService();
    this.processRunner = options.processRunner ?? runDshProcess;
    this.idleTimeoutMs = Number(
      options.timeoutMs ?? process.env.DSH_TIMEOUT_MS ?? DEFAULT_DSH_IDLE_TIMEOUT_MS,
    );
  }

  async listModels(): Promise<AiModelInfo[]> {
    return DSH_MODELS;
  }

  async createSession(input: AiCreateSessionInput): Promise<AiResponse> {
    return this.createSessionStream(input, () => undefined).result;
  }

  async continueSession(input: AiContinueSessionInput): Promise<AiResponse> {
    return this.continueSessionStream(input, () => undefined).result;
  }

  createSessionStream(input: AiCreateSessionInput, onEvent: (event: AiRunEvent) => void): AiRun {
    return this.startRun(
      undefined,
      input.workspace,
      input.prompt,
      input.models,
      "normal",
      true,
      onEvent,
    );
  }

  continueSessionStream(
    input: AiContinueSessionInput,
    onEvent: (event: AiRunEvent) => void,
  ): AiRun {
    return this.startRun(
      input.sessionId,
      input.workspace,
      input.prompt,
      input.models,
      "normal",
      true,
      onEvent,
    );
  }

  async summarizeConversation(input: AiCreateSessionInput): Promise<ConversationSummary> {
    const response = await this.startRun(
      undefined,
      input.workspace,
      input.prompt,
      input.models,
      "summary",
      false,
      () => undefined,
    ).result;

    return parseConversationSummary(response.content);
  }

  async createAtomicDiffReview(input: AiAtomicDiffReviewInput): Promise<AtomicDiffReview> {
    let response: AiResponse | undefined;
    const inputFiles = await createAtomicReviewInputFiles({
      diff: input.diff,
      executionTraceFilePath: input.executionTraceFilePath,
    });
    const reviewInput = {
      ...input,
      diffFilePath: inputFiles.diffPath,
      executionTraceFilePath: inputFiles.executionTracePath,
    };

    try {
      response = await this.startRun(
        undefined,
        input.workspace,
        createAtomicDiffReviewPrompt(reviewInput),
        input.models,
        "atomicReview",
        false,
        () => undefined,
      ).result;
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
          correctionResponse = await this.startRun(
            response.sessionId,
            input.workspace,
            createAtomicDiffReviewFormatCorrectionPrompt({
              validationError:
                error instanceof Error ? error.message : "Atomic diff review format was invalid",
              previousResponse: response.content,
              diffFilePath: inputFiles.diffPath,
            }),
            input.models,
            "atomicReview",
            false,
            () => undefined,
          ).result;
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
      await cleanupDirectory(inputFiles.directory);
    }
  }

  private startRun(
    expectedSessionId: string | undefined,
    workspace: string,
    prompt: string,
    models: AiModelPreferences | undefined,
    purpose: AiModelPurpose,
    captureDiff: boolean,
    onEvent: (event: AiRunEvent) => void,
  ): AiRun {
    const sessionId = expectedSessionId ?? `dsh-${randomUUID()}`;
    const sessionIdSignal = Promise.resolve(sessionId);
    let patchDirectory: string | undefined;
    let cancelled = false;
    let cancelRun: (() => void) | undefined;

    onEvent({ type: "session", sessionId });

    const runPromise = (async () => {
      const argsResult = await this.createArgs(prompt, models, purpose);
      patchDirectory = argsResult.patchDirectory;

      if (cancelled) {
        await cleanupDirectory(patchDirectory);
        throw new AiRunCancelledError();
      }

      const processRun = this.processRunner({
        command: this.binaryConfig.command,
        binaryConfig: this.binaryConfig,
        args: argsResult.args,
        cwd: workspace,
        idleTimeoutMs: this.idleTimeoutMs,
        captureDiff,
        diffService: this.diffService,
        onRawEvent: (event) => {
          onEvent({ type: "raw", event: normalizeDshRawEvent(event) });
        },
      });
      cancelRun = processRun.cancel;

      return processRun.promise
        .then(({ content, beforeSnapshot, afterSnapshot, rawEventCount }) => {
          const responseContent = content.trim();

          if (!responseContent) {
            throw new Error("DSH did not return an assistant message");
          }

          onEvent({ type: "delta", text: responseContent });

          return {
            sessionId,
            content: responseContent,
            ...(captureDiff
              ? {
                  gitDiff: {
                    baseCommit: beforeSnapshot.gitCommit,
                    beforeDiff: beforeSnapshot.diff,
                    afterDiff: afterSnapshot.diff,
                  },
                }
              : {}),
            rawEventCount,
          };
        })
        .finally(() => {
          void cleanupDirectory(patchDirectory);
        });
    })();

    const result = new Promise<AiResponse>((resolve, reject) => {
      runPromise
        .then((value) => resolve(value))
        .catch((error: unknown) => reject(cancelled ? new AiRunCancelledError() : error));
    });

    void runPromise.then(
      () => undefined,
      () => undefined,
    );

    return {
      sessionId: sessionIdSignal,
      result,
      cancel: () => {
        cancelled = true;
        cancelRun?.();
      },
    };
  }

  private async createArgs(
    prompt: string,
    models: AiModelPreferences | undefined,
    purpose: AiModelPurpose,
  ): Promise<{ args: string[]; patchDirectory?: string }> {
    const model = models?.[purpose]?.trim();
    const reasoningEffort = toDshReasoningEffort(models?.reasoningEfforts?.[purpose]);
    const patch = createDshPatch(model, reasoningEffort);

    if (!patch) {
      return { args: ["--profile", "headless", prompt] };
    }

    const patchDirectory = await mkdtemp(join(tmpdir(), "cui-dsh-"));
    const patchPath = join(patchDirectory, "model.patch.yml");

    await writeFile(patchPath, patch, "utf8");

    return {
      args: ["--profile", "headless", "--patch", patchPath, prompt],
      patchDirectory,
    };
  }
}

export function runDshProcess({
  command,
  binaryConfig,
  args,
  cwd,
  idleTimeoutMs,
  captureDiff,
  diffService,
  onRawEvent,
}: DshProcessInput): AiProcessRun {
  let child: ChildProcessByStdio<null, Readable, Readable> | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let forcedKillTimer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  let cancelRequested = false;

  const promise = (async () => {
    const beforeSnapshot = captureDiff
      ? await diffService.captureWorkspaceSnapshot(cwd)
      : { gitCommit: "", diff: "" };

    if (cancelRequested) {
      throw new AiRunCancelledError();
    }

    return new Promise<{
      content: string;
      beforeSnapshot: Awaited<ReturnType<GitDiffService["captureWorkspaceSnapshot"]>>;
      afterSnapshot: Awaited<ReturnType<GitDiffService["captureWorkspaceSnapshot"]>>;
      rawEventCount: number;
    }>((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let rawEventCount = 0;

      try {
        child = spawn(command, args, {
          cwd,
          detached: process.platform !== "win32",
          stdio: ["ignore", "pipe", "pipe"],
          env: createAiProcessEnv(),
        });
      } catch (error) {
        reject(createDshProcessError(binaryConfig, error, cwd));
        return;
      }

      const resetIdleTimer = () => {
        if (settled || idleTimeoutMs === undefined) {
          return;
        }
        if (idleTimer) {
          clearTimeout(idleTimer);
        }
        idleTimer = setTimeout(() => {
          if (!settled) {
            settled = true;
            killChildProcess(child);
            reject(
              new Error(
                `${binaryConfig.displayName} command produced no output for ${idleTimeoutMs}ms`,
              ),
            );
          }
        }, idleTimeoutMs);
      };

      resetIdleTimer();

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");

      child.stdout.on("data", (chunk: string) => {
        resetIdleTimer();
        stdout += chunk;
      });

      child.stderr.on("data", (chunk: string) => {
        resetIdleTimer();
        stderr += chunk;
        rawEventCount += 1;
        onRawEvent({ type: "stdout", text: chunk });
      });

      child.on("error", (error) => {
        if (!settled) {
          settled = true;
          clearRunTimers(idleTimer, forcedKillTimer);
          reject(
            cancelRequested
              ? new AiRunCancelledError()
              : createDshProcessError(binaryConfig, error, cwd),
          );
        }
      });

      child.on("close", (code, signal) => {
        if (settled) {
          return;
        }

        settled = true;
        clearRunTimers(idleTimer, forcedKillTimer);

        if (cancelRequested) {
          reject(new AiRunCancelledError());
          return;
        }

        if (code !== 0) {
          reject(
            new Error(
              `${binaryConfig.displayName} command failed (${signal || code}): ${formatDshFailure(stderr)}`,
            ),
          );
          return;
        }

        Promise.resolve(
          captureDiff ? diffService.captureWorkspaceDiff(cwd, beforeSnapshot.gitCommit) : "",
        )
          .then((afterDiff) => {
            resolve({
              content: stdout,
              beforeSnapshot,
              afterSnapshot: {
                gitCommit: beforeSnapshot.gitCommit,
                diff: afterDiff,
              },
              rawEventCount,
            });
          })
          .catch(reject);
      });
    });
  })();

  return {
    promise,
    cancel: () => {
      cancelRequested = true;
      killChildProcess(child);
      forcedKillTimer = setTimeout(() => {
        killChildProcess(child, "SIGKILL");
      }, 3000);
      forcedKillTimer.unref();
    },
  };
}

function createDshPatch(
  model: string | undefined,
  reasoningEffort: string | undefined,
): string | undefined {
  const entries: string[] = [];

  if (model) {
    entries.push(
      [
        "- id: agent-default-model",
        "  config:",
        "    provider: deepseek-official",
        `    model: ${JSON.stringify(model)}`,
      ].join("\n"),
    );
  }

  if (reasoningEffort) {
    entries.push(
      [
        "- id: llm-deepseek",
        "  config:",
        `    reasoningEffort: ${JSON.stringify(reasoningEffort)}`,
      ].join("\n"),
    );
  }

  return entries.length ? `${entries.join("\n")}\n` : undefined;
}

function toDshReasoningEffort(reasoningEffort: AiReasoningEffort | undefined): string | undefined {
  if (!reasoningEffort) {
    return undefined;
  }

  if (reasoningEffort === "none") {
    return "off";
  }

  return DSH_REASONING_EFFORTS.includes(reasoningEffort as (typeof DSH_REASONING_EFFORTS)[number])
    ? reasoningEffort
    : undefined;
}

function normalizeDshRawEvent(event: unknown): { type: "stdout"; text: string; raw: unknown } {
  const text =
    event && typeof event === "object" && "text" in event && typeof event.text === "string"
      ? event.text
      : "";

  return {
    type: "stdout",
    text,
    raw: event,
  };
}

async function createAtomicReviewInputFiles(input: {
  diff: string;
  executionTraceFilePath?: string;
}): Promise<{ directory: string; diffPath: string; executionTracePath: string }> {
  const directory = await mkdtemp(join(tmpdir(), "cui-atomic-review-"));
  const diffPath = join(directory, "round.diff");
  const executionTracePath =
    input.executionTraceFilePath ?? join(directory, "execution-trace.jsonl");

  await writeFile(diffPath, input.diff || "无", "utf8");
  if (!input.executionTraceFilePath) {
    await writeFile(executionTracePath, "无", "utf8");
  }

  return { directory, diffPath, executionTracePath };
}

async function cleanupDirectory(directory: string | undefined): Promise<void> {
  if (directory) {
    await rm(directory, { force: true, recursive: true });
  }
}

function formatDshFailure(stderr: string): string {
  const message = stderr.trim() || "No error details returned";

  if (/MISSING_CREDENTIAL|no API key|DEEPSEEK_API_KEY/i.test(message)) {
    return [
      "DSH requires a DeepSeek API token.",
      "Set DEEPSEEK_API_KEY in the API process environment or store it in DSH credentials.",
      message,
    ].join(" ");
  }

  return message;
}

function createDshProcessError(
  binaryConfig: AiHarnessBinaryConfig,
  error: unknown,
  cwd: string,
): Error {
  if (isInvalidCwdError(error)) {
    return new PathNotFoundError(cwd);
  }

  if (!(error instanceof Error)) {
    return new Error(`${binaryConfig.displayName} command failed`);
  }

  if ((error as NodeJS.ErrnoException).code === "ENOENT") {
    return createAiHarnessNotFoundError(binaryConfig);
  }

  return error;
}

function clearRunTimers(
  idleTimer: ReturnType<typeof setTimeout> | undefined,
  forcedKillTimer: ReturnType<typeof setTimeout> | undefined,
): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
  }
  if (forcedKillTimer) {
    clearTimeout(forcedKillTimer);
  }
}

function killChildProcess(
  child: ChildProcessByStdio<null, Readable, Readable> | undefined,
  signal: NodeJS.Signals = "SIGTERM",
): void {
  if (!child?.pid) {
    return;
  }

  try {
    if (process.platform !== "win32") {
      process.kill(-child.pid, signal);
      return;
    }
  } catch {
    // Fall back to the direct child if process-group termination is unavailable.
  }

  child.kill(signal);
}
