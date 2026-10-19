import { resolveApiWebSocketUrl } from "./apiBaseUrl";

type JsonRpcId = number;
type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};
type JsonRpcNotification = {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
};
type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  abort?: () => void;
};
type NotificationListener = (params: unknown) => void;
type ConnectionListener = () => void;

const RPC_PATH = "/api/v1/rpc";

let socket: WebSocket | null = null;
let socketPromise: Promise<WebSocket> | null = null;
let nextRequestId = 1;
const pendingRequests = new Map<JsonRpcId, PendingRequest>();
const notificationListeners = new Map<string, Set<NotificationListener>>();
const closeListeners = new Set<ConnectionListener>();

export type RpcRequestOptions = {
  signal?: AbortSignal;
};

export async function rpcRequest<T>(
  method: string,
  params?: unknown,
  options: RpcRequestOptions = {},
): Promise<T> {
  if (options.signal?.aborted) {
    throw new DOMException("Request aborted", "AbortError");
  }

  const client = await getRpcSocket();
  const id = nextRequestId++;

  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      pendingRequests.delete(id);
      reject(new DOMException("Request aborted", "AbortError"));
    };

    if (options.signal) {
      options.signal.addEventListener("abort", abort, { once: true });
    }

    pendingRequests.set(id, {
      resolve: (value) => resolve(value as T),
      reject,
      abort: options.signal ? () => options.signal?.removeEventListener("abort", abort) : undefined,
    });
    client.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params,
      }),
    );
  });
}

export function addRpcNotificationListener(
  method: string,
  listener: NotificationListener,
): () => void {
  const listeners = notificationListeners.get(method) ?? new Set<NotificationListener>();

  listeners.add(listener);
  notificationListeners.set(method, listeners);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      notificationListeners.delete(method);
    }
  };
}

export function addRpcCloseListener(listener: ConnectionListener): () => void {
  closeListeners.add(listener);

  return () => {
    closeListeners.delete(listener);
  };
}

async function getRpcSocket(): Promise<WebSocket> {
  if (socket?.readyState === WebSocket.OPEN) {
    return socket;
  }

  if (socketPromise) {
    return socketPromise;
  }

  socketPromise = new Promise<WebSocket>((resolve, reject) => {
    const client = new WebSocket(resolveApiWebSocketUrl(RPC_PATH));

    socket = client;
    client.addEventListener(
      "open",
      () => {
        socketPromise = null;
        resolve(client);
      },
      { once: true },
    );
    client.addEventListener("message", (event) => handleSocketMessage(event.data));
    client.addEventListener(
      "error",
      () => {
        if (client.readyState !== WebSocket.OPEN) {
          socketPromise = null;
          reject(new Error("RPC connection failed"));
        }
      },
      { once: true },
    );
    client.addEventListener("close", () => {
      if (socket === client) {
        socket = null;
      }
      socketPromise = null;
      rejectPendingRequests(new Error("RPC connection closed"));
      closeListeners.forEach((listener) => listener());
    });
  });

  return socketPromise;
}

function handleSocketMessage(rawData: unknown) {
  const message = parseRpcMessage(rawData);

  if (!message) {
    return;
  }

  if ("id" in message) {
    handleRpcResponse(message);
    return;
  }

  const listeners = notificationListeners.get(message.method);

  listeners?.forEach((listener) => listener(message.params));
}

function handleRpcResponse(message: JsonRpcResponse) {
  const pending = pendingRequests.get(message.id);

  if (!pending) {
    return;
  }

  pendingRequests.delete(message.id);
  pending.abort?.();

  if (message.error) {
    pending.reject(new Error(message.error.message || `RPC ${message.error.code}`));
    return;
  }

  pending.resolve(message.result);
}

function parseRpcMessage(rawData: unknown): JsonRpcResponse | JsonRpcNotification | undefined {
  try {
    const decoded = JSON.parse(String(rawData)) as unknown;

    if (!decoded || typeof decoded !== "object") {
      return undefined;
    }

    const message = decoded as Partial<JsonRpcResponse & JsonRpcNotification>;

    if (message.jsonrpc !== "2.0") {
      return undefined;
    }

    if (typeof message.id === "number") {
      return message as JsonRpcResponse;
    }

    if (typeof message.method === "string") {
      return message as JsonRpcNotification;
    }

    return undefined;
  } catch {
    return undefined;
  }
}

function rejectPendingRequests(reason: Error) {
  const requests = [...pendingRequests.values()];

  pendingRequests.clear();
  requests.forEach((request) => {
    request.abort?.();
    request.reject(reason);
  });
}
