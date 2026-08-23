import {
  CheckCircle2,
  Circle,
  ListChecks,
  MessageSquare,
  Play,
  Terminal,
  TextSearch,
} from "lucide-react";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import type {
  ExecutionTraceEvent,
  ExecutionTraceItem,
  TodoListTraceItemEntry,
  TokenUsage,
} from "../../../types";
import { shortId } from "../../../shared/lib/ids";
import { formatExecutionTraceSummary, parseExecutionTrace } from "../model/parseExecutionTrace";

type TraceViewProps = {
  content: string;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
};

export function TraceView({ content, expanded, onExpandedChange }: TraceViewProps) {
  const events = parseExecutionTrace(content);
  const traceListRef = useRef<HTMLOListElement | null>(null);
  const shouldAutoScrollRef = useRef(true);

  useLayoutEffect(() => {
    const traceList = traceListRef.current;

    if (!expanded || !traceList || !shouldAutoScrollRef.current) {
      return;
    }

    traceList.scrollTop = traceList.scrollHeight;
  }, [content, expanded]);

  const updateAutoScroll = () => {
    const traceList = traceListRef.current;

    if (!traceList) {
      return;
    }

    const distanceFromBottom =
      traceList.scrollHeight - traceList.scrollTop - traceList.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom <= 8;
  };

  return (
    <details
      className="trace-details"
      open={expanded}
      onToggle={(event) => onExpandedChange(event.currentTarget.open)}
    >
      <summary>
        <span>{expanded ? "Hide execution trace" : "Show execution trace"}</span>
        <small>{formatExecutionTraceSummary(events)}</small>
      </summary>
      <ol className="trace-list" onScroll={updateAutoScroll} ref={traceListRef}>
        {events.map((event, index) => (
          <TraceEventRow event={event} key={index} />
        ))}
      </ol>
    </details>
  );
}

function TraceEventRow({ event }: { event: ExecutionTraceEvent }) {
  const view = describeTraceEvent(event);

  return (
    <li className={`trace-event ${view.tone}`}>
      <div className="trace-event-icon">{view.icon}</div>
      <div className="trace-event-body">
        <div className="trace-event-header">
          <strong>{view.title}</strong>
          {view.meta && <small>{view.meta}</small>}
        </div>
        {view.content}
      </div>
    </li>
  );
}

function describeTraceEvent(event: ExecutionTraceEvent): {
  title: string;
  meta?: string;
  content?: ReactNode;
  tone: string;
  icon: ReactNode;
} {
  if (event.type === "thread.started") {
    return {
      title: "Thread started",
      meta: shortId(event.thread_id),
      tone: "trace-event-neutral",
      icon: <Play size={14} />,
    };
  }

  if (event.type === "turn.started") {
    return {
      title: "Turn started",
      tone: "trace-event-neutral",
      icon: <Play size={14} />,
    };
  }

  if (event.type === "turn.completed") {
    return {
      title: "Turn completed",
      meta: event.usage ? formatUsage(event.usage) : undefined,
      tone: "trace-event-success",
      icon: <CheckCircle2 size={14} />,
    };
  }

  if (
    event.type === "item.started" ||
    event.type === "item.updated" ||
    event.type === "item.completed"
  ) {
    const item = describeTraceItem(event.item);
    const status = formatTraceItemEventStatus(event.type);

    return {
      title: item.title,
      meta: [status, item.meta].filter(Boolean).join(" / "),
      content: item.content,
      tone: item.tone,
      icon: event.type === "item.started" ? item.startedIcon : item.completedIcon,
    };
  }

  if (event.type === "event_msg") {
    return {
      title: formatEventName(event.payload.type ?? "event message"),
      content: formatPreformattedContent(formatLegacyMessage(event.payload)),
      tone: "trace-event-neutral",
      icon: <Circle size={12} />,
    };
  }

  if (event.type === "session_meta") {
    return {
      title: "Session metadata",
      meta: shortId(stringValue(event.payload.id)),
      content: formatPreformattedContent(formatJson(event.payload)),
      tone: "trace-event-neutral",
      icon: <TextSearch size={14} />,
    };
  }

  if (event.type === "response_item") {
    return {
      title: `Response item${event.payload.type ? `: ${formatEventName(String(event.payload.type))}` : ""}`,
      content: formatPreformattedContent(formatJson(event.payload)),
      tone: "trace-event-neutral",
      icon: <TextSearch size={14} />,
    };
  }

  if (event.type === "text_delta") {
    return {
      title: "Text delta",
      content: formatPreformattedContent(event.text ?? event.delta),
      tone: "trace-event-message",
      icon: <MessageSquare size={14} />,
    };
  }

  if (event.type === "stdout") {
    return {
      title: "Stdout",
      content: formatPreformattedContent(event.text),
      tone: "trace-event-command",
      icon: <Terminal size={14} />,
    };
  }

  return {
    title: "Unknown event",
    content: formatPreformattedContent(formatJson(event.raw)),
    tone: "trace-event-neutral",
    icon: <TextSearch size={14} />,
  };
}

