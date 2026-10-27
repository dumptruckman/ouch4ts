import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
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
  { args: ["--use-existing-coverage"], status: 0, stdout: /price\s+src\/orders.ts:1\s+1\s+0\s+100\.0%\s+1\.0\s+1\.0/, stderr: /^$/ },
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

test("analyzes mixed JavaScript and TypeScript projects while excluding tests and generated sources", async () => {
  const sources = {
    "src/script.js": "function script() { return 1; }",
    "src/view.jsx": "export const View = () => <div />;",
    "src/module.mjs": "export const module = () => 1;",
    "src/common.cjs": "module.exports = function common() { return 1; };",
    "src/typed.ts": "export const typed = (): number => 1;",
  };
  const excluded = [
    "src/script.test.js", "src/view.spec.jsx", "src/module.test.mjs", "src/common.spec.cjs",
    "src/types.d.ts", "src/types.d.mts", "src/types.d.cts", "src/__tests__/helper.js",
    "src/__mocks__/service.cjs", "src/node_modules/vendor.js", "src/dist/output.js",
    "src/build/output.mjs", "src/coverage/report.js",
  ];
  const cwd = project({
    ...sources,
    ...Object.fromEntries(excluded.map(path => [path, "function broken( {"])),
    "coverage/lcov.info": Object.keys(sources).map(path => `SF:${path}\nDA:1,1\nend_of_record\n`).join(""),
  });
  const result = await run(cwd, "--use-existing-coverage");
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(readFileSync(join(cwd, ".metrics/ouch.json"), "utf8"))).toEqual({ entries: [
    { name: "common", file: "src/common.cjs", line: 1, endLine: 1, complexity: 1, cognitive: 0, coverage: 100, crap: 1, ouch: 1 },
    { name: "module", file: "src/module.mjs", line: 1, endLine: 1, complexity: 1, cognitive: 0, coverage: 100, crap: 1, ouch: 1 },
    { name: "script", file: "src/script.js", line: 1, endLine: 1, complexity: 1, cognitive: 0, coverage: 100, crap: 1, ouch: 1 },
    { name: "typed", file: "src/typed.ts", line: 1, endLine: 1, complexity: 1, cognitive: 0, coverage: 100, crap: 1, ouch: 1 },
    { name: "View", file: "src/view.jsx", line: 1, endLine: 1, complexity: 1, cognitive: 0, coverage: 100, crap: 1, ouch: 1 },
  ] });
});

test("excludes repeated globs before parsing across source roots and omits them from metrics", async () => {
  const cwd = project({
    "lib/orders.ts": "export const price = () => 10;",
    "services/worker.js": "export const work = () => 20;",
    "lib/generated/client.ts": "function broken( {",
    "services/nested/generated/client.js": "function broken( {",
    "lib/schema.generated.ts": "function broken( {",
    "services/deep/model.generated.mts": "function broken( {",
    "lib/.cache/client.generated.ts": "function broken( {",
    "coverage/lcov.info": "SF:lib/orders.ts\nDA:1,1\nend_of_record\nSF:services/worker.js\nDA:1,1\nend_of_record\n",
  });
  const result = await run(cwd, "--use-existing-coverage", "--source-root", "lib", "--source-root", "services",
    "--exclude", "**/generated/**", "--exclude", "**/*.generated.*");
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("price");
  expect(result.stdout).toContain("work");
  expect(result.stderr).toBe("");
  expect(JSON.parse(readFileSync(join(cwd, ".metrics/ouch.json"), "utf8"))).toMatchObject({ entries: [
    { name: "price", file: "lib/orders.ts" }, { name: "work", file: "services/worker.js" },
  ] });
});

