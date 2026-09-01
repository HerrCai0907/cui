import dotenv from "dotenv";
import { createApp } from "./app/createApp.js";
import { TraexModel } from "./infrastructure/ai/TraexModel.js";
import {
  assertAiHarnessBinaryAvailable,
  getAiHarnessBinaryConfig,
} from "./infrastructure/ai/traexBinary.js";
import { AppLogger } from "./infrastructure/logging/AppLogger.js";
import { SessionService } from "./domain/sessions/SessionService.js";
import { JsonSessionStore } from "./infrastructure/store/JsonSessionStore.js";
import { CodeQueryService } from "./domain/code/CodeQueryService.js";

dotenv.config();

const port = Number(process.env.PORT ?? 3000);
const logger = new AppLogger();
const aiModel = new TraexModel();
const sessionService = new SessionService(aiModel, new JsonSessionStore(), logger);
const codeQueryService = new CodeQueryService();
const app = createApp({ logger, aiModel, sessionService, codeQueryService });

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
  void sessionService.resumeQueuedPrompts().catch((error: unknown) => {
    console.error("Failed to resume queued prompts", error);
    void logger.framework.error("server.queue_resume.failed", error);
  });
});

server.on("error", (error) => {
  console.error("Failed to start API server", error);
  void logger.framework.error("server.start.failed", error).finally(() => {
    process.exitCode = 1;
    server.close();
  });
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      void logger.framework.info("server.stopped", { signal });
      process.exit(0);
    });
  });
}
