import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitDiffService } from '../diff/gitDiffService.js';
import {
  AiAtomicDiffReviewInput,
  AiContinueSessionInput,
  AiCreateSessionInput,
  AiModel,
  AiResponse,
  AiRun,
  AiRunEvent,
  AtomicCapabilityType,
  AtomicDiffReview,
  AtomicDiffReviewItem,
  ConversationSummary,
} from '../types.js';

type TraexModelOptions = {
  binary?: string;
  diffService?: GitDiffService;
  permissionMode?: string;
  timeoutMs?: number;
};

export class TraexModel implements AiModel {
  private readonly binary: string;
  private readonly diffService: GitDiffService;
  private readonly permissionMode: string;
  private readonly timeoutMs: number;

  constructor(options: TraexModelOptions = {}) {
    this.binary = options.binary ?? process.env.TRAEX_BIN ?? 'traecli';
    this.diffService = options.diffService ?? new GitDiffService();
    this.permissionMode =
      options.permissionMode ??
      process.env.TRAEX_PERMISSION_MODE ??
      'bypass_permissions';
    this.timeoutMs = Number(
      options.timeoutMs ?? process.env.TRAEX_TIMEOUT_MS ?? 10 * 60 * 1000,
    );
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

    return this.run(undefined, args, input.prompt, input.workspace);
  }

  createSessionStream(
    input: AiCreateSessionInput,
    onEvent: (event: AiRunEvent) => void,
  ): AiRun {
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

    return this.startRun(
      undefined,
      args,
      input.prompt,
      input.workspace,
      true,
      onEvent,
    );
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

    return this.run(input.sessionId, args, input.prompt, input.workspace);
  }

  async summarizeConversation(
    input: AiCreateSessionInput,
  ): Promise<ConversationSummary> {
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
    const response = await this.run(
      undefined,
      args,
      input.prompt,
      input.workspace,
      false,
    );

    return parseConversationSummary(response.content);
  }

  async createAtomicDiffReview(
    input: AiAtomicDiffReviewInput,
  ): Promise<AtomicDiffReview> {
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
    let response: AiResponse | undefined;

    try {
      response = await this.run(
        undefined,
        args,
        createAtomicDiffReviewPrompt(input),
        input.workspace,
        false,
      );

      return {
        status: 'ready',
        generatedAt: new Date().toISOString(),
        analysisSessionId: response.sessionId,
        items: parseAtomicDiffReviewItems(response.content),
        rawResponse: response.content,
      };
    } catch (error) {
      return {
        status: 'failed',
        generatedAt: new Date().toISOString(),
        error:
          error instanceof Error
            ? error.message
            : 'Failed to create atomic diff review',
        ...(response ? { rawResponse: response.content } : {}),
      };
    }
  }

  continueSessionStream(
    input: AiContinueSessionInput,
    onEvent: (event: AiRunEvent) => void,
  ): AiRun {
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

    return this.startRun(
      input.sessionId,
      args,
      input.prompt,
      input.workspace,
      true,
      onEvent,
    );
  }

  private async run(
    expectedSessionId: string | undefined,
    args: string[],
    prompt: string,
    workspace: string,
    captureDiff = true,
  ): Promise<AiResponse> {
    return this.startRun(
      expectedSessionId,
      args,
      prompt,
      workspace,
      captureDiff,
      () => undefined,
    ).result;
  }

