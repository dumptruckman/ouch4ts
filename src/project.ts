import { readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import picomatch from "picomatch";
import { analyzeReport } from "./index.js";
import { canonicalRepositoryPath, reportStamp } from "./files.js";
import { discoverSources } from "./discovery.js";
import { runCommand } from "./process.js";
import { defaultCoverageCommand } from "./package-manager.js";

export interface ProjectOptions {
  cwd: string;
  sourceRoots: readonly string[];
  exclude: readonly string[];
  lcov: string;
  coverageCommand: string | undefined;
  useExistingCoverage: boolean;
  repositoryRoot?: string;
}

export function warnUnknownCoverage(entries: Awaited<ReturnType<typeof analyzeProject>>["entries"], context = "") {
  const unknown = entries.filter(entry => entry.coverage === null).length;
  if (unknown) console.error(`Warning: ${unknown} functions have N/A coverage${context}. Check LCOV source paths and source maps.`);
}

export async function analyzeProject(options: ProjectOptions) {
  const reportPath = resolve(options.cwd, options.lcov);
  await validateRepositoryInputs(options);
  if (!options.useExistingCoverage) await updateCoverage(options, reportPath);
  await validateRepositoryInputs(options);
  const paths = await projectSourcePaths(options);
  const sources = await Promise.all(paths.map(async path => ({ path, text: await readFile(path, "utf8") })));
  return analyzeReport({ sources, lcov: await readCoverage(reportPath), projectRoot: options.cwd });
}

async function validateRepositoryInputs({ cwd, sourceRoots, lcov, repositoryRoot }: ProjectOptions) {
  if (repositoryRoot === undefined) return;
  await Promise.all([".", ...sourceRoots, lcov].map(path =>
    canonicalRepositoryPath(resolve(cwd, path), repositoryRoot)
  ));
}

async function readCoverage(path: string) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read LCOV: ${message}. Generate original-source LCOV or select its path with --lcov.`);
  }
}

async function projectSourcePaths(options: ProjectOptions) {
  const { cwd, sourceRoots } = options;
  const matchesExclude = picomatch([...options.exclude], { dot: true, nonegate: true });
  const isExcluded = (path: string) => matchesExclude(relative(cwd, path).split(sep).join("/"));
  const paths = [...new Set((await Promise.all(sourceRoots.map(root => discoverSources(resolve(cwd, root), isExcluded)))).flat())];
  if (paths.length === 0) throw new Error(`No JavaScript or TypeScript sources found under ${sourceRoots.join(", ")}`);
  return paths;
}

async function updateCoverage({ cwd, lcov, coverageCommand }: ProjectOptions, reportPath: string) {
  const before = await reportStamp(reportPath);
  runCommand(coverageCommand ?? await defaultCoverageCommand(cwd), cwd, "Coverage");
  const after = await reportStamp(reportPath);
  if (after === null || before === after) {
    throw new Error(`Coverage command did not update ${lcov}. Generate original-source LCOV or select the updated report with --lcov.`);
  }
}
