export type MessagePart =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "heading";
      level: 1 | 2 | 3 | 4 | 5 | 6;
      text: string;
    }
  | {
      type: "codeBlock";
      code: string;
      language?: string;
    };

export type InlinePart =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "inlineCode";
      code: string;
    }
  | {
      type: "workspaceLink";
      label: string;
      target: CodeLinkTarget;
    }
  | {
      type: "link";
      label: string;
      href: string;
    }
  | {
      type: "strong";
      children: InlinePart[];
    }
  | {
      type: "emphasis";
      children: InlinePart[];
    };

export type CodeLinkTarget = {
  filePath: string;
  startLine?: number;
  endLine?: number;
};

export function parseMessageContent(content: string): MessagePart[] {
  return new BlockMarkdownParser(content).parse();
}

export function parseInlineContent(text: string, workspace: string): InlinePart[] {
  return new InlineMarkdownParser(text, workspace).parse().parts;
}

export function formatCodeLinkLabel(target: CodeLinkTarget, workspace: string): string {
  const displayPath = formatCodeLinkPath(target.filePath, workspace);

  if (target.startLine === undefined || target.endLine === undefined) {
    return displayPath;
  }

  if (target.startLine === target.endLine) {
    return `${displayPath}:${target.startLine}`;
  }

  return `${displayPath}:${target.startLine}-${target.endLine}`;
}

class BlockMarkdownParser {
  private cursor = 0;

  constructor(private readonly source: string) {}

  parse(): MessagePart[] {
    const parts: MessagePart[] = [];

    while (!this.isAtEnd()) {
      const codeBlock = this.parseFencedCodeBlock();

      if (codeBlock) {
        parts.push(codeBlock);
        continue;
      }

      const heading = this.parseHeading();

      if (heading) {
        parts.push(heading);
        continue;
      }

      this.parseTextBlock(parts);
    }

    return parts;
  }

  private parseFencedCodeBlock(): MessagePart | undefined {
    if (!this.startsWith("```")) {
      return undefined;
    }

    const blockStart = this.cursor;
    this.cursor += 3;
    const infoStart = this.cursor;
    this.cursor = this.readToLineEnd();
    const info = this.source.slice(infoStart, this.cursor).trim();
    this.consumeLineBreak();
    const codeStart = this.cursor;

    while (!this.isAtEnd()) {
      if (this.startsWith("```")) {
        const code = this.stripTrailingLineBreak(this.source.slice(codeStart, this.cursor));
        this.cursor += 3;
        this.cursor = this.readToLineEnd();
        this.consumeLineBreak();

        return isLanguageMarker(info)
          ? {
              type: "codeBlock",
              code,
              language: info,
            }
          : {
              type: "codeBlock",
              code,
            };
      }

      this.cursor = this.readLine();
    }

    return {
      type: "text",
      text: this.source.slice(blockStart),
    };
  }

  private parseHeading(): MessagePart | undefined {
    const lineEnd = this.readToLineEnd();
    const heading = parseAtxHeading(this.source.slice(this.cursor, lineEnd));

    if (!heading) {
      return undefined;
    }

    this.cursor = lineEnd;
    this.consumeLineBreak();
    return heading;
  }

  private parseTextBlock(parts: MessagePart[]) {
    const textStart = this.cursor;

    while (!this.isAtEnd()) {
      if (this.cursor > textStart && (this.startsWith("```") || this.currentLineIsHeading())) {
        break;
      }

      this.cursor = this.readLine();
    }

    const text = this.source.slice(textStart, this.cursor);

    if (text) {
      parts.push({
        type: "text",
        text,
      });
    }
  }

  private currentLineIsHeading(): boolean {
    return Boolean(parseAtxHeading(this.source.slice(this.cursor, this.readToLineEnd())));
  }

  private readLine(): number {
    const lineEnd = this.readToLineEnd();

    if (this.source[lineEnd] === "\r" && this.source[lineEnd + 1] === "\n") {
      return lineEnd + 2;
    }

    if (this.source[lineEnd] === "\n") {
      return lineEnd + 1;
    }

    return lineEnd;
  }

  private readToLineEnd(): number {
    let index = this.cursor;

    while (
      index < this.source.length &&
      this.source[index] !== "\n" &&
      this.source[index] !== "\r"
    ) {
      index += 1;
    }

    return index;
  }

