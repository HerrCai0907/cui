export type RpcRequest = {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
};
export type RpcSocketContext = {
  url: string;
};

export async function withWebSocketRpcStub(
  respond: (request: RpcRequest, context: RpcSocketContext) => unknown,
  run: () => Promise<void>,
): Promise<void> {
  const originalWindow = globalThis.window;
  const originalWebSocket = globalThis.WebSocket;
  const sockets: MockWebSocket[] = [];

  class StubWebSocket extends MockWebSocket {
    constructor(url: string) {
      super(url, respond);
      sockets.push(this);
    }
  }

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: { href: "http://localhost:5173/", protocol: "http:" },
    },
  });
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    value: StubWebSocket,
  });

  try {
    await run();
  } finally {
    sockets.forEach((socket) => socket.close());
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
    Object.defineProperty(globalThis, "WebSocket", {
      configurable: true,
      value: originalWebSocket,
    });
  }
}

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  private readonly listeners = new Map<string, Set<(event: { data?: string }) => void>>();

  constructor(
    readonly url: string,
    private readonly respond: (request: RpcRequest, context: RpcSocketContext) => unknown,
  ) {
    queueMicrotask(() => {
      this.readyState = MockWebSocket.OPEN;
      this.dispatch("open");
    });
  }

  addEventListener(type: string, listener: (event: { data?: string }) => void): void {
    const listeners = this.listeners.get(type) ?? new Set<(event: { data?: string }) => void>();

    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  send(data: string): void {
    const request = JSON.parse(data) as RpcRequest;
    const result = this.respond(request, { url: this.url });

    queueMicrotask(() => {
      this.dispatch("message", {
        data: JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result,
        }),
      });
    });
  }

  close(): void {
    if (this.readyState === MockWebSocket.CLOSED) {
      return;
    }

    this.readyState = MockWebSocket.CLOSED;
    this.dispatch("close");
  }

  private dispatch(type: string, event: { data?: string } = {}): void {
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }
}
