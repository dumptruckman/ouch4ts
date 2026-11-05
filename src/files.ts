import { randomUUID } from "node:crypto";
import { mkdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";

/** Publish complete JSON with an atomic rename in the destination directory. */
export async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + "\n");
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

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

/** Resolve a comparison input and reject symlinks or paths outside its checkout. */
export async function canonicalRepositoryPath(path: string, root: string) {
  const absolute = await canonicalPath(path);
  const fromRoot = relative(root, absolute);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`Comparison paths must stay inside the Git repository: ${path}`);
  }
  return absolute;
}

async function canonicalMissingPath(path: string, error: unknown): Promise<string> {
  if (!canResolveMissingPath(path, error)) throw error;
  return join(await canonicalPath(dirname(path)), basename(path));
}

function canResolveMissingPath(path: string, error: unknown) {
  return isMissingFile(error) && dirname(path) !== path;
}
