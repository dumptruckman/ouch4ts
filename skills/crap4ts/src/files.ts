import { readdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export async function reportStamp(path: string) {
  try {
    const info = await stat(path, { bigint: true });
    return `${info.ino}:${info.mtimeNs}:${info.ctimeNs}:${info.size}`;
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

export async function discoverSources(root: string): Promise<string[]> {
  const paths: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory() && !excludedDirectories.has(entry.name)) paths.push(...await discoverSources(path));
    else if (entry.isFile() && isSourceFile(entry.name)) paths.push(path);
  }
  return paths;
}

const excludedDirectories = new Set(["node_modules", ".git", "dist", "build", "coverage", "test", "tests", "__tests__", "__mocks__"]);

function isSourceFile(name: string) {
  return /\.(?:ts|tsx|mts|cts)$/.test(name) && !/\.d\.[cm]?ts$|\.(?:test|spec)\.[cm]?tsx?$/.test(name);
}

export function isMissingFile(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** Resolve symlinks through the nearest existing ancestor, including for a future LCOV file. */
export async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if (isMissingFile(error) && dirname(path) !== path) {
      return join(await canonicalPath(dirname(path)), basename(path));
    }
    throw error;
  }
}
