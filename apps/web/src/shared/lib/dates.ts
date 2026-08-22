export function formatMessageTime(value: string): string {
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatRelativeTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Unknown';
  }

  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
