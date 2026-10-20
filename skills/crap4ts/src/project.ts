import { spawnSync } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { analyze } from "./index.js";

export interface ProjectOptions {
  cwd: string;
  sourceRoots: readonly string[];
  lcov: string;
  coverageCommand: string;
  useExistingCoverage: boolean;
}

export async function analyzeProject(options: ProjectOptions) {
  const { cwd, sourceRoots, lcov, coverageCommand, useExistingCoverage } = options;
  const paths = [...new Set((await Promise.all(sourceRoots.map(root => discover(resolve(cwd, root))))).flat())];
  if (paths.length === 0) throw new Error(`No TypeScript sources found under ${sourceRoots.join(", ")}`);
  const reportPath = resolve(cwd, lcov);
  if (!useExistingCoverage) {
    const before = await reportStamp(reportPath);
    runCommand(coverageCommand, cwd, "Coverage");
    const after = await reportStamp(reportPath);
    if (after === null || before === after) throw new Error(`Coverage command did not update ${lcov}`);
  }
  const sources = await Promise.all(paths.map(async path => ({ path, text: await readFile(path, "utf8") })));
  return analyze({ sources, lcov: await readFile(reportPath, "utf8"), projectRoot: cwd });
}

export function runCommand(command: string, cwd: string, label: string) {
  const result = spawnSync(command, { cwd, shell: true, stdio: ["ignore", 2, 2] });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} command failed: ${result.signal ?? result.status}`);
}

async function reportStamp(path: string) {
  try {
    const info = await stat(path, { bigint: true });
    return `${info.ino}:${info.mtimeNs}:${info.ctimeNs}:${info.size}`;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

async function discover(root: string): Promise<string[]> {
  const paths: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory() && !excludedDirectories.has(entry.name)) paths.push(...await discover(path));
    else if (entry.isFile() && /\.(?:ts|tsx|mts|cts)$/.test(entry.name) &&
      !/\.d\.[cm]?ts$|\.(?:test|spec)\.[cm]?tsx?$/.test(entry.name)) paths.push(path);
  }
  return paths;
}

const excludedDirectories = new Set(["node_modules", ".git", "dist", "build", "coverage", "test", "tests", "__tests__", "__mocks__"]);
