import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { analyze } from "./index.js";
import { discoverSources, reportStamp } from "./files.js";

export interface ProjectOptions {
  cwd: string;
  sourceRoots: readonly string[];
  lcov: string;
  coverageCommand: string;
  useExistingCoverage: boolean;
}

export async function analyzeProject(options: ProjectOptions) {
  const { cwd, sourceRoots, lcov, coverageCommand, useExistingCoverage } = options;
  const paths = [...new Set((await Promise.all(sourceRoots.map(root => discoverSources(resolve(cwd, root))))).flat())];
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
