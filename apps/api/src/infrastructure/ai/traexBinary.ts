import { execFile } from "node:child_process";

export function getConfiguredTraexBinary(): string {
  return process.env.TRAEX_BIN?.trim() || "traex";
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
  await new Promise<void>((resolve, reject) => {
    execFile(command, ["--version"], { env: createTraexEnv() }, (error) => {
      if (!error) {
        resolve();
        return;
      }

      reject(isEnoentError(error) ? createTraexNotFoundError(command) : error);
    });
  });
}

export function createTraexNotFoundError(command = getConfiguredTraexBinary()): Error {
  const path = process.env.PATH?.trim() || "<empty>";

  return new Error(
    [
      `TraeX binary "${command}" was not found in the API process PATH.`,
      "CUI expects traex to be available before startup.",
      `API process PATH: ${path}`,
      "Start CUI from a shell where traex is on PATH, or set TRAEX_BIN to the absolute traex path.",
    ].join(" "),
  );
}

function isEnoentError(error: Error): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}
