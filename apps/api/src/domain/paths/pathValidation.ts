import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export class InvalidPathError extends Error {
  constructor(path: string, reason: string) {
    super(`Invalid path: ${path}. ${reason}`);
    this.name = "InvalidPathError";
  }
}

export class PathNotFoundError extends Error {
  constructor(path: string) {
    super(`Path not found: ${path}`);
    this.name = "PathNotFoundError";
  }
}

export class PathNotDirectoryError extends Error {
  constructor(path: string) {
    super(`Path is not a directory: ${path}`);
    this.name = "PathNotDirectoryError";
  }
}

export function expandHomePath(path: string): string {
  if (path.includes("\0")) {
    throw new InvalidPathError(path, "Path must not contain null bytes.");
  }

  if (path === "~") {
    return homedir();
  }

  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }

  return resolve(path);
}

export async function assertExistingDirectory(path: string): Promise<string> {
  const expandedPath = expandHomePath(path.trim());

  if (!expandedPath) {
    throw new InvalidPathError(path, "Path must not be empty.");
  }

  let pathStat;

  try {
    pathStat = await stat(expandedPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new PathNotFoundError(expandedPath);
    }

    throw error;
  }

  if (!pathStat.isDirectory()) {
    throw new PathNotDirectoryError(expandedPath);
  }

  return expandedPath;
}

export function isInvalidCwdError(error: unknown): boolean {
  return isNodeError(error) && ["ENOENT", "ENOTDIR"].includes(error.code ?? "");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
