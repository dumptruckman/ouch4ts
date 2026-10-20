import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, expect, test } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const cli = join(root, "dist/cli.js");
const projects: string[] = [];

beforeAll(() => {
  execFileSync(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.build.json"], { cwd: root });
});

test("help works without source files or a coverage setup", () => {
  const cwd = project({});
  const result = run(cwd, "--help");
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("--use-existing-coverage");
  expect(existsSync(join(cwd, ".metrics"))).toBe(false);
});

test.each([
  [["--unknown"], /Unknown option/],
  [["--lcov"], /argument missing/],
  [["--use-existing-coverage"], /ENOENT.*src/],
])("reports a setup error for %j", (args, message) => {
  const result = run(project({}), ...args);
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(message);
});

test("supports custom roots and coverage, filters the table, and rebuilds all metrics", () => {
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
    ".metrics/crap.json": JSON.stringify({ entries: [{ name: "obsolete" }] }),
  });
  const result = run(cwd, "--source-root", "lib", "--source-root", "services", "--source-root", "lib",
    "--lcov", "reports/unit.lcov", "--coverage-command", "node cover.cjs", "orders");
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("price");
  expect(result.stdout).not.toContain("work");
  expect(JSON.parse(readFileSync(join(cwd, ".metrics/crap.json"), "utf8"))).toMatchObject({ entries: [
    { name: "price", coverage: 100 }, { name: "View", coverage: null }, { name: "work", coverage: null },
  ] });
  expect(result.stderr).toMatch(/2 functions.*N\/A/);
});

test.each([
  ["process.exit(7)", /Coverage command failed/],
  ["console.log('no coverage generated')", /did not update/],
])("refuses to score stale coverage after %s", (command, message) => {
  const cwd = project({
    "src/orders.ts": "export function price() { return 10; }",
    "coverage/lcov.info": "SF:src/orders.ts\nDA:1,1\nend_of_record\n",
    "package.json": JSON.stringify({ scripts: { "test:coverage": "node cover.cjs" } }),
    "cover.cjs": command,
  });
  const result = run(cwd);
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(message);
  expect(existsSync(join(cwd, ".metrics/crap.json"))).toBe(false);
});

test("runs the project's coverage script and replaces stale scores with fresh coverage", () => {
  const cwd = project({
    "src/orders.ts": "export function price() { return 10; }",
    "coverage/lcov.info": "SF:src/orders.ts\nDA:1,0\nend_of_record\n",
    "package.json": JSON.stringify({ scripts: { "test:coverage": "node cover.cjs" } }),
    "cover.cjs": `require('node:fs').writeFileSync('coverage/lcov.info', 'SF:src/orders.ts\\nDA:1,1\\nend_of_record\\n');`,
  });
  const result = run(cwd);
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(readFileSync(join(cwd, ".metrics/crap.json"), "utf8"))).toMatchObject({
    entries: [{ name: "price", coverage: 100, crap: 1 }],
  });
});

afterEach(() => {
  for (const project of projects.splice(0)) rmSync(project, { recursive: true, force: true });
});

function project(files: Record<string, string>) {
  const path = mkdtempSync(join(tmpdir(), "crap4ts-test-"));
  projects.push(path);
  for (const [name, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(path, name)), { recursive: true });
    writeFileSync(join(path, name), contents);
  }
  return path;
}

function run(cwd: string, ...args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });
}

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", ["-c", "user.name=CRAP tests", "-c", "user.email=tests@example.com",
    "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" });
}

function commit(cwd: string, message: string) {
  git(cwd, "add", ".");
  git(cwd, "commit", "-qm", message);
}

test("since reports changed functions with full scores and preserves complete metrics", () => {
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

  const result = run(cwd, "--since", "base", "--use-existing-coverage");
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toMatch(/changed\s+src\/orders.ts:1\s+2\s+50.0%\s+2.5/);
  expect(result.stdout).not.toContain("untouched");
  expect(JSON.parse(readFileSync(join(cwd, ".metrics/crap.json"), "utf8"))).toMatchObject({ entries: [
    { name: "changed", crap: 2.5 }, { name: "untouched", crap: 1 },
  ] });
});

