import { appendFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

type LogLevel = "debug" | "info" | "warn" | "error";

type LogEntry = {
  time: string;
  level: LogLevel;
  event: string;
  data?: unknown;
};

export class AppLogger {
  private readonly logDir: string;

  constructor(logDir = process.env.CUI_LOG_DIR ?? "logs") {
    this.logDir = resolve(process.cwd(), logDir);
  }

  framework = {
    debug: (event: string, data?: unknown) => this.write("framework.log", "debug", event, data),
    info: (event: string, data?: unknown) => this.write("framework.log", "info", event, data),
    warn: (event: string, data?: unknown) => this.write("framework.log", "warn", event, data),
    error: (event: string, data?: unknown) => this.write("framework.log", "error", event, data),
  };

  session(sessionId: string) {
    const fileName = `session-${sanitizeFileSegment(sessionId)}.log`;

    return {
      debug: (event: string, data?: unknown) => this.write(fileName, "debug", event, data),
      info: (event: string, data?: unknown) => this.write(fileName, "info", event, data),
      warn: (event: string, data?: unknown) => this.write(fileName, "warn", event, data),
      error: (event: string, data?: unknown) => this.write(fileName, "error", event, data),
    };
  }

  private async write(
    fileName: string,
    level: LogLevel,
    event: string,
    data?: unknown,
  ): Promise<void> {
    try {
      const entry: LogEntry = {
        time: new Date().toISOString(),
        level,
        event,
        data: normalizeLogData(data),
      };

      await mkdir(this.logDir, { recursive: true });
      await appendFile(resolve(this.logDir, fileName), `${JSON.stringify(entry)}\n`, "utf8");
    } catch (error) {
      console.error("Failed to write log entry", error);
    }
  }
}

function sanitizeFileSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_") || "unknown";
}

function normalizeLogData(data: unknown): unknown {
  if (data instanceof Error) {
    return {
      name: data.name,
      message: data.message,
      stack: data.stack,
    };
  }

  if (Array.isArray(data)) {
    return data.map((item) => normalizeLogData(item));
  }

  if (data && typeof data === "object") {
    return Object.fromEntries(
      Object.entries(data).map(([key, value]) => [key, normalizeLogData(value)]),
    );
  }

  return data;
}
