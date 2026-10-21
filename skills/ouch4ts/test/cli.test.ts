import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, expect, test, vi } from "vitest";

import { runCli } from "../src/command.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const cli = join(root, "dist/cli.js");
const projects: string[] = [];

beforeAll(() => {
  execFileSync(process.execPath, [fileURLToPath(import.meta.resolve("typescript/bin/tsc")), "-p", "tsconfig.build.json"], { cwd: root });
});

test("help works without source files or a coverage setup", async () => {
  const cwd = project({});
  const result = runBinary(cwd, "--help");
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("Usage: ouch4ts");
  expect(result.stdout).toContain("--use-existing-coverage");
  expect((await run(cwd, "--help")).stdout).toBe(result.stdout.trimEnd());
  expect(existsSync(join(cwd, ".metrics"))).toBe(false);
});

test.each([
  { args: ["--use-existing-coverage"], status: 0, stdout: /price\s+src\/orders.ts:1\s+1\s+0\s+100\.0%\s+1\.0/, stderr: /^$/ },
  { args: ["--unknown"], status: 1, stdout: /^$/, stderr: /ouch4ts:.*Unknown option/ },
])("executable reports results and exit codes for $args", ({ args, status, stdout, stderr }) => {
  const cwd = project({
    "src/orders.ts": "export const price = () => 10;",
    "coverage/lcov.info": "SF:src/orders.ts\nDA:1,1\nend_of_record\n",
  });
  const result = runBinary(cwd, ...args);
  expect(result.status, result.stderr).toBe(status);
  expect(result.stdout).toMatch(stdout);
  expect(result.stderr).toMatch(stderr);
});

test.each([
  [["--unknown"], /Unknown option/],
  [["--lcov"], /argument missing/],
  [["--use-existing-coverage"], /ENOENT.*src/],
])("reports a setup error for %j", async (args, message) => {
  const result = await run(project({}), ...args);
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(message);
});

test("supports custom roots and coverage, filters the table, and rebuilds all metrics", async () => {
  const cwd = project({
    "lib/orders.mts": "export const price = () => 10;",
    "services/worker.cts": "export const work = () => 20;",
    "lib/ui.tsx": "export const View = () => <div />;",
    "lib/orders.test.ts": "function testOnly() { return 1; }",
    "lib/orders.spec.ts": "function specOnly() { return 1; }",
    "lib/types.d.ts": "declare function declared(): void;",
    "lib/__tests__/helper.ts": "function helper() { return 1; }",
    "lib/node_modules/vendor/index.ts": "function vendor() { return 1; }",
    "cover.cjs": `const fs = require('node:fs'); fs.mkdirSync('reports'); fs.writeFileSync('reports/unit.lcov', 'SF:lib/orders.mts\\nDA:1,1\\nend_of_record\\n');`,
    ".metrics/ouch.json": JSON.stringify({ entries: [{ name: "obsolete" }] }),
  });
  const result = await run(cwd, "--source-root", "lib", "--source-root", "services", "--source-root", "lib",
    "--lcov", "reports/unit.lcov", "--coverage-command", "node cover.cjs", "orders");
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("price");
  expect(result.stdout).not.toContain("work");
  expect(JSON.parse(readFileSync(join(cwd, ".metrics/ouch.json"), "utf8"))).toMatchObject({ entries: [
    { name: "price", coverage: 100 }, { name: "View", coverage: null }, { name: "work", coverage: null },
  ] });
  expect(result.stderr).toMatch(/2 functions.*N\/A/);
});

test.each([
  ["process.exit(7)", /Coverage command failed/],
  ["console.log('no coverage generated')", /did not update/],
])("refuses to score stale coverage after %s", async (command, message) => {
  const cwd = project({
    "src/orders.ts": "export function price() { return 10; }",
    "coverage/lcov.info": "SF:src/orders.ts\nDA:1,1\nend_of_record\n",
    "package.json": JSON.stringify({ scripts: { "test:coverage": "node cover.cjs" } }),
    "cover.cjs": command,
  });
  const result = await run(cwd);
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(message);
  expect(existsSync(join(cwd, ".metrics/ouch.json"))).toBe(false);
});

