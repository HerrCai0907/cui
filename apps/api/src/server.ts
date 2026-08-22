import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import { TraexModel } from './ai/traexModel.js';
import { AppLogger } from './logging/logger.js';
import {
  SessionBusyError,
  SessionNotFoundError,
  SessionService,
  TurnStreamEvent,
} from './services/sessionService.js';
import { JsonSessionStore } from './store/jsonSessionStore.js';

dotenv.config();

const app = express();
const port = Number(process.env.PORT ?? 3000);
const logger = new AppLogger();
const sessionService = new SessionService(
  new TraexModel(),
  new JsonSessionStore(),
  logger,
);

app.use(cors());
app.use(express.json());
app.use((request, response, next) => {
  const start = performance.now();

  response.on('finish', () => {
    void logger.framework.info('http.request', {
      method: request.method,
      path: request.path,
      statusCode: response.statusCode,
      durationMs: Math.round(performance.now() - start),
    });
  });

  next();
});

app.get('/api/health', (_request, response) => {
  response.json({
    status: 'ok',
    service: '@cui/api',
    time: new Date().toISOString(),
  });
});

app.get('/api/sessions', async (_request, response, next) => {
  try {
    response.json({ sessions: await sessionService.listSessionViews() });
  } catch (error) {
    next(error);
  }
});

app.get('/api/sessions/:sessionId', async (request, response, next) => {
  try {
    const session = await sessionService.getSessionView(
      request.params.sessionId,
    );

    if (!session) {
      response.status(404).json({ error: 'Session not found' });
      return;
    }

    response.json({ session });
  } catch (error) {
    next(error);
  }
});

app.get(
  '/api/sessions/:sessionId/rounds/:round/review',
  async (request, response, next) => {
    try {
      const round = Number(request.params.round);

      if (!Number.isInteger(round) || round < 1) {
        response
          .status(400)
          .json({ error: 'round must be a positive integer' });
        return;
      }

      const review = await sessionService.getRoundReview(
        request.params.sessionId,
        round,
      );

      if (!review) {
        response.status(404).json({ error: 'Round review not found' });
        return;
      }

      response.json({ review });
    } catch (error) {
      next(error);
    }
  },
);

app.post('/api/sessions', async (request, response, next) => {
  try {
    const parsed = parseCreateSessionBody(request.body);

    if (!parsed.ok) {
      response.status(400).json({ error: parsed.error });
      return;
    }

    const submittedTurn = await sessionService.beginCreateSession(parsed.value);
    response.status(202).json({ status: 'ok', ...submittedTurn });
  } catch (error) {
    next(error);
  }
});

app.post(
  '/api/sessions/:sessionId/messages',
  async (request, response, next) => {
    try {
      const prompt = parsePrompt(request.body);

      if (!prompt) {
        response
          .status(400)
          .json({ error: 'prompt must be a non-empty string' });
        return;
      }

      const submittedTurn = await sessionService.beginContinueSession(
        request.params.sessionId,
        { prompt },
      );
      response.status(202).json({ status: 'ok', ...submittedTurn });
    } catch (error) {
      next(error);
    }
  },
);

app.get('/api/turns/:turnId/events', (request, response) => {
  if (!sessionService.hasRunningTurn(request.params.turnId)) {
    response.status(404).json({ error: 'Turn not found' });
    return;
  }

  response.writeHead(200, {
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Content-Type': 'text/event-stream',
    'X-Accel-Buffering': 'no',
  });
  response.flushHeaders?.();

  const unsubscribe = sessionService.subscribeToTurn(
    request.params.turnId,
    (event) => {
      writeSse(response, event.type, event);

      if (event.type === 'done' || event.type === 'failed') {
        response.end();
      }
    },
  );

  request.on('close', unsubscribe);
});

app.use(
  (
    error: unknown,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error(error);
    void logger.framework.error('http.error', {
      method: _request.method,
      path: _request.path,
      error,
    });

    if (error instanceof SessionNotFoundError) {
      response.status(404).json({ error: 'Session not found' });
      return;
    }

    if (error instanceof SessionBusyError) {
      response
        .status(409)
        .json({ error: 'Session already has a running turn' });
      return;
    }

    response.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  },
);

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
  void logger.framework.info('server.started', { port });
});

type ParsedBody<T> = { ok: true; value: T } | { ok: false; error: string };

function parseCreateSessionBody(
  body: unknown,
): ParsedBody<{ workspace: string; prompt: string }> {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'body must be an object' };
  }

  const workspace = 'workspace' in body ? body.workspace : undefined;
  const prompt = 'prompt' in body ? body.prompt : undefined;

  if (typeof workspace !== 'string' || !workspace.trim()) {
    return { ok: false, error: 'workspace must be a non-empty string' };
  }

  if (typeof prompt !== 'string' || !prompt.trim()) {
    return { ok: false, error: 'prompt must be a non-empty string' };
  }

  return {
    ok: true,
    value: {
      workspace: workspace.trim(),
      prompt: prompt.trim(),
    },
  };
}

function parsePrompt(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') {
    return undefined;
  }

  const prompt = 'prompt' in body ? body.prompt : undefined;

  if (typeof prompt !== 'string' || !prompt.trim()) {
    return undefined;
  }

  return prompt.trim();
}

function writeSse(
  response: express.Response,
  eventName: string,
  event: TurnStreamEvent,
): void {
  response.write(`event: ${eventName}\n`);
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}
