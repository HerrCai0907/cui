export function getStringProperty(value: object, key: string): string | undefined {
  const property = (value as Record<string, unknown>)[key];

  return typeof property === "string" ? property : undefined;
}

export function getNumberProperty(value: object, key: string): number | undefined {
  const property = (value as Record<string, unknown>)[key];

  return typeof property === "number" ? property : undefined;
}

export function getStringArrayProperty(value: object, key: string): string[] {
  const property = (value as Record<string, unknown>)[key];

  if (!Array.isArray(property)) {
    return [];
  }

  return property.filter((item): item is string => typeof item === "string");
}

export function getTextFields(value: object, keys: string[]): string[] {
  return keys
    .map((key) => getStringProperty(value, key))
    .filter((text): text is string => Boolean(text));
}