test("runs the project's coverage script and replaces stale scores with fresh coverage", async () => {
  const cwd = project({
    "src/orders.ts": "export function price() { return 10; }",
    "coverage/lcov.info": "SF:src/orders.ts\nDA:1,0\nend_of_record\n",
    "package.json": JSON.stringify({ scripts: { "test:coverage": "node cover.cjs" } }),
    "cover.cjs": `require('node:fs').writeFileSync('coverage/lcov.info', 'SF:src/orders.ts\\nDA:1,1\\nend_of_record\\n');`,
  });
  const result = await run(cwd);
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(readFileSync(join(cwd, ".metrics/ouch.json"), "utf8"))).toMatchObject({
    entries: [{ name: "price", coverage: 100, ouch: 1 }],
  });
});

afterEach(() => {
  for (const project of projects.splice(0)) rmSync(project, { recursive: true, force: true });
});

function project(files: Record<string, string>) {
  const path = mkdtempSync(join(tmpdir(), "ouch4ts-test-"));
  projects.push(path);
  for (const [name, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(path, name)), { recursive: true });
    writeFileSync(join(path, name), contents);
  }
  return path;
}

function runBinary(cwd: string, ...args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });
}

async function run(cwd: string, ...args: string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const output = vi.spyOn(console, "log").mockImplementation(message => { stdout.push(String(message)); });
  const errors = vi.spyOn(console, "error").mockImplementation(message => { stderr.push(String(message)); });
  let status = 0;
  try {
    await runCli(args, cwd);
  } catch (error) {
    status = 1;
    stderr.push(error instanceof Error ? error.message : String(error));
  } finally {
    output.mockRestore();
    errors.mockRestore();
  }
  return { status, stdout: stdout.join("\n"), stderr: stderr.join("\n") };
}

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", ["-c", "user.name=OUCH tests", "-c", "user.email=tests@example.com",
    "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" });
}

function commit(cwd: string, message: string) {
  git(cwd, "add", ".");
  git(cwd, "commit", "-qm", message);
}

function comparisonProject(extraFiles: Record<string, string> = {}, prefix = "") {
  const before = "export function price(vip: boolean) {\n  if (vip) return 1;\n  return 2;\n}\n\nexport const stable = () => 4;\nexport const removed = () => 0;\nexport function callbacks() {\n  return [1].map(value => value + 1);\n}\n";
  const files = {
    "src/orders.ts": before,
    "revision.txt": "base",
    "lines.json": JSON.stringify([[2, 1], [3, 0], [6, 1], [7, 0], [9, 1]]),
    "source-file.txt": "src/orders.ts",
    ...extraFiles,
  };
  const repository = project(Object.fromEntries(Object.entries(files).map(([name, content]) => [join(prefix, name), content])));
  const cwd = join(repository, prefix);
  const log = JSON.stringify(join(cwd, "calls.log"));
  writeFileSync(join(cwd, "setup.cjs"), `const fs = require('node:fs');
fs.writeFileSync('setup.done', 'yes');
fs.appendFileSync(${log}, JSON.stringify({ phase: 'setup', revision: fs.readFileSync('revision.txt', 'utf8'), cwd: process.cwd() }) + '\\n');`);
  writeFileSync(join(cwd, "cover.cjs"), `const fs = require('node:fs');
if (!fs.existsSync('setup.done')) process.exit(2);
fs.mkdirSync('coverage', { recursive: true });
const lines = JSON.parse(fs.readFileSync('lines.json', 'utf8'));
const source = fs.readFileSync('source-file.txt', 'utf8');
fs.writeFileSync('coverage/lcov.info', 'SF:' + process.cwd() + '/' + source + '\\n' + lines.map(([line, hits]) => 'DA:' + line + ',' + hits + '\\n').join('') + 'end_of_record\\n');
fs.appendFileSync(${log}, JSON.stringify({ phase: 'coverage', revision: fs.readFileSync('revision.txt', 'utf8'), cwd: process.cwd() }) + '\\n');`);
  git(repository, "init", "-q", "--initial-branch=main");
  commit(repository, "Base");
  git(cwd, "branch", "base");
  writeFileSync(join(cwd, "src/orders.ts"), before.replace("removed = () => 0", "added = () => 5"));
  writeFileSync(join(cwd, "revision.txt"), "head");
  writeFileSync(join(cwd, "lines.json"), JSON.stringify([[2, 1], [3, 1], [6, 1], [7, 1], [9, 1]]));
  commit(cwd, "Head");
  return cwd;
}

