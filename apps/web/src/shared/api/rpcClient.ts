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
type RpcChannel = "state" | "actions";
type RpcConnection = {
  path: string;
  socket: WebSocket | null;
  socketPromise: Promise<WebSocket> | null;
  pendingRequests: Map<JsonRpcId, PendingRequest>;
  closeListeners: Set<ConnectionListener>;
};

const RPC_PATHS: Record<RpcChannel, string> = {
  state: "/api/v1/rpc/state",
  actions: "/api/v1/rpc/actions",
};
const STATE_REFRESH_METHODS = new Set([
  "sessions.list",
  "sessions.get",
  "sessions.messages",
  "reviews.getRound",
  "reviews.getRoundDiffFilePage",
  "reviews.getAtomicDiffFilePage",
  "runs.subscribe",
  "runs.unsubscribe",
]);

const connections: Record<RpcChannel, RpcConnection> = {
  state: createRpcConnection(RPC_PATHS.state),
  actions: createRpcConnection(RPC_PATHS.actions),
};

let nextRequestId = 1;
const notificationListeners = new Map<string, Set<NotificationListener>>();

export type RpcRequestOptions = {
  signal?: AbortSignal;
  channel?: RpcChannel;
};

export async function rpcRequest<T>(
  method: string,
  params?: unknown,
  options: RpcRequestOptions = {},
): Promise<T> {
  if (options.signal?.aborted) {
    throw new DOMException("Request aborted", "AbortError");
  }

  const connection = getRpcConnection(options.channel ?? getDefaultRpcChannel(method));
  const client = await getRpcSocket(connection);
  const id = nextRequestId++;

  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      connection.pendingRequests.delete(id);
      reject(new DOMException("Request aborted", "AbortError"));
    };

    if (options.signal) {
      options.signal.addEventListener("abort", abort, { once: true });
    }

    connection.pendingRequests.set(id, {
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
  const connection = connections.state;

  connection.closeListeners.add(listener);

  return () => {
    connection.closeListeners.delete(listener);
  };
}

function createRpcConnection(path: string): RpcConnection {
  return {
    path,
    socket: null,
    socketPromise: null,
    pendingRequests: new Map(),
    closeListeners: new Set(),
  };
}

function getRpcConnection(channel: RpcChannel): RpcConnection {
  return connections[channel];
}

function getDefaultRpcChannel(method: string): RpcChannel {
  return STATE_REFRESH_METHODS.has(method) ? "state" : "actions";
}

async function getRpcSocket(connection: RpcConnection): Promise<WebSocket> {
  if (connection.socket?.readyState === WebSocket.OPEN) {
    return connection.socket;
  }

  if (connection.socketPromise) {
    return connection.socketPromise;
  }

  connection.socketPromise = new Promise<WebSocket>((resolve, reject) => {
    const client = new WebSocket(resolveApiWebSocketUrl(connection.path));

    connection.socket = client;
    client.addEventListener(
      "open",
      () => {
        connection.socketPromise = null;
        resolve(client);
      },
      { once: true },
    );
    client.addEventListener("message", (event) => handleSocketMessage(connection, event.data));
    client.addEventListener(
      "error",
      () => {
        if (client.readyState !== WebSocket.OPEN) {
          connection.socketPromise = null;
          reject(new Error("RPC connection failed"));
        }
      },
      { once: true },
    );
    client.addEventListener("close", () => {
      if (connection.socket === client) {
        connection.socket = null;
      }
      connection.socketPromise = null;
      rejectPendingRequests(connection, new Error("RPC connection closed"));
      connection.closeListeners.forEach((listener) => listener());
    });
  });

  return connection.socketPromise;
}

function handleSocketMessage(connection: RpcConnection, rawData: unknown) {
  const message = parseRpcMessage(rawData);

  if (!message) {
    return;
  }

  if ("id" in message) {
    handleRpcResponse(connection, message);
    return;
  }

  const listeners = notificationListeners.get(message.method);

  listeners?.forEach((listener) => listener(message.params));
}

function handleRpcResponse(connection: RpcConnection, message: JsonRpcResponse) {
  const pending = connection.pendingRequests.get(message.id);

  if (!pending) {
    return;
  }

  connection.pendingRequests.delete(message.id);
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

function rejectPendingRequests(connection: RpcConnection, reason: Error) {
  const requests = [...connection.pendingRequests.values()];

  connection.pendingRequests.clear();
  requests.forEach((request) => {
    request.abort?.();
    request.reject(reason);
  });
}
