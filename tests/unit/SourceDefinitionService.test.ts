import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import {
  SourceDefinitionService,
  UnsupportedLanguageServerError,
} from "../../apps/api/src/domain/lsp/SourceDefinitionService.js";
import type { RustAnalyzerProvider } from "../../apps/api/src/infrastructure/lsp/RustAnalyzerProvider.js";

test("findDefinition normalizes relative Rust paths and converts LSP ranges", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "cui-source-definition-"));
  const sourceFile = join(cwd, "src", "lib.rs");
  const definitionFile = join(cwd, "src", "types.rs");
  const calls: Array<{ workspace: string; filePath: string; line: number; character: number }> = [];
  const rustAnalyzer = {
    async definition(input: {
      workspace: string;
      filePath: string;
      line: number;
      character: number;
    }) {
      calls.push(input);
      return {
        uri: pathToFileURL(definitionFile).toString(),
        range: {
          start: { line: 9, character: 2 },
          end: { line: 9, character: 8 },
        },
      };
    },
    close() {},
  } satisfies Pick<RustAnalyzerProvider, "definition" | "close">;
  const service = new SourceDefinitionService(rustAnalyzer as RustAnalyzerProvider);

  try {
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(sourceFile, "fn call() {}\n", { flag: "w" });

    const result = await service.findDefinition({
      workspace: cwd,
      filePath: "src/lib.rs",
      line: 1,
      character: 3,
    });

    assert.deepEqual(calls, [{ workspace: cwd, filePath: sourceFile, line: 1, character: 3 }]);
    assert.deepEqual(result, {
      found: true,
      language: "rust",
      target: {
        filePath: definitionFile,
        startLine: 10,
        startCharacter: 2,
        endLine: 10,
        endCharacter: 8,
      },
    });
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("findDefinition rejects unsupported languages before starting a provider", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "cui-source-definition-"));
  const service = new SourceDefinitionService({
    async definition() {
      throw new Error("should not start");
    },
    close() {},
  } as unknown as RustAnalyzerProvider);

  try {
    await assert.rejects(
      service.findDefinition({
        workspace: cwd,
        filePath: "main.go",
        line: 1,
        character: 0,
      }),
      UnsupportedLanguageServerError,
    );
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});