function runComparison(cwd: string, ...args: string[]) {
  return run(cwd, "--compare", "base", "--setup-command", "node setup.cjs", "--coverage-command", "node cover.cjs", ...args);
}

test("compare scores committed base and head in isolated checkouts and reports metric changes", async () => {
  const cwd = comparisonProject();
  const head = git(cwd, "rev-parse", "HEAD").trim();
  const base = git(cwd, "rev-parse", "base").trim();
  git(cwd, "checkout", "-qb", "target", "base");
  writeFileSync(join(cwd, "revision.txt"), "target");
  commit(cwd, "Advance target");
  git(cwd, "checkout", "-q", "main");
  const localEdit = "export function uncommitted( {";
  writeFileSync(join(cwd, "src/orders.ts"), localEdit);
  const result = await runComparison(cwd, "--compare", "target");
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toMatch(/^OUCH Comparison\n=+\n.*OUCH base\s+OUCH head/);
  const report = JSON.parse(readFileSync(join(cwd, ".metrics/ouch-comparison.json"), "utf8"));
  expect(report).toMatchObject({ base, head, entries: expect.arrayContaining([
    { name: "price", file: "src/orders.ts", status: "changed",
      base: expect.objectContaining({ complexity: 2, cognitive: 1, coverage: 50, ouch: 3.5 }),
      head: expect.objectContaining({ complexity: 2, cognitive: 1, coverage: 100, ouch: 3 }),
      delta: { complexity: 0, cognitive: 0, coverage: 50, ouch: -0.5 } },
    { name: "added", file: "src/orders.ts", status: "added", base: null,
      head: expect.objectContaining({ ouch: 1 }), delta: { complexity: null, cognitive: null, coverage: null, ouch: null } },
    { name: "removed", file: "src/orders.ts", status: "removed", head: null,
      base: expect.objectContaining({ ouch: 2 }), delta: { complexity: null, cognitive: null, coverage: null, ouch: null } },
  ]) });
  expect(report.entries).toHaveLength(3);
  expect(result.stdout).toContain("price");
  expect(result.stdout).toContain("-0.5");
  expect(result.stdout).not.toContain("stable");
  const calls: { phase: string; revision: string; cwd: string }[] = readFileSync(join(cwd, "calls.log"), "utf8")
    .trim().split("\n").map(line => JSON.parse(line));
  expect(calls.map(({ phase, revision }) => `${phase}:${revision}`)).toEqual([
    "setup:base", "coverage:base", "setup:head", "coverage:head",
  ]);
  expect(calls.every(call => call.cwd !== cwd && !existsSync(call.cwd))).toBe(true);
  expect(git(cwd, "rev-parse", "HEAD").trim()).toBe(head);
  expect(readFileSync(join(cwd, "src/orders.ts"), "utf8")).toBe(localEdit);
});

