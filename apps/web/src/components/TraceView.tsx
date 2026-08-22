import { CheckCircle2, Circle, MessageSquare, Play, Terminal, TextSearch } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ExecutionTraceEvent, ExecutionTraceItem, TokenUsage } from '../types';
import { formatExecutionTraceSummary, parseExecutionTrace } from '../trace/parseExecutionTrace';

type TraceViewProps = {
  content: string;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
};

export function TraceView({ content, expanded, onExpandedChange }: TraceViewProps) {
  const events = parseExecutionTrace(content);

  return (
    <details
      className="trace-details"
      open={expanded}
      onToggle={(event) => onExpandedChange(event.currentTarget.open)}
    >
      <summary>
        <span>{expanded ? 'Hide execution trace' : 'Show execution trace'}</span>
        <small>{formatExecutionTraceSummary(events)}</small>
      </summary>
      <ol className="trace-list">
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
        {view.content && <pre>{view.content}</pre>}
      </div>
    </li>
  );
}

function describeTraceEvent(event: ExecutionTraceEvent): {
  title: string;
  meta?: string;
  content?: string;
  tone: string;
  icon: ReactNode;
} {
  if (event.type === 'thread.started') {
    return {
      title: 'Thread started',
      meta: shortId(event.thread_id),
      tone: 'trace-event-neutral',
      icon: <Play size={14} />,
    };
  }

  if (event.type === 'turn.started') {
    return {
      title: 'Turn started',
      tone: 'trace-event-neutral',
      icon: <Play size={14} />,
    };
  }

  if (event.type === 'turn.completed') {
    return {
      title: 'Turn completed',
      meta: event.usage ? formatUsage(event.usage) : undefined,
      tone: 'trace-event-success',
      icon: <CheckCircle2 size={14} />,
    };
  }

  if (event.type === 'item.started' || event.type === 'item.completed') {
    const completed = event.type === 'item.completed';
    const item = describeTraceItem(event.item);

    return {
      title: item.title,
      meta: [completed ? 'completed' : 'started', item.meta].filter(Boolean).join(' / '),
      content: item.content,
      tone: item.tone,
      icon: completed ? item.completedIcon : item.startedIcon,
    };
  }

  if (event.type === 'event_msg') {
    return {
      title: formatEventName(event.payload.type ?? 'event message'),
      content: formatLegacyMessage(event.payload),
      tone: 'trace-event-neutral',
      icon: <Circle size={12} />,
    };
  }

  if (event.type === 'session_meta') {
    return {
      title: 'Session metadata',
      meta: shortId(stringValue(event.payload.id)),
      content: formatJson(event.payload),
      tone: 'trace-event-neutral',
      icon: <TextSearch size={14} />,
    };
  }

  if (event.type === 'response_item') {
    return {
      title: `Response item${event.payload.type ? `: ${formatEventName(String(event.payload.type))}` : ''}`,
      content: formatJson(event.payload),
      tone: 'trace-event-neutral',
      icon: <TextSearch size={14} />,
    };
  }

  if (event.type === 'text_delta') {
    return {
      title: 'Text delta',
      content: event.text ?? event.delta,
      tone: 'trace-event-message',
      icon: <MessageSquare size={14} />,
    };
  }

  if (event.type === 'stdout') {
    return {
      title: 'Stdout',
      content: event.text,
      tone: 'trace-event-command',
      icon: <Terminal size={14} />,
    };
  }

  return {
    title: 'Unknown event',
    content: formatJson(event.raw),
    tone: 'trace-event-neutral',
    icon: <TextSearch size={14} />,
  };
}

function describeTraceItem(item: ExecutionTraceItem): {
  title: string;
  meta?: string;
  content?: string;
  tone: string;
  startedIcon: ReactNode;
  completedIcon: ReactNode;
} {
  if (item.type === 'command_execution') {
    const status = item.status ?? 'unknown';
    const exitCode = item.exit_code === undefined ? undefined : `exit ${item.exit_code ?? 'pending'}`;

    return {
      title: item.command ? `Command: ${item.command}` : 'Command execution',
      meta: [status, exitCode].filter(Boolean).join(' / '),
      content: item.aggregated_output?.trim(),
      tone: status === 'completed' && item.exit_code === 0 ? 'trace-event-success' : 'trace-event-command',
      startedIcon: <Terminal size={14} />,
      completedIcon: <Terminal size={14} />,
    };
  }

  if (item.type === 'agent_message') {
    return {
      title: 'Assistant message',
      content: item.text,
      tone: 'trace-event-message',
      startedIcon: <MessageSquare size={14} />,
      completedIcon: <MessageSquare size={14} />,
    };
  }

  if (item.type === 'reasoning') {
    return {
      title: 'Reasoning',
      content: item.text,
      tone: 'trace-event-reasoning',
      startedIcon: <TextSearch size={14} />,
      completedIcon: <TextSearch size={14} />,
    };
  }

  return {
    title: item.originalType ? formatEventName(item.originalType) : 'Unknown item',
    meta: shortId(item.id),
    content: formatJson(item),
    tone: 'trace-event-neutral',
    startedIcon: <Circle size={12} />,
    completedIcon: <CheckCircle2 size={14} />,
  };
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

  return parts.join(' / ');
}

function formatLegacyMessage(payload: Record<string, unknown>): string | undefined {
  const text = stringValue(payload.message) ?? stringValue(payload.text) ?? stringValue(payload.delta);

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
  return value
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function shortId(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return value.length <= 14 ? value : `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}
