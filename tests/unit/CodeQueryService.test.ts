import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import {
  CodeFileNotFoundError,
  CodeFileTooLargeError,
  CodePathNotFileError,
  CodeQueryService,
  CodeRangeTooLargeError,
} from "../../apps/api/src/domain/code/CodeQueryService.js";
import {
  parseCodeRangeQuery,
  parseCreateRunBody,
  parseCreateSessionBody,
} from "../../apps/api/src/http/validation/requestParsers.js";

test("getCodeRange returns the requested inclusive line range", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "cui-code-query-"));
  const filePath = join(cwd, "example.ts");
  const service = new CodeQueryService();

  try {
    await writeFile(
      filePath,
      ["const first = 1;", "const second = 2;", "const third = 3;"].join("\n"),
    );

    const result = await service.getCodeRange({
      filePath,
      startLine: 2,
      endLine: 3,
    });

    assert.deepEqual(result, {
      filePath,
      startLine: 2,
      endLine: 3,
      code: ["const second = 2;", "const third = 3;"].join("\n"),
      lines: [
        { lineNumber: 2, content: "const second = 2;" },
        { lineNumber: 3, content: "const third = 3;" },
      ],
    });
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("getCodeRange returns the full file when no range is provided", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "cui-code-query-"));
  const filePath = join(cwd, "example.ts");
  const service = new CodeQueryService();

  try {
    await writeFile(filePath, ["const first = 1;", "const second = 2;"].join("\n"));

    const result = await service.getCodeRange({
      filePath,
    });

    assert.equal(result.startLine, 1);
    assert.equal(result.endLine, 2);
    assert.equal(result.code, ["const first = 1;", "const second = 2;"].join("\n"));
    assert.deepEqual(result.lines, [
      { lineNumber: 1, content: "const first = 1;" },
      { lineNumber: 2, content: "const second = 2;" },
    ]);
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("getCodeRange expands home-relative file paths", async () => {
  const service = new CodeQueryService();
  const filePath = join(homedir(), ".cui-code-query-home-test");

  try {
    await writeFile(filePath, "home file\n");

    const result = await service.getCodeRange({
      filePath: "~/.cui-code-query-home-test",
    });

    assert.equal(result.filePath, filePath);
    assert.equal(result.code, "home file\n");
  } finally {
    await rm(filePath, { force: true });
  }
});

test("getCodeRange accepts file URLs", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "cui-code-query-"));
  const filePath = join(cwd, "example.md");
  const service = new CodeQueryService();

  try {
    await writeFile(filePath, "markdown file\n");

    const result = await service.getCodeRange({
      filePath: pathToFileURL(filePath).toString(),
    });

    assert.equal(result.filePath, filePath);
    assert.equal(result.code, "markdown file\n");
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("getCodeRange limits default previews and rejects oversized ranges", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "cui-code-query-"));
  const filePath = join(cwd, "large-line-count.txt");
  const service = new CodeQueryService();

  try {
    await writeFile(
      filePath,
      Array.from({ length: 600 }, (_, index) => `line ${index + 1}`).join("\n"),
    );

    const result = await service.getCodeRange({
      filePath,
    });

    assert.equal(result.startLine, 1);
    assert.equal(result.endLine, 200);
    assert.equal(result.lines.length, 200);

    await assert.rejects(
      service.getCodeRange({
        filePath,
        startLine: 1,
        endLine: 501,
      }),
      CodeRangeTooLargeError,
    );
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("getCodeRange truncates very long lines", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "cui-code-query-"));
  const filePath = join(cwd, "long-line.txt");
  const service = new CodeQueryService();

  try {
    await writeFile(filePath, "x".repeat(5000));

    const result = await service.getCodeRange({
      filePath,
    });

    assert.equal(result.lines[0]?.content.length, 4003);
    assert.match(result.lines[0]?.content ?? "", /\.\.\.$/);
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("getCodeRange rejects files that are too large to preview", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "cui-code-query-"));
  const filePath = join(cwd, "too-large.txt");
  const service = new CodeQueryService();

  try {
    await writeFile(filePath, Buffer.alloc(5 * 1024 * 1024 + 1, "x"));

    await assert.rejects(
      service.getCodeRange({
        filePath,
      }),
      CodeFileTooLargeError,
    );
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("getCodeRange reports missing files and directories", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "cui-code-query-"));
  const service = new CodeQueryService();

  try {
    await assert.rejects(
      service.getCodeRange({
        filePath: join(cwd, "missing.ts"),
        startLine: 1,
        endLine: 1,
      }),
      CodeFileNotFoundError,
    );

    await assert.rejects(
      service.getCodeRange({
        filePath: cwd,
        startLine: 1,
        endLine: 1,
      }),
      CodePathNotFileError,
    );
  } finally {
    await rm(cwd, { force: true, recursive: true });
  }
});

