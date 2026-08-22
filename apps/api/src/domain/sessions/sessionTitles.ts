export function createTitle(prompt: string): string {
  const compact = prompt.replace(/\s+/g, ' ').trim();

  if (compact.length <= 48) {
    return compact || 'Untitled session';
  }

  return `${compact.slice(0, 45)}...`;
}
