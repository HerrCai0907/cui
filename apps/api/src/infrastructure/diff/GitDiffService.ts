import { spawn } from 'node:child_process';

export type DiffSnapshot = {
  beforeDiff: string;
  afterDiff: string;
};

export class GitDiffService {
  async captureWorkspaceDiff(cwd: string): Promise<string> {
    const diffBase = await this.runGit(['rev-parse', '--verify', 'HEAD'], cwd);
    const trackedDiffArgs = [
      'diff',
      '--no-ext-diff',
      '--src-prefix=a/',
      '--dst-prefix=b/',
      '--unified=999999',
      ...(diffBase.trim() ? ['HEAD'] : []),
      '--',
    ];
    const trackedDiff = await this.runGit(trackedDiffArgs, cwd);
    const untrackedFiles = await this.listUntrackedFiles(cwd);
    const untrackedDiffs = await Promise.all(
      untrackedFiles.map((file) =>
        this.runGit(
          [
            'diff',
            '--no-ext-diff',
            '--no-index',
            '--src-prefix=a/',
            '--dst-prefix=b/',
            '--unified=999999',
            '--',
            '/dev/null',
            file,
          ],
          cwd,
          [0, 1],
        ),
      ),
    );

    return [trackedDiff, ...untrackedDiffs]
      .map((diff) => diff.trimEnd())
      .filter(Boolean)
      .join('\n');
  }

  createRoundDiff(previousDiff: string, currentDiff: string): string {
    if (previousDiff === currentDiff) {
      return '';
    }

    const previousBlocks = this.parseDiffBlocks(previousDiff);
    const currentBlocks = this.parseDiffBlocks(currentDiff);
    const changedBlocks = [...currentBlocks.entries()]
      .filter(([path, block]) => previousBlocks.get(path) !== block)
      .map(([, block]) => block);
    const clearedBlocks = [...previousBlocks.entries()]
      .filter(([path]) => !currentBlocks.has(path))
      .map(([, block]) => this.reverseDiffBlock(block));

    return [...changedBlocks, ...clearedBlocks].join('\n');
  }

  hasChanges(diff: string): boolean {
    return Boolean(diff.trim());
  }

  parseDiffBlocks(diff: string): Map<string, string> {
    const blocks = new Map<string, string>();
    let currentPath: string | undefined;
    let currentLines: string[] = [];

    for (const line of diff.split('\n')) {
      if (line.startsWith('diff --git ')) {
        if (currentPath && currentLines.length > 0) {
          blocks.set(currentPath, currentLines.join('\n'));
        }

        currentPath = this.getDiffBlockPath(line);
        currentLines = [line];
        continue;
      }

      if (currentPath) {
        currentLines.push(line);
      }
    }

    if (currentPath && currentLines.length > 0) {
      blocks.set(currentPath, currentLines.join('\n').trimEnd());
    }

    return blocks;
  }

  reverseDiffBlock(block: string): string {
    const lines = block.split('\n');
    const oldFile = lines.find((line) => line.startsWith('--- '))?.slice(4);
    const newFile = lines.find((line) => line.startsWith('+++ '))?.slice(4);

    return lines
      .map((line) => {
        if (line === 'new file mode 100644') {
          return 'deleted file mode 100644';
        }

        if (line === 'deleted file mode 100644') {
          return 'new file mode 100644';
        }

        if (line.startsWith('--- ')) {
          return `--- ${newFile ?? line.slice(4)}`;
        }

        if (line.startsWith('+++ ')) {
          return `+++ ${oldFile ?? line.slice(4)}`;
        }

        if (line.startsWith('+')) {
          return `-${line.slice(1)}`;
        }

        if (line.startsWith('-')) {
          return `+${line.slice(1)}`;
        }

        return line;
      })
      .join('\n')
      .trimEnd();
  }

  private getDiffBlockPath(header: string): string {
    const match = /^diff --git a\/(.+) b\/(.+)$/.exec(header);

    if (!match) {
      return header;
    }

    return match[2];
  }

  private async listUntrackedFiles(cwd: string): Promise<string[]> {
    const output = await this.runGit(
      ['ls-files', '--others', '--exclude-standard', '-z'],
      cwd,
    );

    return output
      .split('\0')
      .filter(Boolean)
      .filter((file) => !file.startsWith('.trae/'));
  }

  private runGit(args: string[], cwd: string, okCodes = [0]): Promise<string> {
    return new Promise((resolve) => {
      const child = spawn('git', args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          NO_COLOR: '1',
        },
      });
      let stdout = '';
      let stderr = '';

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });
      child.on('error', () => {
        resolve('');
      });
      child.on('close', (code) => {
        if (code !== null && okCodes.includes(code)) {
          resolve(stdout);
          return;
        }

        resolve(stderr ? '' : stdout);
      });
    });
  }
}
