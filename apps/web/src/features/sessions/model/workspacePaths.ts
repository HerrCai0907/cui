export function normalizeWorkspacePath(workspace: string): string {
  const normalizedSeparators = workspace.trim().replace(/\\/g, "/");

  if (/^\/+$/u.test(normalizedSeparators)) {
    return "/";
  }

  if (/^[A-Za-z]:\/*$/u.test(normalizedSeparators)) {
    return `${normalizedSeparators.slice(0, 2)}/`;
  }

  return normalizedSeparators.replace(/\/+$/u, "");
}
