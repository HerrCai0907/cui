import { spawn } from "node:child_process";

export type DiffSnapshot = {
  gitCommit: string;
  diff: string;
};

type TextSnapshot = {
  exists: boolean;
  lines: string[];
  endsWithNewline: boolean;
  complete: boolean;
};

type ParsedDiffBlock = {
  path: string;
  block: string;
  before: TextSnapshot;
  after: TextSnapshot;
};

type DiffOperation =
  | {
      kind: "context";
      line: string;
    }
  | {
      kind: "remove";
      line: string;
    }
  | {
      kind: "add";
      line: string;
    };

export class GitDiffService {
  private static readonly maxLcsMatrixCells = 4_000_000;

  async captureWorkspaceSnapshot(cwd: string): Promise<DiffSnapshot> {
    const gitCommit = await this.captureHeadCommit(cwd);
    const diff = await this.captureWorkspaceDiff(cwd, gitCommit);

    return { gitCommit, diff };
  }

  async captureWorkspaceDiff(cwd: string, baseCommit?: string): Promise<string> {
    const diffBase = baseCommit ?? (await this.captureHeadCommit(cwd));
    const trackedDiffArgs = [
      "diff",
      "--no-ext-diff",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      "--unified=999999",
      ...(diffBase ? [diffBase] : []),
      "--",
    ];
    const trackedDiff = await this.runGit(trackedDiffArgs, cwd);
    const untrackedFiles = await this.listUntrackedFiles(cwd);
    const untrackedDiffs = await Promise.all(
      untrackedFiles.map((file) =>
        this.runGit(
          [
            "diff",
            "--no-ext-diff",
            "--no-index",
            "--src-prefix=a/",
            "--dst-prefix=b/",
            "--unified=999999",
            "--",
            "/dev/null",
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
      .join("\n");
  }

  createRoundDiff(previousDiff: string, currentDiff: string): string {
    if (previousDiff === currentDiff) {
      return "";
    }

    const previousBlocks = this.parseSnapshotDiffBlocks(previousDiff);
    const currentBlocks = this.parseSnapshotDiffBlocks(currentDiff);
    const paths = new Set([...previousBlocks.keys(), ...currentBlocks.keys()]);
    const blocks: string[] = [];

    for (const path of paths) {
      const previousBlock = previousBlocks.get(path);
      const currentBlock = currentBlocks.get(path);
      const beforeSnapshot = previousBlock?.after ?? currentBlock?.before;
      const afterSnapshot = currentBlock?.after ?? previousBlock?.before;

      if (!beforeSnapshot || !afterSnapshot) {
        continue;
      }

      if (!beforeSnapshot.complete || !afterSnapshot.complete) {
        const fallbackBlock = this.createFallbackRoundDiffBlock(previousBlock, currentBlock);

        if (fallbackBlock) {
          blocks.push(fallbackBlock);
        }

        continue;
      }

      if (this.areSnapshotsEqual(beforeSnapshot, afterSnapshot)) {
        continue;
      }

      blocks.push(this.formatRoundDiffBlock(path, beforeSnapshot, afterSnapshot));
    }

    return blocks.join("\n");
  }

  hasChanges(diff: string): boolean {
    return Boolean(diff.trim());
  }

  parseDiffBlocks(diff: string): Map<string, string> {
    const blocks = new Map<string, string>();
    let currentPath: string | undefined;
    let currentLines: string[] = [];

    for (const line of diff.split("\n")) {
      if (line.startsWith("diff --git ")) {
        if (currentPath && currentLines.length > 0) {
          blocks.set(currentPath, currentLines.join("\n"));
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
      blocks.set(currentPath, currentLines.join("\n").trimEnd());
    }

    return blocks;
  }

  reverseDiffBlock(block: string): string {
    const lines = block.split("\n");
    const oldFile = lines.find((line) => line.startsWith("--- "))?.slice(4);
    const newFile = lines.find((line) => line.startsWith("+++ "))?.slice(4);

    return lines
      .map((line) => {
        if (line === "new file mode 100644") {
          return "deleted file mode 100644";
        }

        if (line === "deleted file mode 100644") {
          return "new file mode 100644";
        }

        if (line.startsWith("--- ")) {
          return `--- ${newFile ?? line.slice(4)}`;
        }

        if (line.startsWith("+++ ")) {
          return `+++ ${oldFile ?? line.slice(4)}`;
        }

        if (line.startsWith("+")) {
          return `-${line.slice(1)}`;
        }

        if (line.startsWith("-")) {
          return `+${line.slice(1)}`;
        }

        return line;
      })
      .join("\n")
      .trimEnd();
  }

  private parseSnapshotDiffBlocks(diff: string): Map<string, ParsedDiffBlock> {
    const blocks = new Map<string, ParsedDiffBlock>();

    for (const block of this.parseDiffBlocks(diff).values()) {
      const parsedBlock = this.parseSnapshotDiffBlock(block);
      blocks.set(parsedBlock.path, parsedBlock);
    }

    return blocks;
  }

  private parseSnapshotDiffBlock(block: string): ParsedDiffBlock {
    const lines = block.split("\n");
    const header = lines[0] ?? "";
    const oldPath = lines.find((line) => line.startsWith("--- "))?.slice(4);
    const newPath = lines.find((line) => line.startsWith("+++ "))?.slice(4);
    const isNewFile = lines.some((line) => line.startsWith("new file mode "));
    const isDeletedFile = lines.some((line) => line.startsWith("deleted file mode "));
    const oldLines: string[] = [];
    const newLines: string[] = [];
    let oldEndsWithNewline = true;
    let newEndsWithNewline = true;
    let hasHunk = false;
    let inHunk = false;
    let previousSides: Array<"old" | "new"> = [];

    for (const line of lines) {
      if (line.startsWith("@@ ")) {
        hasHunk = true;
        inHunk = true;
        previousSides = [];
        continue;
      }

      if (!inHunk) {
        continue;
      }

      if (line.startsWith("\\")) {
        if (previousSides.includes("old")) {
          oldEndsWithNewline = false;
        }

        if (previousSides.includes("new")) {
          newEndsWithNewline = false;
        }

        continue;
      }

      if (line.startsWith("+")) {
        newLines.push(line.slice(1));
        previousSides = ["new"];
      } else if (line.startsWith("-")) {
        oldLines.push(line.slice(1));
        previousSides = ["old"];
      } else if (line.startsWith(" ")) {
        const content = line.slice(1);
        oldLines.push(content);
        newLines.push(content);
        previousSides = ["old", "new"];
      } else {
        inHunk = false;
        previousSides = [];
      }
    }

    const canReconstruct = hasHunk || isNewFile || isDeletedFile;

    return {
      path:
        this.cleanDiffPath(newPath) ?? this.cleanDiffPath(oldPath) ?? this.getDiffBlockPath(header),
      block,
      before: {
        exists: isNewFile ? false : oldPath !== "/dev/null",
        lines: hasHunk ? oldLines : [],
        endsWithNewline: oldEndsWithNewline,
        complete: canReconstruct,
      },
      after: {
        exists: isDeletedFile ? false : newPath !== "/dev/null",
        lines: hasHunk ? newLines : [],
        endsWithNewline: newEndsWithNewline,
        complete: canReconstruct,
      },
    };
  }

  private createFallbackRoundDiffBlock(
    previousBlock: ParsedDiffBlock | undefined,
    currentBlock: ParsedDiffBlock | undefined,
  ): string | undefined {
    if (previousBlock?.block === currentBlock?.block) {
      return undefined;
    }

    if (previousBlock && !currentBlock) {
      return this.reverseDiffBlock(previousBlock.block);
    }

    return currentBlock?.block;
  }

  private formatRoundDiffBlock(
    path: string,
    beforeSnapshot: TextSnapshot,
    afterSnapshot: TextSnapshot,
  ): string {
    const lines = [`diff --git a/${path} b/${path}`];

    if (!beforeSnapshot.exists && afterSnapshot.exists) {
      lines.push("new file mode 100644");
    } else if (beforeSnapshot.exists && !afterSnapshot.exists) {
      lines.push("deleted file mode 100644");
    }

    lines.push(
      beforeSnapshot.exists ? `--- a/${path}` : "--- /dev/null",
      afterSnapshot.exists ? `+++ b/${path}` : "+++ /dev/null",
    );

    const operations = this.createSnapshotLineDiff(beforeSnapshot, afterSnapshot);

    if (operations.some((operation) => operation.kind !== "context")) {
      lines.push(
        this.createHunkHeader(beforeSnapshot.lines.length, afterSnapshot.lines.length),
        ...this.formatDiffOperations(operations, beforeSnapshot, afterSnapshot),
      );
    }

    return lines.join("\n").trimEnd();
  }

  private createLineDiff(beforeLines: string[], afterLines: string[]): DiffOperation[] {
    let prefixLength = 0;

    while (
      prefixLength < beforeLines.length &&
      prefixLength < afterLines.length &&
      beforeLines[prefixLength] === afterLines[prefixLength]
    ) {
      prefixLength += 1;
    }

    let suffixLength = 0;

    while (
      suffixLength < beforeLines.length - prefixLength &&
      suffixLength < afterLines.length - prefixLength &&
      beforeLines[beforeLines.length - suffixLength - 1] ===
        afterLines[afterLines.length - suffixLength - 1]
    ) {
      suffixLength += 1;
    }

    const beforeMiddle = beforeLines.slice(prefixLength, beforeLines.length - suffixLength);
    const afterMiddle = afterLines.slice(prefixLength, afterLines.length - suffixLength);

    return [
      ...beforeLines.slice(0, prefixLength).map((line) => ({
        kind: "context" as const,
        line,
      })),
      ...this.createMiddleLineDiff(beforeMiddle, afterMiddle),
      ...beforeLines.slice(beforeLines.length - suffixLength).map((line) => ({
        kind: "context" as const,
        line,
      })),
    ];
  }

  private createSnapshotLineDiff(
    beforeSnapshot: TextSnapshot,
    afterSnapshot: TextSnapshot,
  ): DiffOperation[] {
    if (
      beforeSnapshot.lines.length > 0 &&
      beforeSnapshot.lines.length === afterSnapshot.lines.length &&
      beforeSnapshot.lines.every((line, index) => line === afterSnapshot.lines[index]) &&
      beforeSnapshot.endsWithNewline !== afterSnapshot.endsWithNewline
    ) {
      return [
        ...beforeSnapshot.lines.slice(0, -1).map((line) => ({
          kind: "context" as const,
          line,
        })),
        {
          kind: "remove",
          line: beforeSnapshot.lines[beforeSnapshot.lines.length - 1],
        },
        {
          kind: "add",
          line: afterSnapshot.lines[afterSnapshot.lines.length - 1],
        },
      ];
    }

    return this.createLineDiff(beforeSnapshot.lines, afterSnapshot.lines);
  }

  private createMiddleLineDiff(beforeLines: string[], afterLines: string[]): DiffOperation[] {
    if (beforeLines.length === 0) {
      return afterLines.map((line) => ({ kind: "add", line }));
    }

    if (afterLines.length === 0) {
      return beforeLines.map((line) => ({ kind: "remove", line }));
    }

    if (beforeLines.length * afterLines.length > GitDiffService.maxLcsMatrixCells) {
      return [
        ...beforeLines.map((line) => ({ kind: "remove" as const, line })),
        ...afterLines.map((line) => ({ kind: "add" as const, line })),
      ];
    }

    const columnCount = afterLines.length + 1;
    const lengths = new Uint32Array((beforeLines.length + 1) * columnCount);
    const cell = (beforeIndex: number, afterIndex: number) =>
      beforeIndex * columnCount + afterIndex;

    for (let beforeIndex = beforeLines.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
      for (let afterIndex = afterLines.length - 1; afterIndex >= 0; afterIndex -= 1) {
        lengths[cell(beforeIndex, afterIndex)] =
          beforeLines[beforeIndex] === afterLines[afterIndex]
            ? lengths[cell(beforeIndex + 1, afterIndex + 1)] + 1
            : Math.max(
                lengths[cell(beforeIndex + 1, afterIndex)],
                lengths[cell(beforeIndex, afterIndex + 1)],
              );
      }
    }

    const operations: DiffOperation[] = [];
    let beforeIndex = 0;
    let afterIndex = 0;

    while (beforeIndex < beforeLines.length && afterIndex < afterLines.length) {
      if (beforeLines[beforeIndex] === afterLines[afterIndex]) {
        operations.push({
          kind: "context",
          line: beforeLines[beforeIndex],
        });
        beforeIndex += 1;
        afterIndex += 1;
      } else if (
        lengths[cell(beforeIndex + 1, afterIndex)] >= lengths[cell(beforeIndex, afterIndex + 1)]
      ) {
        operations.push({
          kind: "remove",
          line: beforeLines[beforeIndex],
        });
        beforeIndex += 1;
      } else {
        operations.push({
          kind: "add",
          line: afterLines[afterIndex],
        });
        afterIndex += 1;
      }
    }

    while (beforeIndex < beforeLines.length) {
      operations.push({
        kind: "remove",
        line: beforeLines[beforeIndex],
      });
      beforeIndex += 1;
    }

    while (afterIndex < afterLines.length) {
      operations.push({
        kind: "add",
        line: afterLines[afterIndex],
      });
      afterIndex += 1;
    }

    return operations;
  }

  private formatDiffOperations(
    operations: DiffOperation[],
    beforeSnapshot: TextSnapshot,
    afterSnapshot: TextSnapshot,
  ): string[] {
    const lines: string[] = [];
    let oldLineCount = 0;
    let newLineCount = 0;

    for (const operation of operations) {
      if (operation.kind === "context") {
        oldLineCount += 1;
        newLineCount += 1;
        lines.push(` ${operation.line}`);
        this.appendNoNewlineMarker(
          lines,
          oldLineCount,
          newLineCount,
          beforeSnapshot,
          afterSnapshot,
        );
      } else if (operation.kind === "remove") {
        oldLineCount += 1;
        lines.push(`-${operation.line}`);

        if (oldLineCount === beforeSnapshot.lines.length && !beforeSnapshot.endsWithNewline) {
          lines.push("\\ No newline at end of file");
        }
      } else {
        newLineCount += 1;
        lines.push(`+${operation.line}`);

        if (newLineCount === afterSnapshot.lines.length && !afterSnapshot.endsWithNewline) {
          lines.push("\\ No newline at end of file");
        }
      }
    }

    return lines;
  }

  private appendNoNewlineMarker(
    lines: string[],
    oldLineCount: number,
    newLineCount: number,
    beforeSnapshot: TextSnapshot,
    afterSnapshot: TextSnapshot,
  ) {
    if (oldLineCount === beforeSnapshot.lines.length && !beforeSnapshot.endsWithNewline) {
      lines.push("\\ No newline at end of file");
    }

    if (
      newLineCount === afterSnapshot.lines.length &&
      !afterSnapshot.endsWithNewline &&
      beforeSnapshot.endsWithNewline
    ) {
      lines.push("\\ No newline at end of file");
    }
  }

  private createHunkHeader(beforeLineCount: number, afterLineCount: number) {
    const oldStart = beforeLineCount > 0 ? 1 : 0;
    const newStart = afterLineCount > 0 ? 1 : 0;

    return `@@ -${oldStart},${beforeLineCount} +${newStart},${afterLineCount} @@`;
  }

  private areSnapshotsEqual(beforeSnapshot: TextSnapshot, afterSnapshot: TextSnapshot): boolean {
    return (
      beforeSnapshot.exists === afterSnapshot.exists &&
      beforeSnapshot.endsWithNewline === afterSnapshot.endsWithNewline &&
      beforeSnapshot.lines.length === afterSnapshot.lines.length &&
      beforeSnapshot.lines.every((line, index) => line === afterSnapshot.lines[index])
    );
  }

  private getDiffBlockPath(header: string): string {
    const match = /^diff --git a\/(.+) b\/(.+)$/.exec(header);

    if (!match) {
      return header;
    }

    return match[2];
  }

  private cleanDiffPath(path: string | undefined): string | undefined {
    if (!path || path === "/dev/null") {
      return undefined;
    }

    return path.replace(/^[ab]\//, "");
  }

  private async listUntrackedFiles(cwd: string): Promise<string[]> {
    const output = await this.runGit(["ls-files", "--others", "--exclude-standard", "-z"], cwd);

    return output
      .split("\0")
      .filter(Boolean)
      .filter((file) => !file.startsWith(".trae/"));
  }

  private async captureHeadCommit(cwd: string): Promise<string> {
    return (await this.runGit(["rev-parse", "--verify", "HEAD"], cwd)).trim();
  }

  private runGit(args: string[], cwd: string, okCodes = [0]): Promise<string> {
    return new Promise((resolve) => {
      const child = spawn("git", args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          NO_COLOR: "1",
        },
      });
      let stdout = "";
      let stderr = "";

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.on("error", () => {
        resolve("");
      });
      child.on("close", (code) => {
        if (code !== null && okCodes.includes(code)) {
          resolve(stdout);
          return;
        }

        resolve(stderr ? "" : stdout);
      });
    });
  }
}
