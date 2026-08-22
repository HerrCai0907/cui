import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AiContinueSessionInput,
  AiCreateSessionInput,
  AiModel,
  AiResponse,
  AiRun,
  AiRunEvent,
  ConversationSummary,
} from '../types.js';

type TraexModelOptions = {
  binary?: string;
  permissionMode?: string;
  timeoutMs?: number;
};

export class TraexModel implements AiModel {
  private readonly binary: string;
  private readonly permissionMode: string;
  private readonly timeoutMs: number;

  constructor(options: TraexModelOptions = {}) {
    this.binary = options.binary ?? process.env.TRAEX_BIN ?? 'traecli';
    this.permissionMode =
      options.permissionMode ?? process.env.TRAEX_PERMISSION_MODE ?? 'bypass_permissions';
    this.timeoutMs = Number(options.timeoutMs ?? process.env.TRAEX_TIMEOUT_MS ?? 10 * 60 * 1000);
  }

  async createSession(input: AiCreateSessionInput): Promise<AiResponse> {
    const args = [
      'exec',
      '-C',
      input.workspace,
      '--permission-mode',
      this.permissionMode,
      '--skip-git-repo-check',
      '--json',
      '-',
    ];

    return this.run(undefined, args, input.prompt);
  }

  createSessionStream(input: AiCreateSessionInput, onEvent: (event: AiRunEvent) => void): AiRun {
    const args = [
      'exec',
      '-C',
      input.workspace,
      '--permission-mode',
      this.permissionMode,
      '--skip-git-repo-check',
      '--json',
      '-',
    ];

    return this.startRun(undefined, args, input.prompt, onEvent);
  }

  async continueSession(input: AiContinueSessionInput): Promise<AiResponse> {
    const args = [
      'exec',
      'resume',
      input.sessionId,
      '--permission-mode',
      this.permissionMode,
      '--skip-git-repo-check',
      '--json',
      '-',
    ];

    return this.run(input.sessionId, args, input.prompt);
  }

  async summarizeConversation(input: AiCreateSessionInput): Promise<ConversationSummary> {
    const args = [
      'exec',
      '-C',
      input.workspace,
      '--permission-mode',
      this.permissionMode,
      '--skip-git-repo-check',
      '--json',
      '-',
    ];
    const response = await this.run(undefined, args, input.prompt);

    return parseConversationSummary(response.content);
  }

  continueSessionStream(input: AiContinueSessionInput, onEvent: (event: AiRunEvent) => void): AiRun {
    const args = [
      'exec',
      'resume',
      input.sessionId,
      '--permission-mode',
      this.permissionMode,
      '--skip-git-repo-check',
      '--json',
      '-',
    ];

    return this.startRun(input.sessionId, args, input.prompt, onEvent);
  }

  private async run(expectedSessionId: string | undefined, args: string[], prompt: string): Promise<AiResponse> {
    return this.startRun(expectedSessionId, args, prompt, () => undefined).result;
  }

  private startRun(
    expectedSessionId: string | undefined,
    args: string[],
    prompt: string,
    onEvent: (event: AiRunEvent) => void,
  ): AiRun {
    const sessionIdSignal = createDeferred<string>();
    let observedSessionId = expectedSessionId;

    if (expectedSessionId) {
      sessionIdSignal.resolve(expectedSessionId);
      onEvent({ type: 'session', sessionId: expectedSessionId });
    }

    const result = runProcess({
      command: this.binary,
      args,
      cwd: process.cwd(),
      input: prompt,
      timeoutMs: this.timeoutMs,
      onRawEvent: (event) => {
        const sessionId = extractThreadId([event]);

        if (sessionId && !observedSessionId) {
          observedSessionId = sessionId;
          sessionIdSignal.resolve(sessionId);
          onEvent({ type: 'session', sessionId });
        }

        for (const text of extractResponseDeltas(event)) {
          onEvent({ type: 'delta', text });
        }

        onEvent({ type: 'raw', event });
      },
    }).then(async ({ content, rawEvents }) => {
      const sessionId = expectedSessionId ?? observedSessionId ?? extractThreadId(rawEvents);

      if (!sessionId) {
        throw new Error('TraeX did not return a thread id');
      }

      sessionIdSignal.resolve(sessionId);

      return {
        sessionId,
        content: content.trim(),
        trace: formatRawEvents(rawEvents),
        rawEvents,
      };
    });

    result.catch((error: unknown) => {
      sessionIdSignal.reject(error);
    });

    return {
      sessionId: sessionIdSignal.promise,
      result,
    };
  }
}

function parseConversationSummary(content: string): ConversationSummary {
  const parsed = parseSummaryJson(content);

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Conversation summary was not valid JSON');
  }

  const title = getStringProperty(parsed, 'title')?.trim();
  const progress = getStringProperty(parsed, 'progress')?.trim();

  if (!title || !progress) {
    throw new Error('Conversation summary JSON must include title and progress');
  }

  return {
    title: limitCharacters(title, 30),
    progress: limitCharacters(progress, 200),
  };
}

function parseSummaryJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);

    if (!match) {
      return undefined;
    }

    try {
      return JSON.parse(match[0]);
    } catch {
      return undefined;
    }
  }
}

function limitCharacters(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, ' ').trim();

  return Array.from(compact).slice(0, maxLength).join('');
}