  private consumeLineBreak() {
    if (this.source[this.cursor] === "\r" && this.source[this.cursor + 1] === "\n") {
      this.cursor += 2;
      return;
    }

    if (this.source[this.cursor] === "\n") {
      this.cursor += 1;
    }
  }

  private stripTrailingLineBreak(value: string): string {
    if (value.endsWith("\r\n")) {
      return value.slice(0, -2);
    }

    if (value.endsWith("\n") || value.endsWith("\r")) {
      return value.slice(0, -1);
    }

    return value;
  }

  private startsWith(value: string): boolean {
    return this.source.startsWith(value, this.cursor);
  }

  private isAtEnd(): boolean {
    return this.cursor >= this.source.length;
  }
}

class InlineMarkdownParser {
  private cursor = 0;

  constructor(
    private readonly source: string,
    private readonly workspace: string,
  ) {}

  parse(stopDelimiter?: string): { parts: InlinePart[]; closed: boolean } {
    const parts: InlinePart[] = [];

    while (!this.isAtEnd()) {
      if (stopDelimiter && this.startsUnescaped(stopDelimiter)) {
        this.cursor += stopDelimiter.length;
        return { parts, closed: true };
      }

      if (
        this.parseInlineCode(parts) ||
        this.parseEmphasis(parts) ||
        this.parseMarkdownLink(parts)
      ) {
        continue;
      }

      this.parseText(parts, stopDelimiter);
    }

    return { parts, closed: false };
  }

  private parseInlineCode(parts: InlinePart[]): boolean {
    if (!this.isSingleBacktick(this.cursor)) {
      return false;
    }

    const codeStart = this.cursor + 1;
    let codeEnd = codeStart;

    while (codeEnd < this.source.length && !this.isSingleBacktick(codeEnd)) {
      codeEnd += 1;
    }

    if (codeEnd >= this.source.length) {
      return false;
    }

    parts.push({
      type: "inlineCode",
      code: this.source.slice(codeStart, codeEnd),
    });
    this.cursor = codeEnd + 1;
    return true;
  }

  private parseEmphasis(parts: InlinePart[]): boolean {
    const delimiter = this.readEmphasisDelimiter();

    if (!delimiter) {
      return false;
    }

    this.cursor += delimiter.length;
    const parsed = this.parse(delimiter);

    if (!parsed.closed) {
      pushInlineTextPart(parts, delimiter);
      appendInlineParts(parts, parsed.parts);
      return true;
    }

    parts.push({
      type: delimiter.length === 2 ? "strong" : "emphasis",
      children: parsed.parts,
    });
    return true;
  }

  private parseMarkdownLink(parts: InlinePart[]): boolean {
    if (this.source[this.cursor] !== "[") {
      return false;
    }

    const start = this.cursor;
    const label = this.readLinkLabel();

    if (label === undefined || this.source[this.cursor] !== "(") {
      this.cursor = start;
      return false;
    }

    this.cursor += 1;
    const href = this.readLinkDestination();

    if (href === undefined) {
      this.cursor = start;
      return false;
    }

    const normalizedHref = normalizeMarkdownHref(href);
    const target = parseWorkspaceCodeLink(normalizedHref, this.workspace);

    parts.push(
      target
        ? {
            type: "workspaceLink",
            label: label || target.filePath,
            target,
          }
        : {
            type: "link",
            label: label || normalizedHref,
            href: normalizedHref,
          },
    );
    return true;
  }

  private parseText(parts: InlinePart[], stopDelimiter: string | undefined) {
    const textStart = this.cursor;

    this.cursor += 1;

    while (!this.isAtEnd()) {
      if ((stopDelimiter && this.startsUnescaped(stopDelimiter)) || this.isInlineConstructStart()) {
        break;
      }

      this.cursor += 1;
    }

    pushInlineTextPart(parts, this.source.slice(textStart, this.cursor));
  }

  private readLinkLabel(): string | undefined {
    this.cursor += 1;
    const labelStart = this.cursor;
    let depth = 0;

    while (!this.isAtEnd()) {
      if (this.isEscaped(this.cursor)) {
        this.cursor += 1;
        continue;
      }

      if (this.source[this.cursor] === "[") {
        depth += 1;
        this.cursor += 1;
        continue;
      }

      if (this.source[this.cursor] === "]") {
        if (depth === 0) {
          const label = this.source.slice(labelStart, this.cursor);
          this.cursor += 1;
          return label;
        }

        depth -= 1;
      }

      this.cursor += 1;
    }

    return undefined;
  }

