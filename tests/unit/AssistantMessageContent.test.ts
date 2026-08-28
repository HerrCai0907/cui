import assert from "node:assert/strict";
import test from "node:test";
import {
  parseInlineContent,
  parseMessageContent,
} from "../../apps/web/src/features/sessions/model/markdown.js";

test("parseInlineContent converts workspace markdown links to code preview targets", () => {
  assert.deepEqual(
    parseInlineContent(
      "See [codeRoutes.ts](/Users/bytedance/cui_workspace/3/apps/api/src/http/routes/codeRoutes.ts:10-20).",
      "/Users/bytedance/cui_workspace/3",
    ),
    [
      { type: "text", text: "See " },
      {
        type: "workspaceLink",
        label: "codeRoutes.ts",
        target: {
          filePath: "/Users/bytedance/cui_workspace/3/apps/api/src/http/routes/codeRoutes.ts",
          startLine: 10,
          endLine: 20,
        },
      },
      { type: "text", text: "." },
    ],
  );
});

test("parseInlineContent keeps whole-file workspace links and normal external links distinct", () => {
  assert.deepEqual(
    parseInlineContent(
      "Open [local](/Users/bytedance/cui_workspace/3/README.md) or [docs](https://example.com).",
      "/Users/bytedance/cui_workspace/3",
    ),
    [
      { type: "text", text: "Open " },
      {
        type: "workspaceLink",
        label: "local",
        target: {
          filePath: "/Users/bytedance/cui_workspace/3/README.md",
        },
      },
      { type: "text", text: " or " },
      {
        type: "link",
        label: "docs",
        href: "https://example.com",
      },
      { type: "text", text: "." },
    ],
  );
});

test("parseInlineContent converts local markdown links outside the workspace to code previews", () => {
  assert.deepEqual(
    parseInlineContent(
      "Open [tmp](/tmp/rog-stack-growth-gc-repro-goroutine.go:12) and [home](~/.config/example.txt).",
      "/Users/bytedance/cui_workspace/3",
    ),
    [
      { type: "text", text: "Open " },
      {
        type: "workspaceLink",
        label: "tmp",
        target: {
          filePath: "/tmp/rog-stack-growth-gc-repro-goroutine.go",
          startLine: 12,
          endLine: 12,
        },
      },
      { type: "text", text: " and " },
      {
        type: "workspaceLink",
        label: "home",
        target: {
          filePath: "~/.config/example.txt",
        },
      },
      { type: "text", text: "." },
    ],
  );
});

test("parseInlineContent resolves relative local markdown links against the workspace", () => {
  assert.deepEqual(
    parseInlineContent(
      "Open [relative](./src/app.tsx:3-4), [readme](README.md), or [parent](../shared/file.md).",
      "/Users/bytedance/cui_workspace/3",
    ),
    [
      { type: "text", text: "Open " },
      {
        type: "workspaceLink",
        label: "relative",
        target: {
          filePath: "/Users/bytedance/cui_workspace/3/src/app.tsx",
          startLine: 3,
          endLine: 4,
        },
      },
      { type: "text", text: ", " },
      {
        type: "workspaceLink",
        label: "readme",
        target: {
          filePath: "/Users/bytedance/cui_workspace/3/README.md",
        },
      },
      { type: "text", text: ", or " },
      {
        type: "workspaceLink",
        label: "parent",
        target: {
          filePath: "/Users/bytedance/cui_workspace/3/../shared/file.md",
        },
      },
      { type: "text", text: "." },
    ],
  );
});

test("parseInlineContent renders markdown bold and italic inline spans", () => {
  assert.deepEqual(
    parseInlineContent(
      "Use **bold `code`** and *italic [docs](https://example.com)*.",
      "/Users/bytedance/cui_workspace/3",
    ),
    [
      { type: "text", text: "Use " },
      {
        type: "strong",
        children: [
          { type: "text", text: "bold " },
          { type: "inlineCode", code: "code" },
        ],
      },
      { type: "text", text: " and " },
      {
        type: "emphasis",
        children: [
          { type: "text", text: "italic " },
          {
            type: "link",
            label: "docs",
            href: "https://example.com",
          },
        ],
      },
      { type: "text", text: "." },
    ],
  );
});

test("parseInlineContent handles nested emphasis with recursive parsing", () => {
  assert.deepEqual(parseInlineContent("Use **bold and *nested*** text.", "/workspace"), [
    { type: "text", text: "Use " },
    {
      type: "strong",
      children: [
        { type: "text", text: "bold and " },
        {
          type: "emphasis",
          children: [{ type: "text", text: "nested" }],
        },
      ],
    },
    { type: "text", text: " text." },
  ]);
});

test("parseInlineContent preserves unmatched delimiters as text", () => {
  assert.deepEqual(parseInlineContent("Use **bold and `code`", "/workspace"), [
    { type: "text", text: "Use **bold and " },
    { type: "inlineCode", code: "code" },
  ]);
});

test("parseInlineContent keeps unmatched underscore before inline code as text", () => {
  assert.deepEqual(parseInlineContent("_\n`a_b`", "/workspace"), [
    { type: "text", text: "_\n" },
    { type: "inlineCode", code: "a_b" },
  ]);
});

test("parseMessageContent parses headings, text, and fenced code blocks", () => {
  assert.deepEqual(
    parseMessageContent("# Title\nIntro\n```ts\nconst value = 1;\n```\n## Next ##\n"),
    [
      {
        type: "heading",
        level: 1,
        text: "Title",
      },
      {
        type: "text",
        text: "Intro\n",
      },
      {
        type: "codeBlock",
        language: "ts",
        code: "const value = 1;",
      },
      {
        type: "heading",
        level: 2,
        text: "Next",
      },
    ],
  );
});

test("parseMessageContent keeps unmatched fences as text", () => {
  assert.deepEqual(parseMessageContent("Before\n```ts\nconst value = 1;\n"), [
    {
      type: "text",
      text: "Before\n",
    },
    {
      type: "text",
      text: "```ts\nconst value = 1;\n",
    },
  ]);
});
