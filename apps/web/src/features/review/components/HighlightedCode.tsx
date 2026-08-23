import hljs from "highlight.js/lib/common";

type HighlightedCodeProps = {
  content: string;
  filePath: string;
};

const EXTENSION_LANGUAGES: Record<string, string> = {
  "c++": "cpp",
  C: "cpp",
  c: "c",
  cc: "cpp",
  clj: "clojure",
  cmake: "cmake",
  cp: "cpp",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  cts: "typescript",
  cxx: "cpp",
  dart: "dart",
  diff: "diff",
  Dockerfile: "dockerfile",
  erl: "erlang",
  ex: "elixir",
  exs: "elixir",
  fs: "fsharp",
  go: "go",
  graphql: "graphql",
  groovy: "groovy",
  h: "cpp",
  hh: "cpp",
  hpp: "cpp",
  hs: "haskell",
  htm: "html",
  html: "html",
  hxx: "cpp",
  ipp: "cpp",
  java: "java",
  jl: "julia",
  cjs: "javascript",
  js: "javascript",
  json: "json",
  jsx: "jsx",
  kt: "kotlin",
  kts: "kotlin",
  less: "less",
  lua: "lua",
  Makefile: "makefile",
  md: "markdown",
  mjs: "javascript",
  ml: "ocaml",
  mts: "typescript",
  mtsx: "tsx",
  php: "php",
  pl: "perl",
  pm: "perl",
  ps1: "powershell",
  py: "python",
  r: "r",
  rb: "ruby",
  rs: "rust",
  scss: "scss",
  sh: "bash",
  sql: "sql",
  swift: "swift",
  toml: "toml",
  tpp: "cpp",
  ts: "typescript",
  tsx: "tsx",
  vue: "xml",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "bash",
};

const FILE_LANGUAGES: Record<string, string> = {
  ".bashrc": "bash",
  ".gitignore": "plaintext",
  ".zprofile": "bash",
  ".zshrc": "bash",
  "CMakeLists.txt": "cmake",
  Dockerfile: "dockerfile",
  Makefile: "makefile",
};

export function HighlightedCode({ content, filePath }: HighlightedCodeProps) {
  const highlighted = highlightCode(content, languageForFilePath(filePath));

  if (!highlighted) {
    return <>{content}</>;
  }

  return (
    <span
      className="review-diff-code-highlight"
      dangerouslySetInnerHTML={{ __html: highlighted }}
    />
  );
}

export function highlightCode(content: string, language: string | undefined): string | undefined {
  if (!language || !hljs.getLanguage(language)) {
    return undefined;
  }

  try {
    return hljs.highlight(content, { language, ignoreIllegals: true }).value;
  } catch {
    return undefined;
  }
}

export function languageForFilePath(filePath: string): string | undefined {
  const fileName = filePath.split("/").at(-1) ?? filePath;
  const exactMatch = FILE_LANGUAGES[fileName];

  if (exactMatch) {
    return exactMatch;
  }

  const extension = fileName.includes(".") ? fileName.split(".").at(-1) : fileName;

  return extension ? EXTENSION_LANGUAGES[extension] : undefined;
}
