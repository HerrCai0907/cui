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
    debug: (event: string, data?: unknown) =>
      this.write(this.frameworkLogFileName(), "debug", event, data),
    info: (event: string, data?: unknown) =>
      this.write(this.frameworkLogFileName(), "info", event, data),
    warn: (event: string, data?: unknown) =>
      this.write(this.frameworkLogFileName(), "warn", event, data),
    error: (event: string, data?: unknown) =>
      this.write(this.frameworkLogFileName(), "error", event, data),
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

  private frameworkLogFileName(): string {
    return `framework-${formatLocalDate(new Date())}.log`;
  }
}

function sanitizeFileSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_") || "unknown";
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
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
