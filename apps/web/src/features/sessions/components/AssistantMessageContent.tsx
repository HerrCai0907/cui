import { FileCode, Loader2, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { HighlightedCode } from "../../review/components/HighlightedCode";
import { getCodeRange, type CodeRangeResult } from "../api/codeApi";

type MessagePart =
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

type InlinePart =
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
    };

type CodeLinkTarget = {
  filePath: string;
  startLine?: number;
  endLine?: number;
};

type CodePreviewState =
  | {
      status: "idle";
    }
  | {
      status: "loading";
    }
  | {
      status: "ready";
      result: CodeRangeResult;
    }
  | {
      status: "error";
      message: string;
    };

export function AssistantMessageContent({
  content,
  workspace,
}: {
  content: string;
  workspace: string;
}) {
  const parts = parseMessageContent(content);

  return (
    <div className="message-content">
      {parts.map((part, index) =>
        part.type === "codeBlock" ? (
          <pre className="message-code-block" key={index}>
            <code data-language={part.language}>{part.code}</code>
          </pre>
        ) : part.type === "heading" ? (
          <MessageHeading key={index} level={part.level}>
            {renderInlineContent(part.text, workspace, index)}
          </MessageHeading>
        ) : (
          <span className="message-text" key={index}>
            {renderInlineContent(part.text, workspace, index)}
          </span>
        ),
      )}
    </div>
  );
}

function MessageHeading({
  children,
  level,
}: {
  children: ReactNode;
  level: 1 | 2 | 3 | 4 | 5 | 6;
}) {
  const Tag = `h${level}` as const;

  return <Tag className={`message-heading message-heading-${level}`}>{children}</Tag>;
}

function parseMessageContent(content: string): MessagePart[] {
  const parts: MessagePart[] = [];
  let cursor = 0;

  while (cursor < content.length) {
    const fenceStart = content.indexOf("```", cursor);

    if (fenceStart === -1) {
      pushTextPart(parts, content.slice(cursor));
      break;
    }

    const fenceEnd = content.indexOf("```", fenceStart + 3);

    if (fenceEnd === -1) {
      pushTextPart(parts, content.slice(cursor));
      break;
    }

    pushTextPart(parts, content.slice(cursor, fenceStart));
    parts.push(parseCodeBlock(content.slice(fenceStart + 3, fenceEnd)));
    cursor = fenceEnd + 3;
  }

  return parts;
}

function parseCodeBlock(rawCode: string): MessagePart {
  const firstLineBreak = rawCode.search(/\r?\n/);

  if (firstLineBreak === -1) {
    return {
      type: "codeBlock",
      code: rawCode,
    };
  }

  const firstLine = rawCode.slice(0, firstLineBreak).trim();
  const code = rawCode
    .slice(firstLineBreak)
    .replace(/^\r?\n/, "")
    .replace(/\r?\n$/, "");

  if (!isLanguageMarker(firstLine)) {
    return {
      type: "codeBlock",
      code: rawCode.replace(/^\r?\n/, "").replace(/\r?\n$/, ""),
    };
  }

  return {
    type: "codeBlock",
    code,
    language: firstLine,
  };
}

function renderInlineContent(text: string, workspace: string, blockIndex: number): ReactNode[] {
  return parseInlineContent(text, workspace).map((part, index) =>
    part.type === "inlineCode" ? (
      <code className="message-inline-code" key={`${blockIndex}-${index}`}>
        {part.code}
      </code>
    ) : part.type === "workspaceLink" ? (
      <CodePreviewButton key={`${blockIndex}-${index}`} label={part.label} target={part.target} />
    ) : part.type === "link" ? (
      <a
        className="message-link"
        href={part.href}
        key={`${blockIndex}-${index}`}
        rel="noreferrer"
        target={isExternalHref(part.href) ? "_blank" : undefined}
      >
        {part.label}
      </a>
    ) : (
      <span key={`${blockIndex}-${index}`}>{part.text}</span>
    ),
  );
}

export function parseInlineContent(text: string, workspace: string): InlinePart[] {
  const parts: InlinePart[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const codeStart = findSingleBacktick(text, cursor);
    const linkStart = text.indexOf("[", cursor);
    const nextStart = findNextInlineToken(codeStart, linkStart);

    if (nextStart === -1) {
      pushInlineTextPart(parts, text.slice(cursor));
      break;
    }

    if (nextStart === codeStart) {
      const codeEnd = findSingleBacktick(text, codeStart + 1);

      if (codeEnd === -1) {
        pushInlineTextPart(parts, text.slice(cursor));
        break;
      }

      pushInlineTextPart(parts, text.slice(cursor, codeStart));
      parts.push({
        type: "inlineCode",
        code: text.slice(codeStart + 1, codeEnd),
      });
      cursor = codeEnd + 1;
      continue;
    }

    const parsedLink = parseMarkdownLinkAt(text, linkStart, workspace);

    if (!parsedLink) {
      pushInlineTextPart(parts, text.slice(cursor, linkStart + 1));
      cursor = linkStart + 1;
      continue;
    }

    pushInlineTextPart(parts, text.slice(cursor, linkStart));
    parts.push(parsedLink.part);
    cursor = parsedLink.endIndex;
  }

  return parts;
}

function findSingleBacktick(text: string, startIndex: number): number {
  for (let index = startIndex; index < text.length; index += 1) {
    if (text[index] !== "`") {
      continue;
    }

    if (text[index - 1] === "`" || text[index + 1] === "`") {
      continue;
    }

    return index;
  }

  return -1;
}