test("compare reuses commit reports until refresh is requested", async () => {
  const cwd = comparisonProject();
  const first = await runComparison(cwd);
  expect(first.status, first.stderr).toBe(0);
  const report = readFileSync(join(cwd, ".metrics/ouch-comparison.json"), "utf8");
  const calls = readFileSync(join(cwd, "calls.log"), "utf8");
  const second = await runComparison(cwd, "missing-file");
  expect(second.status, second.stderr).toBe(0);
  expect(second.stdout).not.toContain("price");
  expect(readFileSync(join(cwd, "calls.log"), "utf8")).toBe(calls);
  expect(readFileSync(join(cwd, ".metrics/ouch-comparison.json"), "utf8")).toBe(report);
  const cache = readdirSync(join(cwd, ".metrics/cache"));
  expect(cache).toHaveLength(2);
  expect(cache.some(name => name.includes(git(cwd, "rev-parse", "base").trim()))).toBe(true);
  expect(cache.some(name => name.includes(git(cwd, "rev-parse", "HEAD").trim()))).toBe(true);

  const refreshed = await runComparison(cwd, "--refresh");
  expect(refreshed.status, refreshed.stderr).toBe(0);
  expect(readFileSync(join(cwd, "calls.log"), "utf8").trim().split("\n")).toHaveLength(8);
});

test("comparison reports cognitive changes even when coverage and OUCH are unknown", async () => {
  const cwd = comparisonProject({
    "src/logic.ts": "export function logic() { if (a) {} if (b) {} }\n",
  });
  writeFileSync(join(cwd, "src/logic.ts"), "export function logic() { if (a) { if (b) {} } }\n");
  commit(cwd, "Nest the conditions");
  const result = await runComparison(cwd);
  expect(result.status, result.stderr).toBe(0);
  const report = JSON.parse(readFileSync(join(cwd, ".metrics/ouch-comparison.json"), "utf8"));
  expect(report.entries).toContainEqual({
    name: "logic", file: "src/logic.ts", status: "changed",
    base: expect.objectContaining({ complexity: 3, cognitive: 2, coverage: null, ouch: null }),
    head: expect.objectContaining({ complexity: 3, cognitive: 3, coverage: null, ouch: null }),
    delta: { complexity: 0, cognitive: 1, coverage: null, ouch: null },
  });
  expect(result.stdout).toContain("Cog base/head");
});

test("comparison cache separates coverage settings and regenerates a damaged commit report", async () => {
  const cwd = comparisonProject();
  expect((await runComparison(cwd)).status).toBe(0);
  const cacheDir = join(cwd, ".metrics/cache");
  const original = readdirSync(cacheDir);
  const changed = await runComparison(cwd, "--coverage-command", "node ./cover.cjs");
  expect(changed.status, changed.stderr).toBe(0);
  expect(readFileSync(join(cwd, "calls.log"), "utf8").trim().split("\n")).toHaveLength(8);
  const head = git(cwd, "rev-parse", "HEAD").trim();
  const damaged = readdirSync(cacheDir).find(name => !original.includes(name) && name.includes(head));
  expect(damaged).toBeDefined();
  writeFileSync(join(cacheDir, damaged!), '{"entries":"invalid"}');
  const repaired = await runComparison(cwd, "--coverage-command", "node ./cover.cjs");
  expect(repaired.status, repaired.stderr).toBe(0);
  expect(readFileSync(join(cwd, "calls.log"), "utf8").trim().split("\n")).toHaveLength(10);
  expect(JSON.parse(readFileSync(join(cacheDir, damaged!), "utf8")).entries).toHaveLength(5);
});

test("failed comparison coverage preserves the previous report and cleans up its checkout", async () => {
  const cwd = comparisonProject();
  expect((await runComparison(cwd)).status).toBe(0);
  const original = readFileSync(join(cwd, ".metrics/ouch-comparison.json"), "utf8");
  writeFileSync(join(cwd, "cover.cjs"), "process.exit(9);");
  git(cwd, "add", "cover.cjs");
  git(cwd, "commit", "-qm", "Break coverage");
  const failed = await runComparison(cwd);
  expect(failed.status).toBe(1);
  expect(failed.stderr).toContain("Coverage command failed: 9");
  expect(readFileSync(join(cwd, ".metrics/ouch-comparison.json"), "utf8")).toBe(original);
  expect(readdirSync(join(cwd, ".metrics/cache"))).toHaveLength(2);
  expect(git(cwd, "worktree", "list", "--porcelain").split("\n").filter(line => line.startsWith("worktree "))).toHaveLength(1);
});

