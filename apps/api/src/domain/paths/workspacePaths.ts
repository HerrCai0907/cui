import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { expandHomePath } from "./pathValidation.js";

const MAX_SUGGESTIONS = 50;

export async function suggestWorkspacePaths(input: string): Promise<string[]> {
  let path = input.trimStart();

  if (!path) {
    return [];
  }

  if (["~", ".", ".."].includes(path)) {
    path += "/";
  }

  const separator = path.lastIndexOf("/");
  const prefix = path.slice(0, separator + 1);
  const namePrefix = path.slice(separator + 1);
  const directory = expandHomePath(prefix || ".");
  // Validate the entire input, including the unfinished directory name.
  expandHomePath(path);

  try {
    const entries = (await readdir(directory, { withFileTypes: true }))
      .filter(
        (entry) =>
          entry.name.startsWith(namePrefix) &&
          (!entry.name.startsWith(".") || namePrefix.startsWith(".")),
      )
      .sort((left, right) => left.name.localeCompare(right.name));
    const suggestions: string[] = [];

    for (const entry of entries) {
      const isDirectory =
        entry.isDirectory() ||
        (entry.isSymbolicLink() &&
          (await stat(join(directory, entry.name)).catch(() => null))?.isDirectory());

      if (isDirectory) {
        suggestions.push(`${prefix}${entry.name}/`);
      }

      if (suggestions.length === MAX_SUGGESTIONS) {
        break;
      }
    }

    return suggestions;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      ["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes(String(error.code))
    ) {
      return [];
    }

    throw error;
  }
}
