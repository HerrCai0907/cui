import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import type { AiHarness } from "../../types.js";
import type { FormatTraceEventsOptions } from "./aiEvents.js";

type TraceEventsWorkerResponse =
  | {
      ok: true;
      value: string;
    }
  | {
      ok: false;
      error: {
        name?: string;
        message: string;
        stack?: string;
      };
    };

type RemoteErrorPayload = Extract<TraceEventsWorkerResponse, { ok: false }>["error"];

export function formatTraceEventsInWorker(
  events: unknown[],
  harness: AiHarness | undefined,
  options: FormatTraceEventsOptions,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(resolveWorkerPath(), {
      workerData: {
        events,
        harness,
        options,
      },
    });

    worker.once("message", (response: TraceEventsWorkerResponse) => {
      if (response.ok) {
        resolve(response.value);
        return;
      }

      reject(createRemoteError(response.error));
    });
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`Trace events worker exited with code ${code}`));
      }
    });
  });
}

function resolveWorkerPath(): URL {
  const currentPath = fileURLToPath(import.meta.url);
  const sourceWorkerPath = currentPath.replace(
    /formatTraceEventsInWorker\.(?:ts|js)$/,
    "TraceEventsWorker.ts",
  );
  const compiledWorkerPath = currentPath.replace(
    /formatTraceEventsInWorker\.(?:ts|js)$/,
    "TraceEventsWorker.js",
  );

  return pathToFileURL(existsSync(compiledWorkerPath) ? compiledWorkerPath : sourceWorkerPath);
}

function createRemoteError(error: RemoteErrorPayload): Error {
  const remoteError = new Error(error.message);

  remoteError.name = error.name ?? "Error";
  remoteError.stack = error.stack;

  return remoteError;
}