  private startRun(
    expectedSessionId: string | undefined,
    args: string[],
    prompt: string,
    workspace: string,
    captureDiff: boolean,
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
      cwd: workspace,
      input: prompt,
      timeoutMs: this.timeoutMs,
      captureDiff,
      diffService: this.diffService,
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
    }).then(async ({ content, beforeDiff, afterDiff, rawEvents }) => {
      const sessionId =
        expectedSessionId ?? observedSessionId ?? extractThreadId(rawEvents);

      if (!sessionId) {
        throw new Error('TraeX did not return a thread id');
      }

      sessionIdSignal.resolve(sessionId);

      return {
        sessionId,
        content: content.trim(),
        trace: formatRawEvents(rawEvents),
        ...(captureDiff
          ? {
              gitDiff: {
                beforeDiff,
                afterDiff,
              },
            }
          : {}),
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

function createAtomicDiffReviewPrompt(input: AiAtomicDiffReviewInput): string {
  return [
    '你是代码审查助手。请把给定的一轮 AI 修改 diff 拆分成 N 个原子能力。',
    '',
    '原子能力类型必须使用以下编号：',
    '0: 格式调整',
    '1: 重构，包括重命名、拆分函数、移动代码位置等',
    '2: 新功能，包括新加一个函数、新加一个类',
    '3: 单点修改，例如修改函数局部逻辑',
    '4: 多点调整，例如函数修改签名，导致所有上下游都需要跟着变化',
    '5: 测试修改，包括新增测试、修改测试断言、调整测试夹具或测试快照',
    '',
    '拆分规则：',
    '1. 按照人类 review 代码时的理解顺序排列，从结构入口、数据模型、核心逻辑、调用点、展示或测试逐步展开。',
    '2. 每个原子能力必须只表达一个可独立理解的修改意图。',
    '3. 每个原子能力都必须包含该能力对应的 unified diff 片段。diff 可以裁剪上下文，但必须保留 diff --git、---、+++、@@ 以及相关增删行。',
    '4. 对每个原子能力解释修改意图，说明为什么做这个修改，而不是只复述改了哪些行。',
    '5. 只基于输入材料，不要编造文件或行为。',
    '6. 只输出 JSON，不要输出 Markdown、代码围栏或额外解释。',
    '',
    '输出 JSON schema：',
    '{',
    '  "items": [',
    '    {',
    '      "id": "atomic-1",',
    '      "order": 1,',
    '      "capabilityType": 2,',
    '      "capabilityLabel": "新功能",',
    '      "title": "短标题",',
    '      "intent": "修改意图说明",',
    '      "files": ["path/to/file"],',
    '      "diff": "unified diff text",',
    '      "outputJson": {',
    '        "id": "atomic-1",',
    '        "order": 1,',
    '        "capability_type": 2,',
    '        "capability_label": "新功能",',
    '        "title": "短标题",',
    '        "intent": "修改意图说明",',
    '        "files": ["path/to/file"]',
    '      }',
    '    }',
    '  ]',
    '}',
    '',
    `原始 session id：${input.originalSessionId}`,
    `轮次：${input.round}`,
    '',
    '<SESSION_INPUT>',
    input.sessionInput,
    '</SESSION_INPUT>',
    '',
    '<EXECUTION_TRACE>',
    input.executionTrace || '无',
    '</EXECUTION_TRACE>',
    '',
    '<ASSISTANT_OUTPUT>',
    input.assistantOutput || '无',
    '</ASSISTANT_OUTPUT>',
    '',
    '<DIFF>',
    input.diff || '无',
    '</DIFF>',
  ].join('\n');
}

function parseAtomicDiffReviewItems(content: string): AtomicDiffReviewItem[] {
  const parsed = parseSummaryJson(content);

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Atomic diff review was not valid JSON');
  }

  const rawItems = 'items' in parsed ? parsed.items : undefined;

  if (!Array.isArray(rawItems)) {
    throw new Error('Atomic diff review JSON must include items array');
  }

  return rawItems.map((item, index) => parseAtomicDiffReviewItem(item, index));
}

function parseAtomicDiffReviewItem(
  item: unknown,
  index: number,
): AtomicDiffReviewItem {
  if (!item || typeof item !== 'object') {
    throw new Error(`Atomic diff review item ${index + 1} must be an object`);
  }

  const order = getNumberProperty(item, 'order') ?? index + 1;
  const capabilityType = parseCapabilityType(
    getNumberProperty(item, 'capabilityType') ??
      getNumberProperty(item, 'capability_type'),
  );
  const title = requiredStringProperty(item, 'title', index);
  const intent = requiredStringProperty(item, 'intent', index);
  const diff = requiredStringProperty(item, 'diff', index);
  const id =
    getStringProperty(item, 'id')?.trim() || `atomic-${String(order)}`;
  const files = getStringArrayProperty(item, 'files');
  const capabilityLabel =
    getStringProperty(item, 'capabilityLabel')?.trim() ||
    getStringProperty(item, 'capability_label')?.trim() ||
    capabilityLabelForType(capabilityType);
  const outputJson = normalizeOutputJson(item, {
    id,
    order,
    capabilityType,
    capabilityLabel,
    title,
    intent,
    files,
  });

  return {
    id,
    order,
    capabilityType,
    capabilityLabel,
    title,
    intent,
    files,
    diff,
    outputJson,
  };
}

function normalizeOutputJson(
  item: object,
  fallback: Omit<AtomicDiffReviewItem, 'diff' | 'outputJson'>,
): Record<string, unknown> {
  const outputJson = 'outputJson' in item ? item.outputJson : undefined;

  if (outputJson && typeof outputJson === 'object' && !Array.isArray(outputJson)) {
    return outputJson as Record<string, unknown>;
  }

  return {
    id: fallback.id,
    order: fallback.order,
    capability_type: fallback.capabilityType,
    capability_label: fallback.capabilityLabel,
    title: fallback.title,
    intent: fallback.intent,
    files: fallback.files,
  };
}

function parseCapabilityType(value: number | undefined): AtomicCapabilityType {
  if (
    value === 0 ||
    value === 1 ||
    value === 2 ||
    value === 3 ||
    value === 4 ||
    value === 5
  ) {
    return value;
  }

  throw new Error(
    'Atomic diff review capabilityType must be 0, 1, 2, 3, 4, or 5',
  );
}

function capabilityLabelForType(value: AtomicCapabilityType): string {
  switch (value) {
    case 0:
      return '格式调整';
    case 1:
      return '重构';
    case 2:
      return '新功能';
    case 3:
      return '单点修改';
    case 4:
      return '多点调整';
    case 5:
      return '测试修改';
  }
}

function requiredStringProperty(
  value: object,
  key: string,
  index: number,
): string {
  const property = getStringProperty(value, key)?.trim();

  if (!property) {
    throw new Error(`Atomic diff review item ${index + 1} must include ${key}`);
  }

  return property;
}

function parseConversationSummary(content: string): ConversationSummary {
  const parsed = parseSummaryJson(content);

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Conversation summary was not valid JSON');
  }

  const title = getStringProperty(parsed, 'title')?.trim();
  const progress = getStringProperty(parsed, 'progress')?.trim();

  if (!title || !progress) {
    throw new Error(
      'Conversation summary JSON must include title and progress',
    );
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

        if (
          getStringProperty(event, 'type') === 'session_meta' &&
          sessionMetaId
        ) {
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
  captureDiff: boolean;
  diffService: GitDiffService;
  onRawEvent: (event: unknown) => void;
};

type RunProcessResult = {
  content: string;
  beforeDiff: string;
  afterDiff: string;
  rawEvents: unknown[];
};

async function runProcess({
  command,
  args,
  cwd,
  input,
  timeoutMs,
  captureDiff,
  diffService,
  onRawEvent,
}: RunProcessInput): Promise<RunProcessResult> {
  const beforeDiff = captureDiff
    ? await diffService.captureWorkspaceDiff(cwd)
    : '';

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
        const childArgs = [
          ...args.slice(0, -1),
          '--output-last-message',
          outputPath,
          args.at(-1)!,
        ];

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
            reject(
              new Error(`TraeX command exited with ${code}: ${stderr.trim()}`),
            );
            void cleanupOutputDir(outputDir);
            return;
          }

          readFile(outputPath!, 'utf8')
            .catch(() => '')
            .then(async (content) => {
              const afterDiff = captureDiff
                ? await diffService.captureWorkspaceDiff(cwd)
                : '';

              resolve({ content, beforeDiff, afterDiff, rawEvents: events });
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
  const property = (value as Record<string, unknown>)[key];

  return typeof property === 'string' ? property : undefined;
}

function getNumberProperty(value: object, key: string): number | undefined {
  const property = (value as Record<string, unknown>)[key];

  return typeof property === 'number' ? property : undefined;
}

function getStringArrayProperty(value: object, key: string): string[] {
  const property = (value as Record<string, unknown>)[key];

  if (!Array.isArray(property)) {
    return [];
  }

  return property.filter((item): item is string => typeof item === 'string');
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