test("parseCodeRangeQuery validates file path and line range", () => {
  assert.deepEqual(
    parseCodeRangeQuery({
      filePath: "/tmp/example.ts",
    }),
    {
      ok: true,
      value: {
        filePath: "/tmp/example.ts",
      },
    },
  );

  assert.deepEqual(
    parseCodeRangeQuery({
      filePath: "/tmp/example.ts",
      startLine: "1",
      endLine: "3",
    }),
    {
      ok: true,
      value: {
        filePath: "/tmp/example.ts",
        startLine: 1,
        endLine: 3,
      },
    },
  );

  assert.deepEqual(parseCodeRangeQuery({ filePath: "", startLine: "1", endLine: "3" }), {
    ok: false,
    error: "filePath must be a non-empty string",
  });
  assert.deepEqual(parseCodeRangeQuery({ filePath: "/tmp/example.ts", startLine: "1" }), {
    ok: false,
    error: "startLine and endLine must be provided together",
  });
  assert.deepEqual(
    parseCodeRangeQuery({ filePath: "/tmp/example.ts", startLine: "0", endLine: "3" }),
    {
      ok: false,
      error: "startLine must be a positive integer",
    },
  );
  assert.deepEqual(
    parseCodeRangeQuery({ filePath: "/tmp/example.ts", startLine: "3", endLine: "1" }),
    {
      ok: false,
      error: "startLine must be less than or equal to endLine",
    },
  );
});

test("session request parsers accept model preferences", () => {
  assert.deepEqual(
    parseCreateSessionBody({
      workspace: "/tmp/workspace",
      title: "Implementation session",
      origin: "chat",
    }),
    {
      ok: true,
      value: {
        workspace: "/tmp/workspace",
        title: "Implementation session",
        origin: "chat",
      },
    },
  );

  assert.deepEqual(
    parseCreateRunBody({
      type: "assistant_response",
      input: {
        prompt: "Implement a change",
      },
      models: {
        normal: "GPT-5.4",
        summary: "Seed-2.1-Turbo",
        atomicReview: "DeepSeek-V4-Pro",
        reasoningEfforts: {
          normal: "high",
          summary: "low",
          atomicReview: "xhigh",
        },
      },
    }),
    {
      ok: true,
      value: {
        type: "assistant_response",
        input: {
          prompt: "Implement a change",
        },
        models: {
          normal: "GPT-5.4",
          summary: "Seed-2.1-Turbo",
          atomicReview: "DeepSeek-V4-Pro",
          reasoningEfforts: {
            normal: "high",
            summary: "low",
            atomicReview: "xhigh",
          },
        },
      },
    },
  );

  assert.deepEqual(
    parseCreateRunBody({
      type: "assistant_response",
      input: {
        prompt: "Continue the work",
      },
      models: {
        normal: "GPT-5.6-Sol",
        reasoningEfforts: {
          normal: "medium",
        },
      },
    }),
    {
      ok: true,
      value: {
        type: "assistant_response",
        input: {
          prompt: "Continue the work",
        },
        models: {
          normal: "GPT-5.6-Sol",
          reasoningEfforts: {
            normal: "medium",
          },
        },
      },
    },
  );

  assert.equal(
    parseCreateRunBody({
      type: "assistant_response",
      input: {
        prompt: "Implement a change",
      },
      models: {
        summary: "",
      },
    }).ok,
    false,
  );

  assert.equal(
    parseCreateRunBody({
      type: "assistant_response",
      input: {
        prompt: "Implement a change",
      },
      models: {
        reasoningEfforts: {
          normal: "invalid",
        },
      },
    }).ok,
    false,
  );
});
