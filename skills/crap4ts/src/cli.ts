#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { changedFunctionFilter } from "./changes.js";
import { analyzeProject } from "./project.js";
import { compareProject } from "./comparison.js";

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    help: { type: "boolean", short: "h" },
    "use-existing-coverage": { type: "boolean" },
    "source-root": { type: "string", multiple: true },
    lcov: { type: "string", default: "coverage/lcov.info" },
    "coverage-command": { type: "string", default: "npm run test:coverage" },
    since: { type: "string" },
    compare: { type: "string" },
    "setup-command": { type: "string", default: "npm ci --ignore-scripts" },
    refresh: { type: "boolean" },
  } });
  if (values.help) {
    console.log(`Usage: crap4ts [options] [path-fragment ...]

  --source-root <path>       Source directory, repeatable. Default: src
  --lcov <path>              LCOV report. Default: coverage/lcov.info
  --coverage-command <cmd>   Shell command. Default: npm run test:coverage
  --use-existing-coverage    Read coverage without running tests or checking freshness
  --since <ref>             Show functions changed since the merge base with ref
  --compare <ref>           Compare merge-base and HEAD scores in temporary checkouts
  --setup-command <cmd>     Comparison setup. Default: npm ci --ignore-scripts
  --refresh                 Regenerate both comparison reports instead of using cache
  -h, --help                Show this help

Normal reports sort by descending CRAP. Comparisons sort by descending score delta.
Path fragments filter the table. Normal reports write .metrics/crap.json;
comparisons write .metrics/crap-comparison.json and cache full commit reports.`);
    return;
  }
  if (values.compare !== undefined && (values.since !== undefined || values["use-existing-coverage"])) {
    throw new Error("--compare cannot combine with --since or --use-existing-coverage");
  }
  if (values.refresh && values.compare === undefined) throw new Error("--refresh requires --compare");
  const options = {
    cwd: process.cwd(), sourceRoots: values["source-root"] ?? ["src"], lcov: values.lcov,
    coverageCommand: values["coverage-command"], useExistingCoverage: values["use-existing-coverage"] ?? false,
  };
  if (values.compare !== undefined) {
    const report = await compareProject(values.compare, {
      ...options, setupCommand: values["setup-command"], refresh: values.refresh ?? false,
    });
    await mkdir(".metrics", { recursive: true });
    await writeFile(".metrics/crap-comparison.json", JSON.stringify(report, null, 2) + "\n");
    console.log(formatComparison(report.entries.filter(entry =>
      positionals.length === 0 || positionals.some(filter => entry.file.includes(filter)))));
    return;
  }
  const isChanged = values.since === undefined ? () => true : changedFunctionFilter(values.since);
  const entries = await analyzeProject(options);
  await mkdir(".metrics", { recursive: true });
  await writeFile(".metrics/crap.json", JSON.stringify({ entries }, null, 2) + "\n");
  const visible = entries.filter(entry => isChanged(entry) &&
    (positionals.length === 0 || positionals.some(filter => entry.file.includes(filter))));
  console.log(formatReport(visible));
  const unknown = entries.filter(entry => entry.coverage === null).length;
  if (unknown) console.error(`Warning: ${unknown} functions have N/A coverage. Check LCOV source paths and source maps.`);
}

function formatReport(entries: Awaited<ReturnType<typeof analyzeProject>>) {
  const rows = [["Function", "File", "CC", "Cov%", "CRAP"], ...entries.map(entry => [
    entry.name, `${entry.file}:${entry.line}`, String(entry.complexity),
    entry.coverage === null ? "N/A" : entry.coverage.toFixed(1) + "%",
    entry.crap === null ? "N/A" : entry.crap.toFixed(1),
  ])];
  return formatTable("CRAP Report", rows);
}

function formatComparison(entries: Awaited<ReturnType<typeof compareProject>>["entries"]) {
  const score = (value: number | null) => value === null ? "N/A" : value.toFixed(1);
  const rows = [["Function", "File", "CC base/head", "Cov% base/head", "CRAP base", "CRAP head", "Delta", "Status"],
    ...entries.map(entry => [entry.name, entry.file,
      `${entry.base?.complexity ?? "-"} / ${entry.head?.complexity ?? "-"}`,
      `${entry.base ? score(entry.base.coverage) : "-"} / ${entry.head ? score(entry.head.coverage) : "-"}`,
      entry.base ? score(entry.base.crap) : "-", entry.head ? score(entry.head.crap) : "-",
      entry.delta.crap === null ? "-" : (entry.delta.crap > 0 ? "+" : "") + score(entry.delta.crap), entry.status,
    ])];
  return formatTable("CRAP Comparison", rows) + (entries.length === 0 ? "\nNo matching metric changes." : "");
}

function formatTable(title: string, rows: string[][]) {
  const widths = rows[0]!.map((_, column) => Math.max(...rows.map(row => row[column]!.length)));
  return title + "\n" + "=".repeat(title.length) + "\n" + rows.map(row => row.map((value, column) =>
    column < 2 ? value.padEnd(widths[column]!) : value.padStart(widths[column]!)
  ).join("  ").trimEnd()).join("\n");
}

main().catch((error: unknown) => {
  console.error(`crap4ts: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
