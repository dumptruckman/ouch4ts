import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { readCache, writeCache } from "./cache.js";
import { canonicalPath } from "./files.js";
import { git } from "./git.js";
import { analyzeProject } from "./project.js";
import { runCommand } from "./process.js";
import type { ProjectOptions } from "./project.js";
import { defaultSetupCommand } from "./package-manager.js";

type Metric = Awaited<ReturnType<typeof analyzeProject>>["entries"][number];
type FileMetric = Awaited<ReturnType<typeof analyzeProject>>["files"][number];
type ComparisonOptions = ProjectOptions & { setupCommand: string | undefined; refresh: boolean };
type SnapshotOptions = ComparisonOptions & { root: string; settingsKey: string };

export async function compareProject(reference: string, options: ComparisonOptions) {
  const root = git(["rev-parse", "--show-toplevel"], options.cwd).trimEnd();
  const head = git(["rev-parse", "--verify", "HEAD^{commit}"], options.cwd).trim();
  const target = git(["rev-parse", "--verify", "--end-of-options", `${reference}^{commit}`], options.cwd).trim();
  const base = git(["merge-base", target, head], options.cwd).trim();
  const paths = await comparisonPaths(options, root);
  const normalized = { ...options, ...paths, exclude: [...new Set(options.exclude)].sort() };
  const settingsKey = await settingsFingerprint(normalized, root);
  const snapshotOptions = { ...normalized, root, settingsKey };
  const before = await snapshot(base, snapshotOptions);
  const after = base === head ? before : await snapshot(head, snapshotOptions);
  const renames = renamedFiles(base, head, root, options.cwd);
  return {
    base, head, entries: compareEntries(before.entries, after.entries, renames),
    files: compareFiles(before.files, after.files, renames),
  };
}

async function comparisonPaths(options: ComparisonOptions, root: string) {
  async function projectPath(path: string) {
    const absolute = await canonicalPath(resolve(options.cwd, path));
    const fromRoot = relative(root, absolute);
    if (isOutsideRepository(fromRoot)) {
      throw new Error(`Comparison paths must stay inside the Git repository: ${path}`);
    }
    return relative(options.cwd, absolute) || ".";
  }
  return {
    sourceRoots: [...new Set(await Promise.all(options.sourceRoots.map(projectPath)))].sort(),
    lcov: await projectPath(options.lcov),
  };
}

function isOutsideRepository(path: string) {
  return path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path);
}

async function settingsFingerprint(options: ComparisonOptions, root: string) {
  const analyzer = createHash("sha256");
  const directory = fileURLToPath(new URL("./", import.meta.url));
  const extension = extname(import.meta.url);
  const files = (await readdir(directory, { recursive: true, withFileTypes: true }))
    .filter(file => file.isFile() && extname(file.name) === extension)
    .map(file => relative(directory, join(file.parentPath, file.name))).sort();
  for (const file of files) {
    analyzer.update(JSON.stringify([file, await readFile(join(directory, file), "utf8")]));
  }
  return createHash("sha256").update(JSON.stringify({
    version: 3, analyzer: analyzer.digest("hex"), typescript: ts.version,
    node: process.version, platform: process.platform, arch: process.arch,
    project: relative(root, options.cwd), sourceRoots: options.sourceRoots, exclude: options.exclude, lcov: options.lcov,
    setupCommand: options.setupCommand, coverageCommand: options.coverageCommand,
  })).digest("hex");
}

async function snapshot(commit: string, options: SnapshotOptions) {
  const cachePath = join(options.cwd, ".metrics/cache", `${commit}-${options.settingsKey}.json`);
  const cached = await reusableSnapshot(cachePath, commit, options);
  if (cached) return cached;
  const directory = await mkdtemp(join(tmpdir(), "ouch4ts-compare-"));
  const checkout = join(directory, "checkout");
  let added = false;
  try {
    git(["-c", "core.hooksPath=/dev/null", "worktree", "add", "--detach", checkout, commit], options.root);
    added = true;
    const cwd = await realpath(resolve(checkout, relative(options.root, options.cwd)));
    console.error(`Analyzing ${commit}`);
    runCommand(options.setupCommand ?? await defaultSetupCommand(cwd), cwd, "Setup");
    const report = await analyzeProject({ ...options, cwd, useExistingCoverage: false });
    await writeCache(cachePath, commit, options.settingsKey, report);
    return report;
  } finally {
    if (added) git(["worktree", "remove", "--force", checkout], options.root);
    await rm(directory, { recursive: true, force: true });
  }
}