  private readLinkDestination(): string | undefined {
    const hrefStart = this.cursor;
    let depth = 0;
    let inAngleBrackets = false;

    while (!this.isAtEnd()) {
      if (this.isEscaped(this.cursor)) {
        this.cursor += 1;
        continue;
      }

      const char = this.source[this.cursor];

      if (char === "<" && this.cursor === hrefStart) {
        inAngleBrackets = true;
        this.cursor += 1;
        continue;
      }

      if (inAngleBrackets) {
        if (char === ">" && this.source[this.cursor + 1] === ")") {
          const href = this.source.slice(hrefStart, this.cursor + 1);
          this.cursor += 2;
          return href;
        }

        this.cursor += 1;
        continue;
      }

      if (char === "(") {
        depth += 1;
        this.cursor += 1;
        continue;
      }

      if (char === ")") {
        if (depth === 0) {
          const href = this.source.slice(hrefStart, this.cursor);
          this.cursor += 1;
          return href;
        }

        depth -= 1;
      }

      this.cursor += 1;
    }

    return undefined;
  }

  private readEmphasisDelimiter(): string | undefined {
    if (this.startsUnescaped("**") || this.startsUnescaped("__")) {
      return this.source.slice(this.cursor, this.cursor + 2);
    }

    const char = this.source[this.cursor];

    if (char !== "*" && char !== "_") {
      return undefined;
    }

    if (this.source[this.cursor - 1] === char || this.source[this.cursor + 1] === char) {
      return undefined;
    }

    if (this.isEscaped(this.cursor)) {
      return undefined;
    }

    return char;
  }

  private isInlineConstructStart(): boolean {
    return (
      this.isSingleBacktick(this.cursor) ||
      this.source[this.cursor] === "[" ||
      Boolean(this.readEmphasisDelimiter())
    );
  }

  private isSingleBacktick(index: number): boolean {
    return (
      this.source[index] === "`" && this.source[index - 1] !== "`" && this.source[index + 1] !== "`"
    );
  }

  private startsUnescaped(value: string): boolean {
    return this.source.startsWith(value, this.cursor) && !this.isEscaped(this.cursor);
  }

  private isEscaped(index: number): boolean {
    let slashCount = 0;

    for (let cursor = index - 1; cursor >= 0 && this.source[cursor] === "\\"; cursor -= 1) {
      slashCount += 1;
    }

    return slashCount % 2 === 1;
  }

  private isAtEnd(): boolean {
    return this.cursor >= this.source.length;
  }
}

function pushInlineTextPart(parts: InlinePart[], text: string) {
  if (!text) {
    return;
  }

  const previousPart = parts.at(-1);

  if (previousPart?.type === "text") {
    previousPart.text += text;
    return;
  }

  parts.push({
    type: "text",
    text,
  });
}

function appendInlineParts(parts: InlinePart[], nextParts: InlinePart[]) {
  for (const part of nextParts) {
    if (part.type === "text") {
      pushInlineTextPart(parts, part.text);
      continue;
    }

    parts.push(part);
  }
}

function parseWorkspaceCodeLink(href: string, workspace: string): CodeLinkTarget | undefined {
  const decodedHref = decodeMarkdownHref(href);
  const rangeMatch = /^(.+):(\d+)(?:-(\d+))?$/.exec(decodedHref);
  const rawFilePath = rangeMatch ? rangeMatch[1] : decodedHref;
  const filePath = normalizePreviewFilePath(rawFilePath, workspace);
  const startLine = rangeMatch ? Number(rangeMatch[2]) : undefined;
  const endLine = rangeMatch ? Number(rangeMatch[3] ?? rangeMatch[2]) : undefined;

  if (!isPreviewableFilePath(filePath, workspace)) {
    return undefined;
  }

  return {
    filePath,
    ...(startLine && endLine ? { startLine, endLine } : {}),
  };
}

function normalizePreviewFilePath(filePath: string, workspace: string): string {
  if (filePath.startsWith("./")) {
    return `${trimTrailingSlashes(workspace)}/${filePath.slice(2)}`;
  }

  if (filePath.startsWith("../")) {
    return `${trimTrailingSlashes(workspace)}/${filePath}`;
  }

  if (isRelativePreviewFilePath(filePath)) {
    return `${trimTrailingSlashes(workspace)}/${filePath}`;
  }

  return filePath;
}

