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