function pushTextPart(parts: MessagePart[], text: string) {
  if (!text) {
    return;
  }

  const lines = text.match(/[^\r\n]*(?:\r?\n|$)/g) ?? [];
  let pendingText = "";

  for (const line of lines) {
    if (!line) {
      continue;
    }

    const heading = parseHeadingLine(line);

    if (!heading) {
      pendingText += line;
      continue;
    }

    if (pendingText) {
      parts.push({
        type: "text",
        text: pendingText,
      });
      pendingText = "";
    }

    parts.push(heading);
  }

  if (!pendingText) {
    return;
  }

  parts.push({
    type: "text",
    text: pendingText,
  });
}

function pushInlineTextPart(parts: InlinePart[], text: string) {
  if (!text) {
    return;
  }

  parts.push({
    type: "text",
    text,
  });
}

function findNextInlineToken(codeStart: number, linkStart: number): number {
  if (codeStart === -1) {
    return linkStart;
  }

  if (linkStart === -1) {
    return codeStart;
  }

  return Math.min(codeStart, linkStart);
}

function parseMarkdownLinkAt(
  text: string,
  startIndex: number,
  workspace: string,
): { part: InlinePart; endIndex: number } | undefined {
  const labelEnd = text.indexOf("]", startIndex + 1);

  if (labelEnd === -1 || text[labelEnd + 1] !== "(") {
    return undefined;
  }

  const hrefEnd = text.indexOf(")", labelEnd + 2);

  if (hrefEnd === -1) {
    return undefined;
  }

  const label = text.slice(startIndex + 1, labelEnd);
  const href = normalizeMarkdownHref(text.slice(labelEnd + 2, hrefEnd));
  const target = parseWorkspaceCodeLink(href, workspace);

  return {
    part: target
      ? {
          type: "workspaceLink",
          label: label || target.filePath,
          target,
        }
      : {
          type: "link",
          label: label || href,
          href,
        },
    endIndex: hrefEnd + 1,
  };
}

function parseWorkspaceCodeLink(href: string, workspace: string): CodeLinkTarget | undefined {
  const decodedHref = decodeMarkdownHref(href);
  const rangeMatch = /^(.+):(\d+)(?:-(\d+))?$/.exec(decodedHref);
  const filePath = rangeMatch ? rangeMatch[1] : decodedHref;
  const startLine = rangeMatch ? Number(rangeMatch[2]) : undefined;
  const endLine = rangeMatch ? Number(rangeMatch[3] ?? rangeMatch[2]) : undefined;

  if (!isWorkspaceFilePath(filePath, workspace)) {
    return undefined;
  }

  return {
    filePath,
    ...(startLine && endLine ? { startLine, endLine } : {}),
  };
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

function isExternalHref(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href);
}

function isWorkspaceFilePath(filePath: string, workspace: string): boolean {
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

function CodePreviewButton({ label, target }: { label: string; target: CodeLinkTarget }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<CodePreviewState>({ status: "idle" });

  async function openPreview() {
    if (open) {
      setOpen(false);
      return;
    }

    setOpen(true);

    if (preview.status === "ready" || preview.status === "loading") {
      return;
    }

    setPreview({ status: "loading" });

    try {
      const result = await getCodeRange(target);
      setPreview({ status: "ready", result });
    } catch (error) {
      setPreview({
        status: "error",
        message: error instanceof Error ? error.message : "Failed to load code",
      });
    }
  }

  return (
    <span className="message-code-preview">
      <button
        className="message-code-link"
        type="button"
        aria-expanded={open}
        onClick={openPreview}
        title={target.filePath}
      >
        <FileCode size={14} />
        {label}
      </button>
      {open && (
        <span className="message-code-card" role="dialog" aria-label="Code preview">
          <span className="message-code-card-header">
            <span className="message-code-card-title">
              {target.filePath}
              {target.startLine && target.endLine
                ? `:${target.startLine}${target.startLine === target.endLine ? "" : `-${target.endLine}`}`
                : ""}
            </span>
            <button
              className="message-code-card-close"
              type="button"
              aria-label="Close code preview"
              onClick={() => setOpen(false)}
            >
              <X size={14} />
            </button>
          </span>
          {preview.status === "loading" && (
            <span className="message-code-card-status">
              <Loader2 size={14} />
              Loading
            </span>
          )}
          {preview.status === "error" && (
            <span className="message-code-card-error">{preview.message}</span>
          )}
          {preview.status === "ready" && (
            <span className="message-code-card-block">
              <code>
                <HighlightedCode content={preview.result.code} filePath={preview.result.filePath} />
              </code>
            </span>
          )}
        </span>
      )}
    </span>
  );
}

function isLanguageMarker(value: string): boolean {
  return Boolean(value) && /^[A-Za-z0-9_+.#-]+$/.test(value);
}

function parseHeadingLine(line: string): MessagePart | null {
  const lineBreak = line.match(/\r?\n$/)?.[0] ?? "";
  const content = line.slice(0, line.length - lineBreak.length);
  const headingMatch = /^(#{1,6})[ \t]+(.+?)[ \t]*$/.exec(content);

  if (!headingMatch) {
    return null;
  }

  const headingText = headingMatch[2].replace(/[ \t]+#{1,}[ \t]*$/, "");

  return {
    type: "heading",
    level: headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6,
    text: headingText,
  };
}
