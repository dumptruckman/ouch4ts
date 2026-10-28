import { readdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join } from "node:path";

export async function discoverSources(root: string, isExcluded: (path: string) => boolean): Promise<string[]> {
  if (isExcluded(root)) return [];
  const paths: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    paths.push(...await discoverEntrySources(root, entry, isExcluded));
  }
  return paths;
}

async function discoverEntrySources(root: string, entry: Dirent, isExcluded: (path: string) => boolean): Promise<string[]> {
  const path = join(root, entry.name);
  if (isSourceDirectory(entry)) return discoverSources(path, isExcluded);
  return isIncludedSource(path, entry, isExcluded) ? [path] : [];
}

function isSourceDirectory(entry: Dirent) {
  return entry.isDirectory() && !excludedDirectories.has(entry.name);
}

function isIncludedSource(path: string, entry: Dirent, isExcluded: (path: string) => boolean) {
  return entry.isFile() && isSourceFile(entry.name) && !isExcluded(path);
}

function isSourceFile(name: string) {
  return /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(name) && !/\.d\.[cm]?ts$|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(name);
}

const excludedDirectories = new Set(["node_modules", ".git", "dist", "build", "coverage", "test", "tests", "__tests__", "__mocks__"]);
