import type { ReactNode } from "react";

type MessagePart =
  | {
      type: "text";
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
    };

export function AssistantMessageContent({ content }: { content: string }) {
  const parts = parseMessageContent(content);

  return (
    <div className="message-content">
      {parts.map((part, index) =>
        part.type === "codeBlock" ? (
          <pre className="message-code-block" key={index}>
            <code data-language={part.language}>{part.code}</code>
          </pre>
        ) : (
          <span className="message-text" key={index}>
            {renderInlineCode(part.text, index)}
          </span>
        ),
      )}
    </div>
  );
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

function renderInlineCode(text: string, blockIndex: number): ReactNode[] {
  return parseInlineCode(text).map((part, index) =>
    part.type === "inlineCode" ? (
      <code className="message-inline-code" key={`${blockIndex}-${index}`}>
        {part.code}
      </code>
    ) : (
      <span key={`${blockIndex}-${index}`}>{part.text}</span>
    ),
  );
}

function parseInlineCode(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const codeStart = findSingleBacktick(text, cursor);

    if (codeStart === -1) {
      pushInlineTextPart(parts, text.slice(cursor));
      break;
    }

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

  parts.push({
    type: "text",
    text,
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

function isLanguageMarker(value: string): boolean {
  return Boolean(value) && /^[A-Za-z0-9_+.#-]+$/.test(value);
}
