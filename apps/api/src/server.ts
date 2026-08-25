import dotenv from "dotenv";
import { createApp } from "./app/createApp.js";
import { TraexModel } from "./infrastructure/ai/TraexModel.js";
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

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
  void logger.framework.info("server.started", { port });
});
