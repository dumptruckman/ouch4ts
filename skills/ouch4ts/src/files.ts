import { realpath, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export async function reportStamp(path: string) {
  try {
    const info = await stat(path, { bigint: true });
    return `${info.ino}:${info.mtimeNs}:${info.ctimeNs}:${info.size}`;
  } catch (error) {
    return missingFileOrThrow(error);
  }
}

export function isMissingFile(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export function missingFileOrThrow(error: unknown): null {
  if (isMissingFile(error)) return null;
  throw error;
}

/** Resolve symlinks through the nearest existing ancestor, including for a future LCOV file. */
export async function canonicalPath(path: string): Promise<string> {
  return realpath(path).catch(error =>
    canonicalMissingPath(path, error)
  );
}

async function canonicalMissingPath(path: string, error: unknown): Promise<string> {
  if (!canResolveMissingPath(path, error)) throw error;
  return join(await canonicalPath(dirname(path)), basename(path));
}

function canResolveMissingPath(path: string, error: unknown) {
  return isMissingFile(error) && dirname(path) !== path;
}
