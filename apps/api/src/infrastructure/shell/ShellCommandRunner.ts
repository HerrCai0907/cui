import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export type ShellCommandEvent =
  | {
      type: "started";
    }
  | {
      type: "output";
      text: string;
    };

export type ShellCommandResult = {
  output: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
};

export type ShellCommandRun = {
  result: Promise<ShellCommandResult>;
  cancel: () => void;
};

export class ShellCommandRunner {
  run(
    command: string,
    options: {
      cwd: string;
      onEvent: (event: ShellCommandEvent) => void;
    },
  ): ShellCommandRun {
    let child: ChildProcessWithoutNullStreams | undefined;
    let cancelled = false;
    let settled = false;
    let output = "";

    const result = new Promise<ShellCommandResult>((resolve, reject) => {
      try {
        const detached = process.platform !== "win32";

        child = spawn(process.env.SHELL ?? "/bin/sh", ["-lc", command], {
          cwd: options.cwd,
          detached,
          env: process.env,
        });
      } catch (error) {
        reject(error);
        return;
      }

      options.onEvent({ type: "started" });

      const appendOutput = (chunk: Buffer) => {
        const text = chunk.toString("utf8");

        output += text;
        options.onEvent({ type: "output", text });
      };

      child.stdout.on("data", appendOutput);
      child.stderr.on("data", appendOutput);
      child.on("error", (error) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      });
      child.on("close", (exitCode, signal) => {
        if (settled) {
          return;
        }

        settled = true;
        resolve({
          output,
          exitCode,
          signal: cancelled ? (signal ?? "SIGTERM") : signal,
        });
      });
    });

    return {
      result,
      cancel: () => {
        cancelled = true;
        if (child?.pid && process.platform !== "win32") {
          try {
            process.kill(-child.pid, "SIGTERM");
          } catch {
            child.kill("SIGTERM");
          }
          return;
        }

        child?.kill("SIGTERM");
      },
    };
  }
}
