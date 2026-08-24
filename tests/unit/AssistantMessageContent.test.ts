import assert from "node:assert/strict";
import test from "node:test";
import { parseInlineContent } from "../../apps/web/src/features/sessions/components/AssistantMessageContent.js";

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
