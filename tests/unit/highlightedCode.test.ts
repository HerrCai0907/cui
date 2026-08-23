import assert from "node:assert/strict";
import test from "node:test";
import {
  highlightCode,
  languageForFilePath,
} from "../../apps/web/src/features/review/components/HighlightedCode.js";

const REQUIRED_LANGUAGE_CASES = [
  {
    filePath: "src/example.js",
    language: "javascript",
    code: "const answer = 42;",
    tokenClass: "hljs-keyword",
  },
  {
    filePath: "src/example.ts",
    language: "typescript",
    code: "type User = { id: number };",
    tokenClass: "hljs-keyword",
  },
  {
    filePath: "src/example.css",
    language: "css",
    code: ".panel { color: red; }",
    tokenClass: "hljs-selector-class",
  },
  {
    filePath: "src/example.html",
    language: "html",
    code: '<main class="panel">Hi</main>',
    tokenClass: "hljs-tag",
  },
  {
    filePath: "src/example.json",
    language: "json",
    code: '{ "enabled": true }',
    tokenClass: "hljs-attr",
  },
  {
    filePath: "src/example.go",
    language: "go",
    code: "func main() { return }",
    tokenClass: "hljs-keyword",
  },
  {
    filePath: "src/example.rs",
    language: "rust",
    code: "let answer: i32 = 42;",
    tokenClass: "hljs-keyword",
  },
  {
    filePath: "src/example.cpp",
    language: "cpp",
    code: "int main() { return 0; }",
    tokenClass: "hljs-keyword",
  },
] as const;

test("review diff highlighting supports required code languages", () => {
  for (const { filePath, language, code, tokenClass } of REQUIRED_LANGUAGE_CASES) {
    assert.equal(languageForFilePath(filePath), language);
    assert.match(highlightCode(code, language) ?? "", new RegExp(`class="${tokenClass}"`));
  }
});
