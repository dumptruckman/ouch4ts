import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { readCache, writeCache } from "./cache.js";
import { git } from "./git.js";
import { analyzeProject, runCommand } from "./project.js";
import type { ProjectOptions } from "./project.js";

type Metric = Awaited<ReturnType<typeof analyzeProject>>[number];

export async function compareProject(reference: string, options: ProjectOptions & { setupCommand: string; refresh: boolean }) {
  const root = git(["rev-parse", "--show-toplevel"], options.cwd).trimEnd();
  const head = git(["rev-parse", "--verify", "HEAD^{commit}"], options.cwd).trim();
  const target = git(["rev-parse", "--verify", "--end-of-options", `${reference}^{commit}`], options.cwd).trim();
  const base = git(["merge-base", target, head], options.cwd).trim();
  async function projectPath(path: string) {
    const absolute = await canonicalPath(resolve(options.cwd, path));
    const fromRoot = relative(root, absolute);
    if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
      throw new Error(`Comparison paths must stay inside the Git repository: ${path}`);
    }
    return relative(options.cwd, absolute) || ".";
  }
  const sourceRoots = [...new Set(await Promise.all(options.sourceRoots.map(projectPath)))].sort();
  const lcov = await projectPath(options.lcov);
  const analyzer = createHash("sha256");
  for (const file of ["index.js", "project.js"]) analyzer.update(await readFile(new URL(file, import.meta.url)));
  const settingsKey = createHash("sha256").update(JSON.stringify({
    version: 1, analyzer: analyzer.digest("hex"), typescript: ts.version,
    node: process.version, platform: process.platform, arch: process.arch,
    project: relative(root, options.cwd), sourceRoots, lcov,
    setupCommand: options.setupCommand, coverageCommand: options.coverageCommand,
  })).digest("hex");

  async function snapshot(commit: string) {
    const cachePath = join(options.cwd, ".metrics/cache", `${commit}-${settingsKey}.json`);
    if (!options.refresh) {
      const cached = await readCache(cachePath, commit, settingsKey);
      if (cached) {
        console.error(`Using cached report for ${commit}`);
        return cached;
      }
    }
    const directory = await mkdtemp(join(tmpdir(), "crap4ts-compare-"));
    const checkout = join(directory, "checkout");
    let added = false;
    try {
      git(["-c", "core.hooksPath=/dev/null", "worktree", "add", "--detach", checkout, commit], root);
      added = true;
      const cwd = await realpath(resolve(checkout, relative(root, options.cwd)));
      console.error(`Analyzing ${commit}`);
      runCommand(options.setupCommand, cwd, "Setup");
      const entries = await analyzeProject({ ...options, cwd, sourceRoots, lcov, useExistingCoverage: false });
      await writeCache(cachePath, commit, settingsKey, entries);
      return entries;
    } finally {
      if (added) git(["worktree", "remove", "--force", checkout], root);
      await rm(directory, { recursive: true, force: true });
    }
  }

  const before = await snapshot(base);
  const after = base === head ? before : await snapshot(head);
  const renames = new Map<string, string>();
  const paths = git(["diff", "--no-ext-diff", "--no-textconv", "--no-relative", "--name-status", "-z",
    "--find-renames", base, head, "--"], options.cwd).split("\0");
  for (let index = 0; index < paths.length;) {
    const status = paths[index++];
    const from = paths[index++];
    if (!status || from === undefined) break;
    if (status.startsWith("R") || status.startsWith("C")) {
      const to = paths[index++];
      if (status.startsWith("R") && to !== undefined) {
        renames.set(relative(options.cwd, resolve(root, from)).split(sep).join("/"),
          relative(options.cwd, resolve(root, to)).split(sep).join("/"));
      }
    }
  }
  return { base, head, entries: compareEntries(before, after, renames) };
}

async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT" && dirname(path) !== path) {
      return join(await canonicalPath(dirname(path)), basename(path));
    }
    throw error;
  }
}

function compareEntries(before: Metric[], after: Metric[], renames: Map<string, string>) {
  const groups = new Map<string, { base: Metric[]; head: Metric[] }>();
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
  const entries = [...groups.values()].flatMap(group => {
    if (group.base.length === 1 && group.head.length === 1) return [comparisonEntry(group.base[0]!, group.head[0]!)];
    const scores = (entries: Metric[]) => entries.map(entry => JSON.stringify([entry.complexity, entry.coverage, entry.crap])).sort().join("\0");
    if (group.base[0]?.file === group.head[0]?.file && scores(group.base) === scores(group.head)) return [];
    return [...group.base.map(entry => comparisonEntry(entry, null)), ...group.head.map(entry => comparisonEntry(null, entry))];
  }).filter(entry => entry !== null);
  return entries.sort((a, b) => (b.delta.crap ?? 0) - (a.delta.crap ?? 0) ||
    (b.head?.crap ?? b.base?.crap ?? -1) - (a.head?.crap ?? a.base?.crap ?? -1) ||
    a.file.localeCompare(b.file) || a.name.localeCompare(b.name));
}

function comparisonEntry(base: Metric | null, head: Metric | null) {
  const entry = head ?? base;
  if (!entry) return null;
  const sameMetrics = base && head && base.complexity === head.complexity && base.coverage === head.coverage && base.crap === head.crap;
  if (sameMetrics && base.file === head.file) return null;
  const status = base === null ? "added" : head === null ? "removed" : sameMetrics ? "renamed" : "changed";
  return {
    name: entry.name, file: entry.file, status, base, head,
    delta: {
      complexity: base && head ? head.complexity - base.complexity : null,
      coverage: base?.coverage != null && head?.coverage != null ? head.coverage - base.coverage : null,
      crap: base?.crap != null && head?.crap != null ? head.crap - base.crap : null,
    },
  };
}