test("since includes deletions inside a function without blaming a neighbor for a removed function", () => {
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

  const result = run(cwd, "--since", "HEAD", "--use-existing-coverage");
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toMatch(/changed\s+src\/orders.ts:4/);
  expect(result.stdout).not.toContain("untouched");
  expect(result.stdout).not.toContain("removed");
});

test("since uses the merge base of diverged branches and composes with path filters", () => {
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

  const result = run(cwd, "--since", "main", "--use-existing-coverage");
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("src/feature.ts");
  expect(result.stdout).toContain("src/other.ts");
  expect(result.stdout).not.toContain("src/target.ts");

  const filtered = run(cwd, "--since", "main", "--use-existing-coverage", "feature");
  expect(filtered.status, filtered.stderr).toBe(0);
  expect(filtered.stdout).toContain("src/feature.ts");
  expect(filtered.stdout).not.toContain("src/other.ts");
});

test("since follows edited renames and quoted paths from a project below the Git root", () => {
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

  const result = run(join(cwd, "packages/app"), "--since", "base", "--use-existing-coverage");
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("changed");
  expect(result.stdout).toContain(filename);
  expect(result.stdout).not.toContain("untouched");
  expect(result.stdout).not.toContain("moved");
});

test("since includes functions in added files and skips changes outside function ranges", () => {
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

  const result = run(cwd, "--since", "HEAD", "--use-existing-coverage");
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("added");
  expect(result.stdout).not.toContain("untouched");
});

test("since gives an empty table for an unchanged checkout without losing its metrics", () => {
  const cwd = project({
    "src/orders.ts": "export const untouched = () => 1;\n",
    "coverage/lcov.info": "SF:src/orders.ts\nDA:1,1\nend_of_record\n",
  });
  git(cwd, "init", "-q", "--initial-branch=main");
  commit(cwd, "Base");

  const result = run(cwd, "--since", "HEAD", "--use-existing-coverage");
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).not.toContain("untouched");
  expect(JSON.parse(readFileSync(join(cwd, ".metrics/crap.json"), "utf8"))).toMatchObject({
    entries: [{ name: "untouched" }],
  });
});

test("since fails before running coverage or writing metrics when its Git reference is invalid", () => {
  const cwd = project({ "src/orders.ts": "export const price = () => 1;\n" });
  git(cwd, "init", "-q", "--initial-branch=main");
  commit(cwd, "Base");

  const result = run(cwd, "--since", "missing-reference", "--coverage-command", "node -e \"process.exit(42)\"");
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/git rev-parse failed/);
  expect(result.stderr).not.toContain("Coverage command failed");
  expect(existsSync(join(cwd, ".metrics"))).toBe(false);
});

test("since excludes unchanged functions between hunks even when Git is configured to merge context", () => {
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

  const result = run(cwd, "--since", "HEAD", "--use-existing-coverage");
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("first");
  expect(result.stdout).toContain("last");
  expect(result.stdout).not.toContain("middle");
});

test("prints function risk and saves a machine-readable metrics report", () => {
  const cwd = project({
    "src/orders.ts": "export function price(vip: boolean) {\n  if (vip) return 10;\n  return 20;\n}\n",
    "coverage/lcov.info": "SF:src/orders.ts\nDA:2,1\nDA:3,0\nend_of_record\n",
  });
  const result = run(cwd, "--use-existing-coverage");
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toMatch(/price\s+src\/orders.ts:1\s+2\s+50.0%\s+2.5/);
  expect(JSON.parse(readFileSync(join(cwd, ".metrics/crap.json"), "utf8"))).toEqual({ entries: [{
    name: "price", file: "src/orders.ts", line: 1, endLine: 4, complexity: 2, coverage: 50, crap: 2.5,
  }] });
});