test.each([
  [["--compare", "base", "--since", "base"], /cannot combine/],
  [["--compare", "base", "--use-existing-coverage"], /cannot combine/],
  [["--refresh"], /requires --compare/],
])("rejects incompatible comparison flags: %j", async (args, message) => {
  const cwd = comparisonProject();
  const result = await run(cwd, ...args);
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(message);
  expect(existsSync(join(cwd, "calls.log"))).toBe(false);
});

test("comparison matches renamed files and a unique callback after line numbers move", async () => {
  const cwd = comparisonProject();
  git(cwd, "mv", "src/orders.ts", "src/purchases.ts");
  writeFileSync(join(cwd, "src/purchases.ts"), "// Moved\n" + readFileSync(join(cwd, "src/purchases.ts"), "utf8"));
  writeFileSync(join(cwd, "source-file.txt"), "src/purchases.ts");
  writeFileSync(join(cwd, "lines.json"), JSON.stringify([[3, 1], [4, 1], [7, 1], [8, 1], [10, 1]]));
  commit(cwd, "Move functions");
  const result = await runComparison(cwd);
  expect(result.status, result.stderr).toBe(0);
  const report = JSON.parse(readFileSync(join(cwd, ".metrics/ouch-comparison.json"), "utf8"));
  expect(report.entries).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: "price", file: "src/purchases.ts", status: "changed",
      base: expect.objectContaining({ file: "src/orders.ts" }), delta: { complexity: 0, cognitive: 0, coverage: 50, ouch: -0.5 } }),
    expect.objectContaining({ name: "stable", status: "renamed", delta: { complexity: 0, cognitive: 0, coverage: 0, ouch: 0 } }),
  ]));
  const callbacks = report.entries.filter((entry: { name: string }) => entry.name.startsWith("callbacks.<anonymous@"));
  expect(callbacks).toHaveLength(1);
  expect(callbacks[0]).toMatchObject({ status: "renamed", delta: { complexity: 0, cognitive: 0, coverage: 0, ouch: 0 } });
});

test("comparison preserves unknown coverage without inventing a numeric score delta", async () => {
  const cwd = comparisonProject();
  writeFileSync(join(cwd, "lines.json"), JSON.stringify([[6, 1], [7, 1], [9, 1]]));
  commit(cwd, "Omit price coverage");
  const result = await runComparison(cwd);
  expect(result.status, result.stderr).toBe(0);
  const report = JSON.parse(readFileSync(join(cwd, ".metrics/ouch-comparison.json"), "utf8"));
  expect(report.entries).toContainEqual(expect.objectContaining({ name: "price", status: "changed",
    base: expect.objectContaining({ ouch: 3.5 }), head: expect.objectContaining({ coverage: null, ouch: null }),
    delta: { complexity: 0, cognitive: 0, coverage: null, ouch: null },
  }));
});

