import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitDiffService, type DiffSnapshot } from "../diff/GitDiffService.js";
import { parseJsonLine } from "./traexEvents.js";
import { AiRunCancelledError } from "../../types.js";
import { createTraexEnv, createTraexNotFoundError } from "./traexBinary.js";
import { isInvalidCwdError, PathNotFoundError } from "../../domain/paths/pathValidation.js";

type RunProcessInput = {
  command: string;
  args: string[];
  cwd: string;
  input: string;
  timeoutMs: number;
  captureDiff: boolean;
  diffService: GitDiffService;
  onRawEvent: (event: unknown) => void;
};

type RunProcessResult = {
  content: string;
  beforeSnapshot: DiffSnapshot;
  afterSnapshot: DiffSnapshot;
  rawEvents: unknown[];
};

export type TraexProcessRun = {
  promise: Promise<RunProcessResult>;
  cancel: () => void;
};

export function runTraexProcess({
  command,
  args,
  cwd,
  input,
  timeoutMs,
  captureDiff,
  diffService,
  onRawEvent,
}: RunProcessInput): TraexProcessRun {
  let child: ChildProcessWithoutNullStreams | undefined;
  let outputDir: string | undefined;
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

    return new Promise<RunProcessResult>((resolve, reject) => {
      const events: unknown[] = [];
      let outputPath: string | undefined;
      let stdout = "";
      let stderr = "";

      const rejectWithCancellation = () => {
        if (settled) {
          return;
        }

        cancelRequested = true;
        settled = true;
        if (idleTimer) {
          clearTimeout(idleTimer);
        }
        if (forcedKillTimer) {
          clearTimeout(forcedKillTimer);
        }
        killChildProcess(child);
        reject(new AiRunCancelledError());
        void cleanupOutputDir(outputDir);
      };

      mkdtemp(join(tmpdir(), "cui-traex-"))
        .then((createdOutputDir) => {
          outputDir = createdOutputDir;
          outputPath = join(createdOutputDir, "last-message.txt");
          const childArgs = [
            ...args.slice(0, -1),
            "--output-last-message",
            outputPath,
            args.at(-1)!,
          ];

          if (cancelRequested) {
            rejectWithCancellation();
            return;
          }

          try {
            child = spawn(command, childArgs, {
              cwd,
              detached: process.platform !== "win32",
              stdio: ["pipe", "pipe", "pipe"],
              env: createTraexEnv(),
            });
          } catch (error) {
            reject(createTraexProcessError(command, error, cwd));
            void cleanupOutputDir(outputDir);
            return;
          }

          const resetIdleTimer = () => {
            if (idleTimer) {
              clearTimeout(idleTimer);
            }
            idleTimer = setTimeout(() => {
              if (!settled) {
                settled = true;
                killChildProcess(child);
                reject(new Error(`TraeX command produced no output for ${timeoutMs}ms`));
                void cleanupOutputDir(outputDir);
              }
            }, timeoutMs);
          };

          resetIdleTimer();

          child.stdout.setEncoding("utf8");
          child.stderr.setEncoding("utf8");

          child.stdout.on("data", (chunk: string) => {
            resetIdleTimer();
            stdout += chunk;
            const lines = stdout.split("\n");
            stdout = lines.pop() ?? "";

            for (const line of lines) {
              const event = parseJsonLine(line);

              if (event) {
                events.push(event);
                onRawEvent(event);
              }
            }
          });

          child.stderr.on("data", (chunk: string) => {
            resetIdleTimer();
            stderr += chunk;
          });

          child.on("error", (error) => {
            if (!settled) {
              settled = true;
              if (idleTimer) {
                clearTimeout(idleTimer);
              }
              if (forcedKillTimer) {
                clearTimeout(forcedKillTimer);
              }
              reject(
                cancelRequested
                  ? new AiRunCancelledError()
                  : createTraexProcessError(command, error, cwd),
              );
              void cleanupOutputDir(outputDir);
            }
          });

          child.on("close", (code) => {
            if (settled) {
              return;
            }

            settled = true;
            if (idleTimer) {
              clearTimeout(idleTimer);
            }
            if (forcedKillTimer) {
              clearTimeout(forcedKillTimer);
            }

            if (cancelRequested) {
              reject(new AiRunCancelledError());
              void cleanupOutputDir(outputDir);
              return;
            }

            const trailingEvent = parseJsonLine(stdout);

            if (trailingEvent) {
              events.push(trailingEvent);
              onRawEvent(trailingEvent);
            }

            if (code !== 0) {
              reject(new Error(`TraeX command exited with ${code}: ${stderr.trim()}`));
              void cleanupOutputDir(outputDir);
              return;
            }

            readFile(outputPath!, "utf8")
              .catch(() => "")
              .then(async (content) => {
                const afterDiff = captureDiff
                  ? await diffService.captureWorkspaceDiff(cwd, beforeSnapshot.gitCommit)
                  : "";
                const afterSnapshot = {
                  gitCommit: beforeSnapshot.gitCommit,
                  diff: afterDiff,
                };

                resolve({
                  content,
                  beforeSnapshot,
                  afterSnapshot,
                  rawEvents: events,
                });
              })
              .finally(() => {
                void cleanupOutputDir(outputDir);
              });
          });

          child.stdin.end(input);
        })
        .catch((error: unknown) => {
          if (cancelRequested) {
            rejectWithCancellation();
          } else {
            reject(error);
          }
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

function createTraexProcessError(command: string, error: unknown, cwd: string): Error {
  if (isInvalidCwdError(error)) {
    return new PathNotFoundError(cwd);
  }

  if (!(error instanceof Error)) {
    return new Error("TraeX command failed");
  }

  if (isEnoentError(error)) {
    return createTraexNotFoundError(command);
  }

  return error;
}

function isEnoentError(error: Error): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function killChildProcess(
  child: ChildProcessWithoutNullStreams | undefined,
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

async function cleanupOutputDir(outputDir: string | undefined): Promise<void> {
  if (outputDir) {
    await rm(outputDir, { force: true, recursive: true });
  }
}
