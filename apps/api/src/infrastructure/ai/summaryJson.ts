export function parseSummaryJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);

    if (!match) {
      return undefined;
    }

    try {
      return JSON.parse(match[0]);
    } catch {
      return undefined;
    }
  }
}

export function limitCharacters(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, ' ').trim();

  return Array.from(compact).slice(0, maxLength).join('');
}