test("comparison keeps ambiguous matches explicit without reporting unchanged groups", async () => {
  const before = "export const one = { run() { if (a) {} if (b) {} return 1; } };\nexport const two = { run() { return 2; } };\n";
  const cwd = comparisonProject({ "src/duplicates.ts": before });
  const unchanged = await runComparison(cwd);
  expect(unchanged.status, unchanged.stderr).toBe(0);
  expect(JSON.parse(readFileSync(join(cwd, ".metrics/ouch-comparison.json"), "utf8")).entries
    .some((entry: { name: string }) => entry.name === "run")).toBe(false);
  writeFileSync(join(cwd, "src/duplicates.ts"), before.replace("if (a) {} if (b) {}", "if (a) { if (b) {} }"));
  git(cwd, "add", "src/duplicates.ts");
  git(cwd, "commit", "-qm", "Change one ambiguous function");
  const changed = await runComparison(cwd);
  expect(changed.status, changed.stderr).toBe(0);
  const ambiguous = JSON.parse(readFileSync(join(cwd, ".metrics/ouch-comparison.json"), "utf8")).entries
    .filter((entry: { name: string }) => entry.name === "run");
  expect(ambiguous).toHaveLength(4);
  expect(ambiguous.every((entry: { status: string }) => entry.status === "added" || entry.status === "removed")).toBe(true);
});

test("comparison normalizes roots below the Git root and reuses cache with an absolute source path", async () => {
  const cwd = comparisonProject({}, "packages/app");
  const first = await runComparison(cwd);
  expect(first.status, first.stderr).toBe(0);
  const calls = readFileSync(join(cwd, "calls.log"), "utf8");
  const second = await runComparison(cwd, "--source-root", join(cwd, "src"));
  expect(second.status, second.stderr).toBe(0);
  expect(readFileSync(join(cwd, "calls.log"), "utf8")).toBe(calls);
});

test("comparison defaults install each revision's lockfile without running install lifecycle scripts", async () => {
  const cwd = comparisonProject({
    "package.json": JSON.stringify({ name: "comparison-test", version: "1.0.0", scripts: {
      postinstall: "node -e 'process.exit(8)'", "test:coverage": "node cover.cjs",
    } }),
    "package-lock.json": JSON.stringify({ name: "comparison-test", version: "1.0.0", lockfileVersion: 3,
      packages: { "": { name: "comparison-test", version: "1.0.0" } } }),
    "setup.done": "ready",
  });
  const result = await run(cwd, "--compare", "base");
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("price");
  expect(readFileSync(join(cwd, "calls.log"), "utf8").trim().split("\n")).toHaveLength(2);
});

test("comparison analyzes one commit once when the merge base is HEAD", async () => {
  const cwd = comparisonProject();
  const result = await runComparison(cwd, "--compare", "HEAD");
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("No matching metric changes.");
  expect(readFileSync(join(cwd, "calls.log"), "utf8").trim().split("\n")).toHaveLength(2);
  expect(readdirSync(join(cwd, ".metrics/cache"))).toHaveLength(1);
  expect(JSON.parse(readFileSync(join(cwd, ".metrics/ouch-comparison.json"), "utf8")).entries).toEqual([]);
});

test("since reports changed functions with full scores and preserves complete metrics", async () => {
  const before = "export function changed(vip: boolean) {\n  if (vip) return 1;\n  return 2;\n}\n\nexport const untouched = () => 4;\n";
  const cwd = project({
    "src/orders.ts": before,
    "coverage/lcov.info": "SF:src/orders.ts\nDA:2,1\nDA:3,0\nDA:6,1\nend_of_record\n",
  });
  git(cwd, "init", "-q", "--initial-branch=main");
  commit(cwd, "Base");
  git(cwd, "branch", "base");
  writeFileSync(join(cwd, "src/orders.ts"), before.replace("return 2", "return 3"));
  commit(cwd, "Change price");

  const result = await run(cwd, "--since", "base", "--use-existing-coverage");
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toMatch(/changed\s+src\/orders.ts:1\s+2\s+1\s+50\.0%\s+3\.5/);
  expect(result.stdout).not.toContain("untouched");
  expect(JSON.parse(readFileSync(join(cwd, ".metrics/ouch.json"), "utf8"))).toMatchObject({ entries: [
    { name: "changed", ouch: 3.5 }, { name: "untouched", ouch: 1 },
  ] });
});

