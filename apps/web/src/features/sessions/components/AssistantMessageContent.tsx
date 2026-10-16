import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CodePreviewButton } from "../../code/components/CodePreviewPopup";
import {
  formatCodeLinkLabel,
  parseInlineContent,
  parseMessageContent,
  type InlinePart,
  type TableCellAlignment,
} from "../model/markdown";

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
          <MessageCodeBlock code={part.code} key={index} language={part.language} />
        ) : part.type === "table" ? (
          <MessageTable
            alignments={part.alignments}
            header={part.header}
            key={index}
            rawMarkdown={part.rawMarkdown}
            rows={part.rows}
            workspace={workspace}
            blockIndex={index}
          />
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

function MessageTable({
  alignments,
  blockIndex,
  header,
  rawMarkdown,
  rows,
  workspace,
}: {
  alignments: TableCellAlignment[];
  blockIndex: number;
  header: string[];
  rawMarkdown: string;
  rows: string[][];
  workspace: string;
}) {
  const copyFeedbackTimerRef = useRef<number | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    return () => {
      if (copyFeedbackTimerRef.current !== undefined) {
        window.clearTimeout(copyFeedbackTimerRef.current);
      }
    };
  }, []);

  async function copyMarkdownTable() {
    if (!navigator.clipboard) {
      return;
    }

    await navigator.clipboard.writeText(rawMarkdown);
    setCopied(true);

    if (copyFeedbackTimerRef.current !== undefined) {
      window.clearTimeout(copyFeedbackTimerRef.current);
    }

    copyFeedbackTimerRef.current = window.setTimeout(() => {
      setCopied(false);
      copyFeedbackTimerRef.current = undefined;
    }, 1200);
  }

  return (
    <div className="message-table-shell">
      <button
        aria-label="Copy markdown table"
        className="message-table-copy"
        onClick={copyMarkdownTable}
        title={copied ? "Copied" : "Copy markdown table"}
        type="button"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      <div className="message-table-scroll">
        <table className="message-table">
          <thead>
            <tr>
              {header.map((cell, cellIndex) => (
                <th
                  className={getTableCellClassName(alignments[cellIndex])}
                  key={`head-${cellIndex}`}
                  scope="col"
                >
                  {renderInlineContent(cell, workspace, blockIndex)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={`row-${rowIndex}`}>
                {row.map((cell, cellIndex) => (
                  <td
                    className={getTableCellClassName(alignments[cellIndex])}
                    key={`cell-${rowIndex}-${cellIndex}`}
                  >
                    {renderInlineContent(cell, workspace, blockIndex)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function getTableCellClassName(alignment: TableCellAlignment): string {
  return alignment ? `message-table-cell is-${alignment}-aligned` : "message-table-cell";
}

function MessageCodeBlock({ code, language }: { code: string; language?: string }) {
  const copyFeedbackTimerRef = useRef<number | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    return () => {
      if (copyFeedbackTimerRef.current !== undefined) {
        window.clearTimeout(copyFeedbackTimerRef.current);
      }
    };
  }, []);

  async function copyCodeBlock() {
    if (!navigator.clipboard) {
      return;
    }

    await navigator.clipboard.writeText(code);
    setCopied(true);

    if (copyFeedbackTimerRef.current !== undefined) {
      window.clearTimeout(copyFeedbackTimerRef.current);
    }

    copyFeedbackTimerRef.current = window.setTimeout(() => {
      setCopied(false);
      copyFeedbackTimerRef.current = undefined;
    }, 1200);
  }

  return (
    <div className="message-code-block-shell">
      <button
        aria-label="Copy code block"
        className="message-code-block-copy"
        onClick={copyCodeBlock}
        title={copied ? "Copied" : "Copy code"}
        type="button"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      <pre className="message-code-block">
        <code data-language={language}>{code}</code>
      </pre>
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
        workspace={workspace}
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