function extractThreadId(events: unknown[]): string | undefined {
  for (const event of events) {
    if (
      event &&
      typeof event === 'object' &&
      'type' in event &&
      event.type === 'thread.started' &&
      'thread_id' in event &&
      typeof event.thread_id === 'string'
    ) {
      return event.thread_id;
    }

    if (event && typeof event === 'object' && 'payload' in event) {
      const payload = event.payload;

      if (payload && typeof payload === 'object') {
        const sessionMetaId = getStringProperty(payload, 'id');
        const threadId = getStringProperty(payload, 'thread_id');

        if (getStringProperty(event, 'type') === 'session_meta' && sessionMetaId) {
          return sessionMetaId;
        }

        if (threadId) {
          return threadId;
        }
      }
    }
  }

  return undefined;
}

type RunProcessInput = {
  command: string;
  args: string[];
  cwd: string;
  input: string;
  timeoutMs: number;
  onRawEvent: (event: unknown) => void;
};

type RunProcessResult = {
  content: string;
  rawEvents: unknown[];
};

function runProcess({
  command,
  args,
  cwd,
  input,
  timeoutMs,
  onRawEvent,
}: RunProcessInput): Promise<RunProcessResult> {
  return new Promise((resolve, reject) => {
    const events: unknown[] = [];
    let outputPath: string | undefined;
    let outputDir: string | undefined;
    let stdout = '';
    let stderr = '';
    let settled = false;

    mkdtemp(join(tmpdir(), 'cui-traex-'))
      .then((createdOutputDir) => {
        outputDir = createdOutputDir;
        outputPath = join(createdOutputDir, 'last-message.txt');
        const childArgs = [...args.slice(0, -1), '--output-last-message', outputPath, args.at(-1)!];

        const child = spawn(command, childArgs, {
          cwd,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: {
            ...process.env,
            NO_COLOR: '1',
          },
        });

        let idleTimer: ReturnType<typeof setTimeout>;
        const resetIdleTimer = () => {
          clearTimeout(idleTimer);
          idleTimer = setTimeout(() => {
            if (!settled) {
              settled = true;
              child.kill('SIGTERM');
              reject(new Error(`TraeX command produced no output for ${timeoutMs}ms`));
              void cleanupOutputDir(outputDir);
            }
          }, timeoutMs);
        };

        resetIdleTimer();

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');

        child.stdout.on('data', (chunk: string) => {
          resetIdleTimer();
          stdout += chunk;
          const lines = stdout.split('\n');
          stdout = lines.pop() ?? '';

          for (const line of lines) {
            const event = parseJsonLine(line);

            if (event) {
              events.push(event);
              onRawEvent(event);
            }
          }
        });

        child.stderr.on('data', (chunk: string) => {
          resetIdleTimer();
          stderr += chunk;
        });

        child.on('error', (error) => {
          if (!settled) {
            settled = true;
            clearTimeout(idleTimer);
            reject(error);
            void cleanupOutputDir(outputDir);
          }
        });

        child.on('close', (code) => {
          if (settled) {
            return;
          }

          settled = true;
          clearTimeout(idleTimer);

          const trailingEvent = parseJsonLine(stdout);

          if (trailingEvent) {
            events.push(trailingEvent);
            onRawEvent(trailingEvent);
          }

          if (code !== 0) {
            reject(new Error(`TraeX command exited with ${code}: ${stderr.trim()}`));
            void cleanupOutputDir(outputDir);
            return;
          }

          readFile(outputPath!, 'utf8')
            .catch(() => '')
            .then((content) => {
              resolve({ content, rawEvents: events });
            })
            .finally(() => {
              void cleanupOutputDir(outputDir);
            });
        });

        child.stdin.end(input);
      })
      .catch((error: unknown) => {
        reject(error);
      });
  });
}

function parseJsonLine(line: string): unknown | undefined {
  const trimmed = line.trim();

  if (!trimmed) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return { type: 'stdout', text: trimmed };
  }
}

function extractResponseDeltas(event: unknown): string[] {
  if (!event || typeof event !== 'object') {
    return [];
  }

  const type = getStringProperty(event, 'type');

  if (type === 'text_delta') {
    return getTextFields(event, ['text', 'delta']);
  }

  if (type === 'event_msg') {
    const payload = 'payload' in event ? event.payload : undefined;

    if (payload && typeof payload === 'object') {
      const payloadType = getStringProperty(payload, 'type');

      if (payloadType === 'agent_message') {
        return getTextFields(payload, ['message']).map((text) => `${text}\n\n`);
      }

      if (payloadType === 'agent_message_delta') {
        return getTextFields(payload, ['text', 'delta', 'message']);
      }
    }
  }

  return [];
}

function formatRawEvents(events: unknown[]): string {
  return events.map((event) => JSON.stringify(event)).join('\n');
}

function getStringProperty(value: object, key: string): string | undefined {
  if (!(key in value)) {
    return undefined;
  }

  const property = value[key as keyof typeof value];

  return typeof property === 'string' ? property : undefined;
}

function getTextFields(value: object, keys: string[]): string[] {
  return keys
    .map((key) => getStringProperty(value, key))
    .filter((text): text is string => Boolean(text));
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

async function cleanupOutputDir(outputDir: string | undefined): Promise<void> {
  if (outputDir) {
    await rm(outputDir, { force: true, recursive: true });
  }
}