test("since includes deletions inside a function without blaming a neighbor for a removed function", async () => {
  const before = "export function untouched() {\n  return 0;\n}\nexport function removed() {\n  return 1;\n}\nexport function changed() {\n  const unused = 1;\n  return 2;\n}\n";
  const cwd = project({
    "src/orders.ts": before,
    "coverage/lcov.info": "SF:src/orders.ts\nDA:2,1\nDA:5,1\nend_of_record\n",
  });
  git(cwd, "init", "-q", "--initial-branch=main");
  commit(cwd, "Base");
  writeFileSync(join(cwd, "src/orders.ts"), before
    .replace("export function removed() {\n  return 1;\n}\n", "")
    .replace("  const unused = 1;\n", ""));

  const result = await run(cwd, "--since", "HEAD", "--use-existing-coverage");
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toMatch(/changed\s+src\/orders.ts:4/);
  expect(result.stdout).not.toContain("untouched");
  expect(result.stdout).not.toContain("removed");
});

test("since uses the merge base of diverged branches and composes with path filters", async () => {
  const cwd = project({
    "src/feature.ts": "export const feature = () => 1;\n",
    "src/target.ts": "export const target = () => 1;\n",
    "src/other.ts": "export const other = () => 1;\n",
    "coverage/lcov.info": ["feature", "target", "other"]
      .map(name => `SF:src/${name}.ts\nDA:1,1\nend_of_record\n`).join(""),
  });
  git(cwd, "init", "-q", "--initial-branch=main");
  commit(cwd, "Base");
  git(cwd, "checkout", "-qb", "feature");
  writeFileSync(join(cwd, "src/feature.ts"), "export const feature = () => 2;\n");
  writeFileSync(join(cwd, "src/other.ts"), "export const other = () => 2;\n");
  commit(cwd, "Feature changes");
  git(cwd, "checkout", "-q", "main");
  writeFileSync(join(cwd, "src/target.ts"), "export const target = () => 2;\n");
  commit(cwd, "Target changes");
  git(cwd, "checkout", "-q", "feature");

  const result = await run(cwd, "--since", "main", "--use-existing-coverage");
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("src/feature.ts");
  expect(result.stdout).toContain("src/other.ts");
  expect(result.stdout).not.toContain("src/target.ts");

  const filtered = await run(cwd, "--since", "main", "--use-existing-coverage", "feature");
  expect(filtered.status, filtered.stderr).toBe(0);
  expect(filtered.stdout).toContain("src/feature.ts");
  expect(filtered.stdout).not.toContain("src/other.ts");
});

test("since follows edited renames and quoted paths from a project below the Git root", async () => {
  const before = "export function changed() {\n  const value = 1;\n  return 2;\n}\n\nexport function untouched() {\n  return 4;\n}\n";
  const filename = 'order "special" Ω.ts';
  const cwd = project({
    "packages/app/src/old.ts": before,
    "packages/app/src/move.ts": "export const moved = () => 1;\n",
    "packages/app/coverage/lcov.info": `SF:src/${filename}\nDA:2,1\nDA:3,1\nDA:7,1\nend_of_record\n` +
      "SF:src/moved.ts\nDA:1,1\nend_of_record\n",
  });
  git(cwd, "init", "-q", "--initial-branch=main");
  commit(cwd, "Base");
  git(cwd, "branch", "base");
  git(cwd, "mv", "packages/app/src/old.ts", `packages/app/src/${filename}`);
  git(cwd, "mv", "packages/app/src/move.ts", "packages/app/src/moved.ts");
  writeFileSync(join(cwd, "packages/app/src", filename), before.replace("return 2", "return 3"));
  commit(cwd, "Move and edit");

  const result = await run(join(cwd, "packages/app"), "--since", "base", "--use-existing-coverage");
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("changed");
  expect(result.stdout).toContain(filename);
  expect(result.stdout).not.toContain("untouched");
  expect(result.stdout).not.toContain("moved");
});