function describeTraceItem(item: ExecutionTraceItem): {
  title: string;
  meta?: string;
  content?: ReactNode;
  tone: string;
  startedIcon: ReactNode;
  completedIcon: ReactNode;
} {
  if (item.type === "command_execution") {
    const status = item.status ?? "unknown";
    const exitCode =
      item.exit_code === undefined ? undefined : `exit ${item.exit_code ?? "pending"}`;

    return {
      title: item.command ? `Command: ${item.command}` : "Command execution",
      meta: [status, exitCode].filter(Boolean).join(" / "),
      content: formatPreformattedContent(item.aggregated_output?.trim()),
      tone:
        status === "completed" && item.exit_code === 0
          ? "trace-event-success"
          : "trace-event-command",
      startedIcon: <Terminal size={14} />,
      completedIcon: <Terminal size={14} />,
    };
  }

  if (item.type === "agent_message") {
    return {
      title: "Assistant message",
      content: formatPreformattedContent(item.text),
      tone: "trace-event-message",
      startedIcon: <MessageSquare size={14} />,
      completedIcon: <MessageSquare size={14} />,
    };
  }

  if (item.type === "reasoning") {
    return {
      title: "Reasoning",
      content: formatPreformattedContent(item.text),
      tone: "trace-event-reasoning",
      startedIcon: <TextSearch size={14} />,
      completedIcon: <TextSearch size={14} />,
    };
  }

  if (item.type === "todo_list") {
    const completedCount = item.items.filter((todo) => todo.completed).length;
    const totalCount = item.items.length;

    return {
      title: "Todo list",
      meta: `${completedCount}/${totalCount} done`,
      content: <TodoList items={item.items} />,
      tone: "trace-event-todo",
      startedIcon: <ListChecks size={14} />,
      completedIcon: <ListChecks size={14} />,
    };
  }

  return {
    title: item.originalType ? formatEventName(item.originalType) : "Unknown item",
    meta: shortId(item.id),
    content: formatPreformattedContent(formatJson(item)),
    tone: "trace-event-neutral",
    startedIcon: <Circle size={12} />,
    completedIcon: <CheckCircle2 size={14} />,
  };
}

function TodoList({ items }: { items: TodoListTraceItemEntry[] }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <ul className="trace-todo-list">
      {items.map((item, index) => (
        <li className={item.completed ? "is-completed" : ""} key={`${item.text}-${index}`}>
          {item.completed ? <CheckCircle2 size={14} /> : <Circle size={14} />}
          <span>{item.text}</span>
        </li>
      ))}
    </ul>
  );
}

function formatTraceItemEventStatus(
  eventType: "item.started" | "item.updated" | "item.completed",
): string {
  if (eventType === "item.started") {
    return "started";
  }

  if (eventType === "item.updated") {
    return "updated";
  }

  return "completed";
}

function formatPreformattedContent(content: string | undefined): ReactNode {
  return content ? <pre>{content}</pre> : undefined;
}

function formatUsage(usage: TokenUsage): string {
  const input = numberValue(usage.input_tokens);
  const cached = numberValue(usage.cached_input_tokens);
  const output = numberValue(usage.output_tokens);
  const reasoning = numberValue(usage.reasoning_output_tokens);
  const parts = [
    input === undefined ? undefined : `${input} in`,
    cached === undefined ? undefined : `${cached} cached`,
    output === undefined ? undefined : `${output} out`,
    reasoning === undefined ? undefined : `${reasoning} reasoning`,
  ].filter(Boolean);

  return parts.join(" / ");
}

function formatLegacyMessage(payload: Record<string, unknown>): string | undefined {
  const text =
    stringValue(payload.message) ?? stringValue(payload.text) ?? stringValue(payload.delta);

  if (text) {
    return text;
  }

  return formatJson(payload);
}

function formatJson(value: unknown): string | undefined {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return undefined;
  }
}

function formatEventName(value: string): string {
  return value.replace(/[._-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
