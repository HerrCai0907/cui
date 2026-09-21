import { parentPort, workerData } from "node:worker_threads";
import { SqliteSessionStore } from "./SqliteSessionStore.js";

type StoreWorkerRequest = {
  id: number;
  method: keyof SqliteSessionStore;
  args: unknown[];
};

type StoreWorkerResponse =
  | {
      id: number;
      ok: true;
      value: unknown;
    }
  | {
      id: number;
      ok: false;
      error: {
        name?: string;
        message: string;
        stack?: string;
      };
    };

if (!parentPort) {
  throw new Error("SqliteSessionStoreWorker must run inside a worker thread");
}

const store = new SqliteSessionStore(workerData?.databasePath);

parentPort.on("message", async (request: StoreWorkerRequest) => {
  try {
    const method = store[request.method];

    if (typeof method !== "function") {
      throw new Error(`Unknown session store method: ${String(request.method)}`);
    }

    const value = await Reflect.apply(method, store, request.args);
    const response: StoreWorkerResponse = {
      id: request.id,
      ok: true,
      value,
    };

    parentPort!.postMessage(response);
  } catch (error) {
    const response: StoreWorkerResponse = {
      id: request.id,
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
    };

    parentPort!.postMessage(response);
  }
});

parentPort.on("close", () => {
  store.close();
});
