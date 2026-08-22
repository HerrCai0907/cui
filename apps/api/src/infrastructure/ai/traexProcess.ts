import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  GitDiffService,
  type DiffSnapshot,
} from '../diff/GitDiffService.js';
import { parseJsonLine } from './traexEvents.js';

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
  beforeSnapshot: DiffSnapshot;
  afterSnapshot: DiffSnapshot;
  rawEvents: unknown[];
};

export async function runTraexProcess({
  command,
  args,
  cwd,
  input,
  timeoutMs,
  captureDiff,
  diffService,
  onRawEvent,
}: RunProcessInput): Promise<RunProcessResult> {
  const beforeSnapshot = captureDiff
    ? await diffService.captureWorkspaceSnapshot(cwd)
    : { gitCommit: '', diff: '' };

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
              reject(
                new Error(
                  `TraeX command produced no output for ${timeoutMs}ms`,
                ),
              );
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
                ? await diffService.captureWorkspaceDiff(
                    cwd,
                    beforeSnapshot.gitCommit,
                  )
                : '';
              const afterSnapshot = {
                gitCommit: beforeSnapshot.gitCommit,
                diff: afterDiff,
              };

              resolve({
                content,
                beforeSnapshot,
                afterSnapshot,
                rawEvents: events,
              });
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

async function cleanupOutputDir(outputDir: string | undefined): Promise<void> {
  if (outputDir) {
    await rm(outputDir, { force: true, recursive: true });
  }
}
