import { ChevronDown, ChevronUp, FileCode, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { HighlightedCode } from "../../review/components/HighlightedCode";
import { getCodeRange, type CodeRangeResult } from "../api/codeApi";
import {
  formatCodeLinkLabel,
  parseInlineContent,
  parseMessageContent,
  type CodeLinkTarget,
  type InlinePart,
} from "../model/markdown";

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

function renderInlineContent(text: string, workspace: string, blockIndex: number): ReactNode[] {
  return renderInlineParts(parseInlineContent(text, workspace), workspace, blockIndex);
}

function renderInlineParts(
  parts: InlinePart[],
  workspace: string,
  parentBlockIndex: number,
  parentPartIndex?: number,
): ReactNode[] {
  const keyPrefix =
    parentPartIndex === undefined
      ? String(parentBlockIndex)
      : `${parentBlockIndex}-${parentPartIndex}`;

  return parts.map((part, index) =>
    part.type === "inlineCode" ? (
      <code className="message-inline-code" key={`${keyPrefix}-${index}`}>
        {part.code}
      </code>
    ) : part.type === "workspaceLink" ? (
      <CodePreviewButton
        key={`${keyPrefix}-${index}`}
        label={formatCodeLinkLabel(part.target, workspace)}
        target={part.target}
      />
    ) : part.type === "link" ? (
      <a
        className="message-link"
        href={part.href}
        key={`${keyPrefix}-${index}`}
        rel="noreferrer"
        target={isExternalHref(part.href) ? "_blank" : undefined}
      >
        {part.label}
      </a>
    ) : part.type === "strong" ? (
      <strong key={`${keyPrefix}-${index}`}>
        {renderInlineParts(part.children, workspace, parentBlockIndex, index)}
      </strong>
    ) : part.type === "emphasis" ? (
      <em key={`${keyPrefix}-${index}`}>
        {renderInlineParts(part.children, workspace, parentBlockIndex, index)}
      </em>
    ) : (
      <span key={`${keyPrefix}-${index}`}>{part.text}</span>
    ),
  );
}

function isExternalHref(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href);
}

function CodePreviewButton({ label, target }: { label: string; target: CodeLinkTarget }) {
  const previewRef = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<CodePreviewState>({ status: "idle" });
  const [query, setQuery] = useState<CodeLinkTarget>(() => getInitialCodePreviewQuery(target));

  useEffect(() => {
    if (!open) {
      return;
    }

    function closeOnOutsidePointerDown(event: PointerEvent) {
      if (!(event.target instanceof Node) || previewRef.current?.contains(event.target)) {
        return;
      }

      setOpen(false);
    }

    document.addEventListener("pointerdown", closeOnOutsidePointerDown);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointerDown);
    };
  }, [open]);

  async function openPreview() {
    if (open) {
      setOpen(false);
      return;
    }

    setOpen(true);

    if (preview.status === "ready" || preview.status === "loading") {
      return;
    }

    await loadPreview(query);
  }

  async function loadPreview(nextQuery: CodeLinkTarget) {
    setQuery(nextQuery);
    setPreview({ status: "loading" });

    try {
      const result = await getCodeRange(nextQuery);
      setPreview({ status: "ready", result });
    } catch (error) {
      setPreview({
        status: "error",
        message: error instanceof Error ? error.message : "Failed to load code",
      });
    }
  }

  function expandBackward() {
    if (preview.status !== "ready") {
      return;
    }

    void loadPreview({
      filePath: preview.result.filePath,
      startLine: Math.max(1, preview.result.startLine - 10),
      endLine: preview.result.endLine,
    });
  }

  function expandForward() {
    if (preview.status !== "ready") {
      return;
    }

    void loadPreview({
      filePath: preview.result.filePath,
      startLine: preview.result.startLine,
      endLine: preview.result.endLine + 10,
    });
  }

  const hasRange = query.startLine !== undefined && query.endLine !== undefined;

  return (
    <span className="message-code-preview" ref={previewRef}>
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
              {hasRange
                ? `:${query.startLine}${query.startLine === query.endLine ? "" : `-${query.endLine}`}`
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
          {preview.status === "ready" && hasRange && (
            <span className="message-code-card-actions">
              <button
                className="message-code-card-action"
                type="button"
                onClick={expandBackward}
                disabled={preview.result.startLine <= 1}
                title="Show 10 previous lines"
                aria-label="Show 10 previous lines"
              >
                <ChevronUp size={14} />
              </button>
              <span className="message-code-card-range">
                Lines {preview.result.startLine}-{preview.result.endLine}
              </span>
              <button
                className="message-code-card-action"
                type="button"
                onClick={expandForward}
                title="Show 10 next lines"
                aria-label="Show 10 next lines"
              >
                <ChevronDown size={14} />
              </button>
            </span>
          )}
        </span>
      )}
    </span>
  );
}

function getInitialCodePreviewQuery(target: CodeLinkTarget): CodeLinkTarget {
  if (
    target.startLine !== undefined &&
    target.endLine !== undefined &&
    target.startLine === target.endLine
  ) {
    return {
      filePath: target.filePath,
      startLine: target.startLine,
      endLine: target.endLine + 10,
    };
  }

  return target;
}
