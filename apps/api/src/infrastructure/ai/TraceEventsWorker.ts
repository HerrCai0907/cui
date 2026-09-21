import { parentPort, workerData } from "node:worker_threads";
import type { AiHarness } from "../../types.js";
import { formatTraceEvents, type FormatTraceEventsOptions } from "./aiEvents.js";

type TraceEventsWorkerData = {
  events: unknown[];
  harness?: AiHarness;
  options?: FormatTraceEventsOptions;
};

if (!parentPort) {
  throw new Error("TraceEventsWorker must run inside a worker thread");
}

const input = workerData as TraceEventsWorkerData;

try {
  parentPort.postMessage({
    ok: true,
    value: formatTraceEvents(input.events, input.harness, input.options),
  });
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error:
      error instanceof Error
        ? {
            name: error.name,
            message: error.message,
            stack: error.stack,
          }
        : {
            message: String(error),
          },
  });
}
