export function shortId(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return value.length <= 14 ? value : `${value.slice(0, 8)}...${value.slice(-4)}`;
}
