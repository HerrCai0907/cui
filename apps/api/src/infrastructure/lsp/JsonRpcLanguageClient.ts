import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;

type JsonRpcId = number | string;
type JsonRpcMessage = {
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};
type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: NodeJS.Timeout;
};

export class LanguageServerProcessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LanguageServerProcessError";
  }
}

export class JsonRpcLanguageClient {
  private child?: ChildProcessWithoutNullStreams;
  private initialized?: Promise<void>;
  private nextId = 1;
  private stdoutBuffer = Buffer.alloc(0);
  private readonly pendingRequests = new Map<JsonRpcId, PendingRequest>();
  private stderrBuffer = "";

  constructor(
    private readonly input: {
      command: string;
      args?: string[];
      initializationOptions: Record<string, unknown>;
      initializeParams: Record<string, unknown>;
      requestTimeoutMs?: number;
    },
  ) {}

  async initialize(): Promise<void> {
    this.initialized ??= this.initializeProcess();
    await this.initialized;
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    await this.initialize();
    return this.sendRequest(method, params);
  }

  async notify(method: string, params?: unknown): Promise<void> {
    await this.initialize();
    this.sendNotification(method, params);
  }

  close(): void {
    const child = this.child;

    if (!child || child.killed) {
      return;
    }

    try {
      this.sendNotification("shutdown");
      this.sendNotification("exit");
    } catch {
      child.kill();
    }
  }

  private async initializeProcess(): Promise<void> {
    const child = spawn(this.input.command, this.input.args ?? [], {
      stdio: "pipe",
    });

    this.child = child;
    child.stdout.on("data", (chunk: Buffer) => this.readStdout(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      this.stderrBuffer = `${this.stderrBuffer}${chunk.toString("utf8")}`.slice(-4000);
    });
    child.on("error", (error) => this.rejectAll(error));
    child.on("exit", (code, signal) => {
      this.initialized = undefined;
      this.rejectAll(
        new LanguageServerProcessError(
          `${this.input.command} exited with code ${code ?? "none"} signal ${signal ?? "none"}${
            this.stderrBuffer.trim() ? `: ${this.stderrBuffer.trim()}` : ""
          }`,
        ),
      );
    });

    const initializeResult = await this.sendRequest("initialize", {
      ...this.input.initializeParams,
      initializationOptions: this.input.initializationOptions,
    });

    this.sendNotification("initialized", {});
    void initializeResult;
  }

  private sendRequest(method: string, params: unknown): Promise<unknown> {
    const child = this.assertProcess();
    const id = this.nextId++;
    const message = {
      jsonrpc: "2.0",
      id,
      method,
      ...(params === undefined ? {} : { params }),
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new LanguageServerProcessError(`${method} timed out`));
      }, this.input.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);

      timer.unref();
      this.pendingRequests.set(id, { resolve, reject, timer });
      child.stdin.write(encodeMessage(message));
    });
  }

  private sendNotification(method: string, params?: unknown): void {
    const child = this.assertProcess();
    const message = {
      jsonrpc: "2.0",
      method,
      ...(params === undefined ? {} : { params }),
    };

    child.stdin.write(encodeMessage(message));
  }

  private assertProcess(): ChildProcessWithoutNullStreams {
    if (!this.child || this.child.killed || !this.child.stdin.writable) {
      throw new LanguageServerProcessError(`${this.input.command} is not running`);
    }

    return this.child;
  }

  private readStdout(chunk: Buffer): void {
    this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk]);

    while (true) {
      const headerEnd = this.stdoutBuffer.indexOf("\r\n\r\n");

      if (headerEnd < 0) {
        return;
      }

      const header = this.stdoutBuffer.subarray(0, headerEnd).toString("ascii");
      const lengthMatch = /Content-Length:\s*(\d+)/i.exec(header);

      if (!lengthMatch) {
        this.stdoutBuffer = this.stdoutBuffer.subarray(headerEnd + 4);
        continue;
      }

      const contentLength = Number(lengthMatch[1]);
      const messageStart = headerEnd + 4;
      const messageEnd = messageStart + contentLength;

      if (this.stdoutBuffer.length < messageEnd) {
        return;
      }

      const rawMessage = this.stdoutBuffer.subarray(messageStart, messageEnd).toString("utf8");
      this.stdoutBuffer = this.stdoutBuffer.subarray(messageEnd);
      this.handleMessage(rawMessage);
    }
  }

  private handleMessage(rawMessage: string): void {
    let message: JsonRpcMessage;

    try {
      message = JSON.parse(rawMessage) as JsonRpcMessage;
    } catch {
      return;
    }

    if (message.id !== undefined && message.method) {
      this.respondToServerRequest(message.id, message.method);
      return;
    }

    if (message.id === undefined) {
      return;
    }

    const pending = this.pendingRequests.get(message.id);

    if (!pending) {
      return;
    }

    clearTimeout(pending.timer);
    this.pendingRequests.delete(message.id);

    if (message.error) {
      pending.reject(new LanguageServerProcessError(message.error.message));
      return;
    }

    pending.resolve(message.result);
  }

  private respondToServerRequest(id: JsonRpcId, method: string): void {
    const result = method === "workspace/configuration" ? [] : null;

    this.assertProcess().stdin.write(
      encodeMessage({
        jsonrpc: "2.0",
        id,
        result,
      }),
    );
  }

  private rejectAll(error: unknown): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pendingRequests.delete(id);
    }
  }
}

function encodeMessage(message: unknown): string {
  const body = JSON.stringify(message);
  const length = Buffer.byteLength(body, "utf8");

  return `Content-Length: ${length}\r\n\r\n${body}`;
}