test.each(["js", "jsx", "mjs", "cjs"])("reports a syntax error for malformed .%s without replacing metrics", async extension => {
  const path = `src/broken.${extension}`;
  const cwd = project({
    [path]: "function broken( {",
    "coverage/lcov.info": `SF:${path}\nDA:1,1\nend_of_record\n`,
    ".metrics/ouch.json": "previous report",
  });
  const result = await run(cwd, "--use-existing-coverage");
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(`${path}: syntax error:`);
  expect(readFileSync(join(cwd, ".metrics/ouch.json"), "utf8")).toBe("previous report");
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

test("explains how to generate coverage when test:coverage is absent", async () => {
  const cwd = project({
    "src/orders.ts": "export const price = () => 10;",
    "package.json": JSON.stringify({ scripts: { test: "node cover.cjs" } }),
    ".metrics/ouch.json": "previous report",
  });
  const result = await run(cwd);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('No "test:coverage" script');
  expect(result.stderr).toContain("--coverage-command");
  expect(result.stderr).toContain("--use-existing-coverage");
  expect(readFileSync(join(cwd, ".metrics/ouch.json"), "utf8")).toBe("previous report");
});

test.each([
  { manager: "yarn", metadata: "yarn@1.22.22", lockfiles: {} },
  { manager: "yarn", metadata: "yarn@4.9.2", lockfiles: { "pnpm-lock.yaml": "" } },
  { manager: "pnpm", metadata: "pnpm@10.11.0", lockfiles: {} },
  { manager: "bun", metadata: "bun@1.2.15", lockfiles: {} },
  { manager: "yarn", lockfiles: { "yarn.lock": "# yarn lockfile v1\n" } },
  { manager: "yarn", lockfiles: { "yarn.lock": "__metadata:\n  version: 8\n" } },
  { manager: "pnpm", lockfiles: { "pnpm-lock.yaml": "" } },
  { manager: "bun", lockfiles: { "bun.lock": "" } },
  { manager: "bun", lockfiles: { "bun.lockb": "", "bun.lock": "" } },
])("uses $manager for default coverage with $metadata and $lockfiles", async ({ manager, metadata, lockfiles }) => {
  usePackageManagers({ [manager]: { "run test:coverage": "cover.cjs" } });
  const cwd = project({
    "src/orders.ts": "export const price = () => 10;",
    "package.json": JSON.stringify({ packageManager: metadata, scripts: { "test:coverage": "exit 9" } }),
    "cover.cjs": `const fs = require('node:fs'); fs.mkdirSync('coverage'); fs.writeFileSync('coverage/lcov.info', 'SF:src/orders.ts\\nDA:1,1\\nend_of_record\\n');`,
    ...lockfiles,
  });
  const result = await run(cwd);
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toMatch(/price\s+src\/orders.ts:1\s+1\s+0\s+100\.0%\s+1\.0/);
});

test("finds the workspace package manager above the project directory", async () => {
  usePackageManagers({ yarn: { "run test:coverage": "cover.cjs" } });
  const repository = project({
    "package.json": JSON.stringify({ packageManager: "yarn@4.9.2" }),
    "packages/app/package.json": JSON.stringify({ scripts: { "test:coverage": "exit 9" } }),
    "packages/app/src/orders.ts": "export const price = () => 10;",
    "packages/app/cover.cjs": `const fs = require('node:fs'); fs.mkdirSync('coverage'); fs.writeFileSync('coverage/lcov.info', 'SF:src/orders.ts\\nDA:1,1\\nend_of_record\\n');`,
  });
  const result = await run(join(repository, "packages/app"));
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("100.0%");
});

test.each([
  { files: { "package.json": JSON.stringify({ packageManager: "other@1.0.0", scripts: { "test:coverage": "exit 9" } }) }, message: /Unsupported packageManager/ },
  { files: { "package.json": JSON.stringify({ scripts: { "test:coverage": "exit 9" } }), "yarn.lock": "", "pnpm-lock.yaml": "" }, message: /Multiple package-manager lockfiles/ },
])("explicit commands and existing coverage bypass detection errors: $message", async ({ files, message }) => {
  const cwd = project({
    "src/orders.ts": "export const price = () => 10;",
    "cover.cjs": `const fs = require('node:fs'); fs.mkdirSync('coverage'); fs.writeFileSync('coverage/lcov.info', 'SF:src/orders.ts\\nDA:1,1\\nend_of_record\\n');`,
    ...files,
  });
  const detected = await run(cwd);
  expect(detected.status).toBe(1);
  expect(detected.stderr).toMatch(message);
  expect(detected.stderr).toContain("--coverage-command");
  expect((await run(cwd, "--coverage-command", "node cover.cjs")).status).toBe(0);
  expect((await run(cwd, "--use-existing-coverage")).stdout).toContain("100.0%");
});

test.each([
  ["--coverage-command", ""],
  ["--coverage-command", "  "],
  ["--compare", "HEAD", "--setup-command", "  "],
])("rejects empty commands: %j", async (...args) => {
  const result = await run(project({}), ...args);
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/--(?:coverage|setup)-command must not be empty/);
});

test.each(["", "  "])("rejects an empty exclusion glob: %j", async pattern => {
  const result = await run(project({}), "--exclude", pattern);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("--exclude must not be empty");
});

afterEach(() => {
  vi.unstubAllEnvs();
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

function usePackageManagers(commands: Record<string, Record<string, string>>) {
  const bin = project({});
  for (const [manager, scripts] of Object.entries(commands)) {
    const path = join(bin, manager);
    writeFileSync(path, `#!${process.execPath}
const scripts = ${JSON.stringify(scripts)};
const command = process.argv.slice(2).join(' ');
if (!(command in scripts)) throw new Error('Unexpected ${manager} command: ' + command);
require('node:child_process').execFileSync(process.execPath, [scripts[command]], { stdio: 'inherit' });
`);
    chmodSync(path, 0o755);
  }
  vi.stubEnv("PATH", `${bin}${delimiter}${process.env.PATH}`);
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
  expect(result.stdout).toMatch(/^OUCH Comparison\n=+\n.*CRAP base\s+CRAP head\s+CRAP delta\s+OUCH base\s+OUCH head/);
  expect(result.stdout).toMatch(/price\s+src\/orders.ts\s+2 \/ 2\s+1 \/ 1\s+50\.0 \/ 100\.0\s+2\.5\s+2\.0\s+-0\.5\s+3\.5\s+3\.0\s+-0\.5\s+changed/);
  const report = JSON.parse(readFileSync(join(cwd, ".metrics/ouch-comparison.json"), "utf8"));
  expect(report).toMatchObject({ base, head, entries: expect.arrayContaining([
    { name: "price", file: "src/orders.ts", status: "changed",
      base: expect.objectContaining({ complexity: 2, cognitive: 1, coverage: 50, crap: 2.5, ouch: 3.5 }),
      head: expect.objectContaining({ complexity: 2, cognitive: 1, coverage: 100, crap: 2, ouch: 3 }),
      delta: { complexity: 0, cognitive: 0, coverage: 50, crap: -0.5, ouch: -0.5 } },
    { name: "added", file: "src/orders.ts", status: "added", base: null,
      head: expect.objectContaining({ crap: 1, ouch: 1 }), delta: { complexity: null, cognitive: null, coverage: null, crap: null, ouch: null } },
    { name: "removed", file: "src/orders.ts", status: "removed", head: null,
      base: expect.objectContaining({ crap: 2, ouch: 2 }), delta: { complexity: null, cognitive: null, coverage: null, crap: null, ouch: null } },
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

test("comparison exclusions use project-relative paths and separate reusable caches", async () => {
  const cwd = comparisonProject({
    "src/generated/client.ts": "export function generated(flag: boolean) { return 0; }",
    "src/schema.generated.ts": "export function schema(flag: boolean) { return 0; }",
  }, "packages/app");
  writeFileSync(join(cwd, "src/generated/client.ts"), "export function generated(flag: boolean) { if (flag) return 0; return 1; }");
  writeFileSync(join(cwd, "src/schema.generated.ts"), "export function schema(flag: boolean) { if (flag) return 0; return 1; }");
  commit(cwd, "Change generated functions");
  const all = await runComparison(cwd);
  expect(all.status, all.stderr).toBe(0);
  const reportPath = join(cwd, ".metrics/ouch-comparison.json");
  const original = readFileSync(reportPath, "utf8");
  expect(original).toContain("src/generated/client.ts");
  expect(original).toContain("src/schema.generated.ts");

  const excluded = await runComparison(cwd, "--exclude", "./src/generated/**", "--exclude", "**/*.generated.*");
  expect(excluded.status, excluded.stderr).toBe(0);
  const filtered = readFileSync(reportPath, "utf8");
  expect(filtered).not.toContain("generated");
  expect(JSON.parse(filtered).entries).toHaveLength(3);
  expect(excluded.stderr.match(/Analyzing /g)).toHaveLength(2);
  expect(readdirSync(join(cwd, ".metrics/cache"))).toHaveLength(4);

  const repeated = await runComparison(cwd, "--exclude", "**/*.generated.*", "--exclude", "./src/generated/**",
    "--exclude", "**/*.generated.*");
  expect(repeated.status, repeated.stderr).toBe(0);
  expect(repeated.stderr.match(/Using cached report/g)).toHaveLength(2);
  expect(readFileSync(reportPath, "utf8")).toBe(filtered);
  expect((await runComparison(cwd)).status).toBe(0);
  expect(readFileSync(reportPath, "utf8")).toBe(original);
});

test.each(["ts", "js"])("comparison reports cognitive changes in .%s even when coverage and OUCH are unknown", async extension => {
  const path = `src/logic.${extension}`;
  const cwd = comparisonProject({
    [path]: "export function logic() { if (a) {} if (b) {} }\n",
  });
  writeFileSync(join(cwd, path), "export function logic() { if (a) { if (b) {} } }\n");
  commit(cwd, "Nest the conditions");
  const result = await runComparison(cwd);
  expect(result.status, result.stderr).toBe(0);
  const report = JSON.parse(readFileSync(join(cwd, ".metrics/ouch-comparison.json"), "utf8"));
  expect(report.entries).toContainEqual({
    name: "logic", file: path, status: "changed",
    base: expect.objectContaining({ complexity: 3, cognitive: 2, coverage: null, crap: null, ouch: null }),
    head: expect.objectContaining({ complexity: 3, cognitive: 3, coverage: null, crap: null, ouch: null }),
    delta: { complexity: 0, cognitive: 1, coverage: null, crap: null, ouch: null },
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
      base: expect.objectContaining({ file: "src/orders.ts" }), delta: { complexity: 0, cognitive: 0, coverage: 50, crap: -0.5, ouch: -0.5 } }),
    expect.objectContaining({ name: "stable", status: "renamed", delta: { complexity: 0, cognitive: 0, coverage: 0, crap: 0, ouch: 0 } }),
  ]));
  const callbacks = report.entries.filter((entry: { name: string }) => entry.name.startsWith("callbacks.<anonymous@"));
  expect(callbacks).toHaveLength(1);
  expect(callbacks[0]).toMatchObject({ status: "renamed", delta: { complexity: 0, cognitive: 0, coverage: 0, crap: 0, ouch: 0 } });
});

test("comparison preserves unknown coverage without inventing a numeric score delta", async () => {
  const cwd = comparisonProject();
  writeFileSync(join(cwd, "lines.json"), JSON.stringify([[6, 1], [7, 1], [9, 1]]));
  commit(cwd, "Omit price coverage");
  const result = await runComparison(cwd);
  expect(result.status, result.stderr).toBe(0);
  const report = JSON.parse(readFileSync(join(cwd, ".metrics/ouch-comparison.json"), "utf8"));
  expect(report.entries).toContainEqual(expect.objectContaining({ name: "price", status: "changed",
    base: expect.objectContaining({ crap: 2.5, ouch: 3.5 }), head: expect.objectContaining({ coverage: null, crap: null, ouch: null }),
    delta: { complexity: 0, cognitive: 0, coverage: null, crap: null, ouch: null },
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

test.each([
  { manager: "yarn", metadata: "yarn@1.22.22", setup: "install --frozen-lockfile --ignore-scripts", lockfiles: {} },
  { manager: "yarn", metadata: "yarn@2.4.3", setup: "install --immutable --skip-builds", lockfiles: {} },
  { manager: "yarn", metadata: "yarn@4.9.2", setup: "install --immutable --mode=skip-build", lockfiles: {} },
  { manager: "yarn", setup: "install --immutable --mode=skip-build", lockfiles: { "yarn.lock": "__metadata:\n  version: 8\n" } },
  { manager: "yarn", setup: "install --immutable --skip-builds", yarnVersion: "2.4.3", lockfiles: { "yarn.lock": "__metadata:\n  version: 4\n" } },
  { manager: "yarn", setup: "install --frozen-lockfile --ignore-scripts", lockfiles: { "yarn.lock": "# yarn lockfile v1\n" } },
  { manager: "pnpm", metadata: "pnpm@10.11.0", setup: "install --frozen-lockfile --ignore-scripts", lockfiles: {} },
  { manager: "bun", metadata: "bun@1.2.15", setup: "install --frozen-lockfile --ignore-scripts", lockfiles: {} },
])("comparison uses $manager $setup with $metadata and $lockfiles", async ({ manager, metadata, setup, lockfiles, yarnVersion }) => {
  usePackageManagers({ [manager]: { [setup]: "setup.cjs", "run test:coverage": "cover.cjs", "--version": "yarn-version.cjs" } });
  const cwd = comparisonProject({
    "package.json": JSON.stringify({ packageManager: metadata, scripts: { "test:coverage": "exit 9" } }),
    ...(manager === "yarn" ? { "yarn.lock": "# yarn lockfile v1\n" } : {}),
    "yarn-version.cjs": `console.log(${JSON.stringify(yarnVersion ?? "4.9.2")});`,
    ...lockfiles,
  });
  const result = await run(cwd, "--compare", "base");
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("price");
  expect(readFileSync(join(cwd, "calls.log"), "utf8").trim().split("\n")).toHaveLength(4);
});

test("comparison requires a Yarn lockfile before its default setup runs", async () => {
  usePackageManagers({ yarn: { "install --frozen-lockfile --ignore-scripts": "setup.cjs", "run test:coverage": "cover.cjs" } });
  const cwd = comparisonProject({
    "package.json": JSON.stringify({ packageManager: "yarn@1.22.22", scripts: { "test:coverage": "exit 9" } }),
  });
  const result = await run(cwd, "--compare", "base");
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("requires yarn.lock");
  expect(result.stderr).toContain("--setup-command");
  expect(existsSync(join(cwd, "calls.log"))).toBe(false);
});

test("comparison explains an unavailable Yarn version and accepts an explicit setup command", async () => {
  usePackageManagers({ yarn: { "--version": "yarn-version.cjs" } });
  const cwd = comparisonProject({
    "package.json": JSON.stringify({ scripts: { "test:coverage": "node cover.cjs" } }),
    "yarn.lock": "__metadata:\n  version: 4\n",
    "yarn-version.cjs": "process.exit(9);",
  });
  const result = await run(cwd, "--compare", "base");
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("yarn --version");
  expect(result.stderr).toContain("--setup-command");
  expect(existsSync(join(cwd, "calls.log"))).toBe(false);
  expect((await runComparison(cwd)).status).toBe(0);
});

test("comparison resolves package managers separately for each committed revision", async () => {
  usePackageManagers({
    pnpm: { "install --frozen-lockfile --ignore-scripts": "setup.cjs", "run test:coverage": "cover-pnpm.cjs" },
    yarn: { "install --immutable --mode=skip-build": "setup.cjs", "run test:coverage": "cover-yarn.cjs" },
  });
  const cwd = comparisonProject({
    "package.json": JSON.stringify({ packageManager: "pnpm@10.11.0", scripts: { "test:coverage": "exit 9" } }),
    "cover-pnpm.cjs": `if (require('./package.json').packageManager !== 'pnpm@10.11.0') process.exit(8); require('./cover.cjs');`,
    "cover-yarn.cjs": `if (require('./package.json').packageManager !== 'yarn@4.9.2') process.exit(8); require('./cover.cjs');`,
  });
  writeFileSync(join(cwd, "package.json"), JSON.stringify({ packageManager: "yarn@4.9.2", scripts: { "test:coverage": "exit 9" } }));
  writeFileSync(join(cwd, "yarn.lock"), "__metadata:\n  version: 8\n");
  commit(cwd, "Switch to Yarn");
  const result = await run(cwd, "--compare", "base");
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("price");
});

test("explicit comparison commands work without package-manager metadata or a coverage script", async () => {
  const cwd = comparisonProject({ "package.json": JSON.stringify({ packageManager: "other@1.0.0" }) });
  const result = await runComparison(cwd);
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("price");
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

test.each(["ts", "js"])("since reports changed .%s functions with full scores and preserves complete metrics", async extension => {
  const path = `src/orders.${extension}`;
  const before = "export function changed(vip) {\n  if (vip) return 1;\n  return 2;\n}\n\nexport const untouched = () => 4;\n";
  const cwd = project({
    [path]: before,
    "coverage/lcov.info": `SF:${path}\nDA:2,1\nDA:3,0\nDA:6,1\nend_of_record\n`,
  });
  git(cwd, "init", "-q", "--initial-branch=main");
  commit(cwd, "Base");
  git(cwd, "branch", "base");
  writeFileSync(join(cwd, path), before.replace("return 2", "return 3"));
  commit(cwd, "Change price");

  const result = await run(cwd, "--since", "base", "--use-existing-coverage");
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain(`${path}:1`);
  expect(result.stdout).toMatch(/changed\s+\S+:1\s+2\s+1\s+50\.0%\s+2\.5\s+3\.5/);
  expect(result.stdout).not.toContain("untouched");
  expect(JSON.parse(readFileSync(join(cwd, ".metrics/ouch.json"), "utf8"))).toMatchObject({ entries: [
    { name: "changed", crap: 2.5, ouch: 3.5 }, { name: "untouched", crap: 1, ouch: 1 },
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

test.each([
  { name: "partial", lcov: "SF:src/orders.ts\nDA:2,1\nDA:3,0\nend_of_record\n",
    expected: { coverage: 50, crap: 2.5, ouch: 3.5 }, row: /50\.0%\s+2\.5\s+3\.5/ },
  { name: "unknown", lcov: "SF:src/other.ts\nDA:1,1\nend_of_record\n",
    expected: { coverage: null, crap: null, ouch: null }, row: /N\/A\s+N\/A\s+N\/A/ },
])("prints and saves CRAP alongside OUCH with $name coverage", async ({ lcov, expected, row }) => {
  const cwd = project({
    "src/orders.ts": "export function price(vip: boolean) {\n  if (vip) return 10;\n  return 20;\n}\n",
    "coverage/lcov.info": lcov,
  });
  const result = await run(cwd, "--use-existing-coverage");
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toMatch(/^OUCH Report\n=+\nFunction\s+File\s+CC\s+Cog\s+Cov%\s+CRAP\s+OUCH\n/);
  expect(result.stdout).toMatch(/price\s+src\/orders.ts:1\s+2\s+1\s+/);
  expect(result.stdout).toMatch(row);
  expect(JSON.parse(readFileSync(join(cwd, ".metrics/ouch.json"), "utf8"))).toEqual({ entries: [{
    name: "price", file: "src/orders.ts", line: 1, endLine: 4, complexity: 2, cognitive: 1, ...expected,
  }] });
});