test("since includes functions in added files and skips changes outside function ranges", async () => {
  const cwd = project({
    "src/orders.ts": "// Original comment\nexport const untouched = () => 1;\n",
    "coverage/lcov.info": "SF:src/orders.ts\nDA:2,1\nend_of_record\n" +
      "SF:src/new.ts\nDA:1,1\nend_of_record\n",
  });
  git(cwd, "init", "-q", "--initial-branch=main");
  commit(cwd, "Base");
  writeFileSync(join(cwd, "src/orders.ts"), "// Revised comment\nexport const untouched = () => 1;\n");
  writeFileSync(join(cwd, "src/new.ts"), "export const added = () => 2;\n");
  git(cwd, "add", "src/new.ts");

  const result = await run(cwd, "--since", "HEAD", "--use-existing-coverage");
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("added");
  expect(result.stdout).not.toContain("untouched");
});

test("since gives an empty table for an unchanged checkout without losing its metrics", async () => {
  const cwd = project({
    "src/orders.ts": "export const untouched = () => 1;\n",
    "coverage/lcov.info": "SF:src/orders.ts\nDA:1,1\nend_of_record\n",
  });
  git(cwd, "init", "-q", "--initial-branch=main");
  commit(cwd, "Base");

  const result = await run(cwd, "--since", "HEAD", "--use-existing-coverage");
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).not.toContain("untouched");
  expect(JSON.parse(readFileSync(join(cwd, ".metrics/ouch.json"), "utf8"))).toMatchObject({
    entries: [{ name: "untouched" }],
  });
});

test("since fails before running coverage or writing metrics when its Git reference is invalid", async () => {
  const cwd = project({ "src/orders.ts": "export const price = () => 1;\n" });
  git(cwd, "init", "-q", "--initial-branch=main");
  commit(cwd, "Base");

  const result = await run(cwd, "--since", "missing-reference", "--coverage-command", "node -e \"process.exit(42)\"");
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/git rev-parse failed/);
  expect(result.stderr).not.toContain("Coverage command failed");
  expect(existsSync(join(cwd, ".metrics"))).toBe(false);
});

test("since excludes unchanged functions between hunks even when Git is configured to merge context", async () => {
  const before = "export const first = () => 1;\nexport const middle = () => 1;\nexport const last = () => 1;\n";
  const cwd = project({
    "src/orders.ts": before,
    "coverage/lcov.info": "SF:src/orders.ts\nDA:1,1\nDA:2,1\nDA:3,1\nend_of_record\n",
  });
  git(cwd, "init", "-q", "--initial-branch=main");
  commit(cwd, "Base");
  git(cwd, "config", "diff.interHunkContext", "10");
  writeFileSync(join(cwd, "src/orders.ts"), before.replace("first = () => 1", "first = () => 2")
    .replace("last = () => 1", "last = () => 2"));

  const result = await run(cwd, "--since", "HEAD", "--use-existing-coverage");
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("first");
  expect(result.stdout).toContain("last");
  expect(result.stdout).not.toContain("middle");
});

test("prints OUCH scores and saves a machine-readable metrics report", async () => {
  const cwd = project({
    "src/orders.ts": "export function price(vip: boolean) {\n  if (vip) return 10;\n  return 20;\n}\n",
    "coverage/lcov.info": "SF:src/orders.ts\nDA:2,1\nDA:3,0\nend_of_record\n",
  });
  const result = await run(cwd, "--use-existing-coverage");
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toMatch(/^OUCH Report\n=+\nFunction\s+File\s+CC\s+Cog\s+Cov%\s+OUCH\n/);
  expect(result.stdout).toMatch(/price\s+src\/orders.ts:1\s+2\s+1\s+50\.0%\s+3\.5/);
  expect(JSON.parse(readFileSync(join(cwd, ".metrics/ouch.json"), "utf8"))).toEqual({ entries: [{
    name: "price", file: "src/orders.ts", line: 1, endLine: 4, complexity: 2, cognitive: 1, coverage: 50, ouch: 3.5,
  }] });
});