async function reusableSnapshot(path: string, commit: string, options: SnapshotOptions) {
  if (options.refresh) return null;
  const cached = await readCache(path, commit, options.settingsKey);
  if (cached) console.error(`Using cached report for ${commit}`);
  return cached;
}

function renamedFiles(base: string, head: string, root: string, cwd: string) {
  const renames = new Map<string, string>();
  const paths = git(["diff", "--no-ext-diff", "--no-textconv", "--no-relative", "--name-status", "-z",
    "--find-renames", base, head, "--"], cwd).split("\0").slice(0, -1);
  for (let index = 0; index < paths.length;) {
    const status = paths[index++]!;
    const from = paths[index++]!;
    const to = hasDestinationPath(status) ? paths[index++] : undefined;
    recordRename(renames, status, from, to, root, cwd);
  }
  return renames;
}

function hasDestinationPath(status: string) {
  return status.startsWith("R") || status.startsWith("C");
}

function recordRename(renames: Map<string, string>, status: string, from: string, to: string | undefined,
  root: string, cwd: string) {
  if (status.startsWith("R") && to !== undefined) {
    renames.set(relative(cwd, resolve(root, from)).split(sep).join("/"),
      relative(cwd, resolve(root, to)).split(sep).join("/"));
  }
}

type MetricGroup = { base: Metric[]; head: Metric[] };

function compareEntries(before: Metric[], after: Metric[], renames: Map<string, string>) {
  const groups = new Map<string, MetricGroup>();
  function add(entry: Metric, side: "base" | "head") {
    const file = side === "base" ? renames.get(entry.file) ?? entry.file : entry.file;
    const identity = `${file}\0${entry.name.replace(/<anonymous@\d+:\d+>/g, "<anonymous>")}`;
    let group = groups.get(identity);
    if (!group) {
      group = { base: [], head: [] };
      groups.set(identity, group);
    }
    group[side].push(entry);
  }
  before.forEach(entry => add(entry, "base"));
  after.forEach(entry => add(entry, "head"));
  return [...groups.values()].flatMap(compareGroup).filter(entry => entry !== null).sort(compareChanges);
}

function compareGroup(group: MetricGroup) {
  if (isUniqueGroup(group)) return [comparisonEntry(group.base[0]!, group.head[0]!)];
  if (unchangedGroup(group)) return [];
  return [...group.base.map(entry => comparisonEntry(entry, null)), ...group.head.map(entry => comparisonEntry(null, entry))];
}

function isUniqueGroup(group: MetricGroup) {
  return group.base.length === 1 && group.head.length === 1;
}

function unchangedGroup(group: MetricGroup) {
  return group.base[0]?.file === group.head[0]?.file && groupScores(group.base) === groupScores(group.head);
}

function groupScores(entries: Metric[]) {
  const scores = entries.map(entry => {
    const values = scoreFields.map(field => entry[field]);
    return JSON.stringify(values);
  });
  return scores.sort().join("\0");
}

const scoreFields = ["complexity", "cognitive", "coverage", "crap", "ouch"] as const;

function sameScores(base: Metric | null, head: Metric | null) {
  return sameFieldValues(base, head, scoreFields);
}

function comparisonEntry(base: Metric | null, head: Metric | null) {
  const entry = head ?? base;
  if (!entry) return null;
  if (unchangedEntry(base, head, scoreFields)) return null;
  return {
    name: entry.name, file: entry.file, status: comparisonStatus(base, head, sameScores(base, head)), base, head,
    delta: metricDeltas(base, head),
  };
}

