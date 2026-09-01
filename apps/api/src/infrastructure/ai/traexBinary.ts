import { execFile } from "node:child_process";
import type { AiHarness } from "../../types.js";

export type AiHarnessBinaryConfig = {
  harness: AiHarness;
  command: string;
  displayName: string;
  envVar: string;
};

export function getConfiguredTraexBinary(): string {
  return process.env.TRAEX_BIN?.trim() || "traex";
}

export function getConfiguredCodexBinary(): string {
  return process.env.CODEX_BIN?.trim() || "codex";
}

export function getAiHarnessBinaryConfig(harness: AiHarness): AiHarnessBinaryConfig {
  if (harness === "codex") {
    return {
      harness,
      command: getConfiguredCodexBinary(),
      displayName: "Codex",
      envVar: "CODEX_BIN",
    };
  }

  return {
    harness,
    command: getConfiguredTraexBinary(),
    displayName: "TraeX",
    envVar: "TRAEX_BIN",
  };
}

export function createTraexEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NO_COLOR: "1",
    FORCE_COLOR: "0",
  };
}

export async function assertTraexBinaryAvailable(
  command = getConfiguredTraexBinary(),
): Promise<void> {
  await assertAiHarnessBinaryAvailable({
    harness: "traex",
    command,
    displayName: "TraeX",
    envVar: "TRAEX_BIN",
  });
}

export async function assertAiHarnessBinaryAvailable(config: AiHarnessBinaryConfig): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFile(config.command, ["--version"], { env: createTraexEnv() }, (error) => {
      if (!error) {
        resolve();
        return;
      }

      reject(isEnoentError(error) ? createAiHarnessNotFoundError(config) : error);
    });
  });
}

export function createTraexNotFoundError(command = getConfiguredTraexBinary()): Error {
  return createAiHarnessNotFoundError({
    harness: "traex",
    command,
    displayName: "TraeX",
    envVar: "TRAEX_BIN",
  });
}

export function createAiHarnessNotFoundError(config: AiHarnessBinaryConfig): Error {
  const path = process.env.PATH?.trim() || "<empty>";

  return new Error(
    [
      `${config.displayName} binary "${config.command}" was not found in the API process PATH.`,
      `CUI expects ${config.harness} to be available before using that AI harness.`,
      `API process PATH: ${path}`,
      `Start CUI from a shell where ${config.harness} is on PATH, or set ${config.envVar} to the absolute ${config.harness} path.`,
    ].join(" "),
  );
}

function isEnoentError(error: Error): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}