function formatCodeLinkPath(filePath: string, workspace: string): string {
  const comparableFilePath = normalizeComparableFilePath(filePath);
  const comparableWorkspace = normalizeComparableFilePath(workspace);

  if (
    comparableFilePath === comparableWorkspace ||
    comparableFilePath.startsWith(`${comparableWorkspace}/`)
  ) {
    const relativePath = comparableFilePath.slice(comparableWorkspace.length).replace(/^\/+/, "");
    return relativePath || ".";
  }

  return comparableFilePath;
}

function normalizeComparableFilePath(filePath: string): string {
  const withoutFileScheme = stripFileScheme(filePath);
  const [pathWithoutQuery] = withoutFileScheme.split(/[?#]/, 1);
  const normalizedPath = normalizePathSegments(pathWithoutQuery.replace(/\/+/g, "/"));

  return trimTrailingSlashes(normalizedPath) || "/";
}

function stripFileScheme(filePath: string): string {
  if (!filePath.startsWith("file://")) {
    return filePath;
  }

  try {
    return decodeURIComponent(new URL(filePath).pathname);
  } catch {
    return filePath;
  }
}

function normalizePathSegments(filePath: string): string {
  const isAbsolute = filePath.startsWith("/");
  const segments: string[] = [];

  for (const segment of filePath.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }

    if (segment === "..") {
      const previousSegment = segments.at(-1);

      if (previousSegment && previousSegment !== "..") {
        segments.pop();
        continue;
      }

      if (!isAbsolute) {
        segments.push(segment);
      }

      continue;
    }

    segments.push(segment);
  }

  const normalizedPath = segments.join("/");
  return isAbsolute ? `/${normalizedPath}` : normalizedPath;
}

function decodeMarkdownHref(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

function normalizeMarkdownHref(href: string): string {
  const trimmed = href.trim();

  if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function isPreviewableFilePath(filePath: string, workspace: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:/i.test(filePath) && !filePath.startsWith("file://")) {
    return false;
  }

  if (!filePath || filePath.startsWith("#") || filePath.startsWith("?")) {
    return false;
  }

  if (filePath.startsWith("file://")) {
    return true;
  }

  if (filePath.startsWith("/") || filePath.startsWith("~/") || filePath === "~") {
    return true;
  }

  if (filePath.startsWith("./") || filePath.startsWith("../")) {
    return true;
  }

  if (isRelativePreviewFilePath(filePath)) {
    return true;
  }

  const normalizedFilePath = trimTrailingSlashes(filePath);
  const normalizedWorkspace = trimTrailingSlashes(workspace);

  return (
    normalizedFilePath === normalizedWorkspace ||
    normalizedFilePath.startsWith(`${normalizedWorkspace}/`)
  );
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

function isRelativePreviewFilePath(filePath: string): boolean {
  return (
    !filePath.startsWith("/") &&
    !filePath.startsWith("~") &&
    !filePath.startsWith("#") &&
    !filePath.startsWith("?") &&
    !/^[a-z][a-z0-9+.-]*:/i.test(filePath)
  );
}

function isLanguageMarker(value: string): boolean {
  return Boolean(value) && /^[A-Za-z0-9_+.#-]+$/.test(value);
}

function parseAtxHeading(line: string): MessagePart | undefined {
  let level = 0;

  while (level < line.length && line[level] === "#") {
    level += 1;
  }

  if (level === 0 || level > 6 || !isSpaceOrTab(line[level])) {
    return undefined;
  }

  let textStart = level;

  while (isSpaceOrTab(line[textStart])) {
    textStart += 1;
  }

  let textEnd = trimRightSpaceOrTab(line, line.length);
  let closingStart = textEnd;

  while (closingStart > textStart && line[closingStart - 1] === "#") {
    closingStart -= 1;
  }

  if (closingStart < textEnd && closingStart > textStart && isSpaceOrTab(line[closingStart - 1])) {
    textEnd = trimRightSpaceOrTab(line, closingStart - 1);
  }

  const text = line.slice(textStart, textEnd);

  if (!text) {
    return undefined;
  }

  return {
    type: "heading",
    level: level as 1 | 2 | 3 | 4 | 5 | 6,
    text,
  };
}

function trimRightSpaceOrTab(value: string, end: number): number {
  let cursor = end;

  while (cursor > 0 && isSpaceOrTab(value[cursor - 1])) {
    cursor -= 1;
  }

  return cursor;
}

function isSpaceOrTab(value: string | undefined): boolean {
  return value === " " || value === "\t";
}
