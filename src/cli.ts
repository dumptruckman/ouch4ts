#!/usr/bin/env node
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";
import { analyze } from "./index.js";
import { changedFunctionFilter } from "./changes.js";

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    help: { type: "boolean", short: "h" },
    "use-existing-coverage": { type: "boolean" },
    "source-root": { type: "string", multiple: true },
    lcov: { type: "string", default: "coverage/lcov.info" },
    "coverage-command": { type: "string", default: "npm run test:coverage" },
    since: { type: "string" },
  } });
  if (values.help) {
    console.log(`Usage: crap4ts [options] [path-fragment ...]

  --source-root <path>       Source directory, repeatable. Default: src
  --lcov <path>              LCOV report. Default: coverage/lcov.info
  --coverage-command <cmd>   Shell command. Default: npm run test:coverage
  --use-existing-coverage    Read coverage without running tests or checking freshness
  --since <ref>             Show functions changed since the merge base with ref
  -h, --help                Show this help

Prints functions by descending CRAP score. Path fragments filter the table.
Writes all analyzed functions to .metrics/crap.json on every successful run.`);
    return;
  }
  const isChanged = values.since === undefined ? () => true : changedFunctionFilter(values.since);
  const roots = values["source-root"] ?? ["src"];
  const paths = [...new Set((await Promise.all(roots.map(discover))).flat().map(path => resolve(path)))];
  if (paths.length === 0) throw new Error(`No TypeScript sources found under ${roots.join(", ")}`);
  if (!values["use-existing-coverage"]) {
    const before = await reportStamp(values.lcov);
    const result = spawnSync(values["coverage-command"], { shell: true, stdio: ["ignore", 2, 2] });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Coverage command failed: ${result.signal ?? result.status}`);
    const after = await reportStamp(values.lcov);
    if (after === null || before === after) throw new Error(`Coverage command did not update ${values.lcov}`);
  }
  const sources = await Promise.all(paths.map(async path => ({ path, text: await readFile(path, "utf8") })));
  const entries = analyze({ sources, lcov: await readFile(values.lcov, "utf8") });
  await mkdir(".metrics", { recursive: true });
  await writeFile(".metrics/crap.json", JSON.stringify({ entries }, null, 2) + "\n");
  const visible = entries.filter(entry => isChanged(entry) &&
    (positionals.length === 0 || positionals.some(filter => entry.file.includes(filter))));
  console.log(formatReport(visible));
  const unknown = entries.filter(entry => entry.coverage === null).length;
  if (unknown) console.error(`Warning: ${unknown} functions have N/A coverage. Check LCOV source paths and source maps.`);
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

function formatReport(entries: ReturnType<typeof analyze>) {
  const rows = [["Function", "File", "CC", "Cov%", "CRAP"], ...entries.map(entry => [
    entry.name, `${entry.file}:${entry.line}`, String(entry.complexity),
    entry.coverage === null ? "N/A" : entry.coverage.toFixed(1) + "%",
    entry.crap === null ? "N/A" : entry.crap.toFixed(1),
  ])];
  const widths = rows[0]!.map((_, column) => Math.max(...rows.map(row => row[column]!.length)));
  return "CRAP Report\n===========\n" + rows.map(row => row.map((value, column) =>
    column < 2 ? value.padEnd(widths[column]!) : value.padStart(widths[column]!)
  ).join("  ").trimEnd()).join("\n");
}

main().catch((error: unknown) => {
  console.error(`crap4ts: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