function unchangedEntry<T extends { file: string }>(base: T | null, head: T | null, fields: readonly (keyof T)[]) {
  return sameFieldValues(base, head, fields) && base?.file === head?.file;
}

function comparisonStatus(base: object | null, head: object | null, scoresUnchanged: boolean) {
  return unmatchedEntryStatus(base, head) ?? (scoresUnchanged ? "renamed" : "changed");
}

function unmatchedEntryStatus(base: object | null, head: object | null) {
  if (base === null) return "added";
  if (head === null) return "removed";
}

function metricDeltas(base: Metric | null, head: Metric | null) {
  if (base === null || head === null) return { complexity: null, cognitive: null, coverage: null, crap: null, ouch: null };
  return {
    complexity: head.complexity - base.complexity,
    cognitive: head.cognitive - base.cognitive,
    coverage: scoreDelta(base.coverage, head.coverage),
    crap: scoreDelta(base.crap, head.crap),
    ouch: scoreDelta(base.ouch, head.ouch),
  };
}

function scoreDelta(base: number | null, head: number | null) {
  return base === null || head === null ? null : head - base;
}

type ComparisonEntry = NonNullable<ReturnType<typeof comparisonEntry>>;

function compareChanges(a: ComparisonEntry, b: ComparisonEntry) {
  return compareScoreChanges(a, b) || a.file.localeCompare(b.file) || a.name.localeCompare(b.name);
}

function compareScoreChanges(a: ComparisonEntry, b: ComparisonEntry) {
  return (b.delta.ouch ?? 0) - (a.delta.ouch ?? 0) || currentOrPreviousScore(b) - currentOrPreviousScore(a);
}

function currentOrPreviousScore(entry: ComparisonEntry) {
  return entry.head?.ouch ?? entry.base?.ouch ?? -1;
}

function compareFiles(before: FileMetric[], after: FileMetric[], renames: Map<string, string>) {
  const base = new Map(before.map(entry => [renames.get(entry.file) ?? entry.file, entry]));
  const head = new Map(after.map(entry => [entry.file, entry]));
  return [...new Set([...base.keys(), ...head.keys()])]
    .map(file => fileComparisonEntry(base.get(file) ?? null, head.get(file) ?? null))
    .filter(entry => entry !== null)
    .sort(compareFileChanges);
}

type FileComparisonEntry = NonNullable<ReturnType<typeof fileComparisonEntry>>;

function compareFileChanges(a: FileComparisonEntry, b: FileComparisonEntry) {
  return fileCognitiveDelta(b) - fileCognitiveDelta(a)
    || fileCognitive(b) - fileCognitive(a) || a.file.localeCompare(b.file);
}

function fileCognitiveDelta(entry: FileComparisonEntry) {
  return entry.delta.cognitive ?? 0;
}

function fileCognitive(entry: FileComparisonEntry) {
  return entry.head?.cognitive ?? entry.base?.cognitive ?? 0;
}

function fileComparisonEntry(base: FileMetric | null, head: FileMetric | null) {
  const entry = head ?? base;
  if (entry === null) return null;
  if (unchangedEntry(base, head, fileScoreFields)) return null;
  return {
    file: entry.file, status: comparisonStatus(base, head, sameFileScores(base, head)), base, head,
    delta: {
      complexity: fileScoreDelta(base, head, "complexity"),
      cognitive: fileScoreDelta(base, head, "cognitive"),
      functions: fileScoreDelta(base, head, "functions"),
    },
  };
}

const fileScoreFields = ["complexity", "cognitive", "functions"] as const;

function sameFileScores(base: FileMetric | null, head: FileMetric | null) {
  return sameFieldValues(base, head, fileScoreFields);
}

function sameFieldValues<T extends object>(base: T | null, head: T | null, fields: readonly (keyof T)[]) {
  return base !== null && head !== null && fields.every(field =>
    base[field] === head[field]
  );
}

function fileScoreDelta(base: FileMetric | null, head: FileMetric | null, field: typeof fileScoreFields[number]) {
  return scoreDelta(base?.[field] ?? null, head?.[field] ?? null);
}
