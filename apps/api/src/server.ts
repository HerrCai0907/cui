import dotenv from "dotenv";
import { createApp } from "./app/createApp.js";
import { TraexModel } from "./infrastructure/ai/TraexModel.js";
import { CodexModel } from "./infrastructure/ai/CodexModel.js";
import { RoutingAiModel } from "./infrastructure/ai/RoutingAiModel.js";
import {
  assertAiHarnessBinaryAvailable,
  getAiHarnessBinaryConfig,
} from "./infrastructure/ai/aiBinary.js";
import { AppLogger } from "./infrastructure/logging/AppLogger.js";
import { SessionService } from "./domain/sessions/SessionService.js";
import { WorkerSessionStore } from "./infrastructure/store/WorkerSessionStore.js";
import { CodeQueryService } from "./domain/code/CodeQueryService.js";

dotenv.config();

const port = Number(process.env.PORT ?? 3000);
const logger = new AppLogger();
const aiModel = new RoutingAiModel({
  traex: new TraexModel(),
  codex: new CodexModel(),
});
const sessionStore = new WorkerSessionStore();
const sessionService = new SessionService(aiModel, sessionStore, logger);
const codeQueryService = new CodeQueryService();
const app = createApp({ logger, aiModel, sessionService, codeQueryService });
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

const harnessAvailability = await Promise.allSettled([
  assertAiHarnessBinaryAvailable(getAiHarnessBinaryConfig("traex")),
  assertAiHarnessBinaryAvailable(getAiHarnessBinaryConfig("codex")),
]);

if (harnessAvailability.every((result) => result.status === "rejected")) {
  const error = new Error(
    harnessAvailability
      .map((result) => (result.status === "rejected" ? String(result.reason) : ""))
      .filter(Boolean)
      .join(" "),
  );

  console.error(error);
  await logger.framework.error("server.ai_harness.unavailable", error);
  process.exit(1);
}

const server = app.listen(port);

server.on("listening", () => {
  console.log(`API listening on http://localhost:${port}`);
  void logger.framework.info("server.started", { port });
  void runStartupSessionMaintenance();
});

const sessionCleanupTimer = setInterval(() => {
  void deleteExpiredSessions();
}, SESSION_CLEANUP_INTERVAL_MS);

sessionCleanupTimer.unref();

server.on("error", (error) => {
  console.error("Failed to start API server", error);
  void logger.framework.error("server.start.failed", error).finally(() => {
    process.exitCode = 1;
    server.close();
  });
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    clearInterval(sessionCleanupTimer);
    server.close(() => {
      sessionStore.close();
      void logger.framework.info("server.stopped", { signal });
      process.exit(0);
    });
  });
}

async function deleteExpiredSessions(): Promise<void> {
  const cutoffIso = new Date(Date.now() - SESSION_TTL_MS).toISOString();

  try {
    const deletedSessionCount = await sessionStore.deleteExpiredSessions(cutoffIso);

    if (deletedSessionCount > 0) {
      await logger.framework.info("server.sessions.expired_deleted", {
        cutoffIso,
        deletedSessionCount,
      });
    }
  } catch (error) {
    console.error("Failed to delete expired sessions", error);
    await logger.framework.error("server.sessions.expiration_cleanup.failed", error);
  }
}

async function runStartupSessionMaintenance(): Promise<void> {
  await deleteExpiredSessions();

  try {
    await sessionService.resumeQueuedPrompts();
  } catch (error) {
    console.error("Failed to resume queued prompts", error);
    await logger.framework.error("server.queue_resume.failed", error);
  }
}
