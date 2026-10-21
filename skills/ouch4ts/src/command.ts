import { mkdir, realpath, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { changedFunctionFilter } from "./changes.js";
import { analyzeProject } from "./project.js";
import { compareProject } from "./comparison.js";

function parseOptions(args: string[]) {
  return parseArgs({ args, allowPositionals: true, options: {
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
}

/** Run a report in the supplied project without changing the process working directory. */
export async function runCli(args: string[], cwd: string) {
  const { values, positionals } = parseOptions(args);
  if (values.help) {
    console.log(`Usage: ouch4ts [options] [path-fragment ...]

  --source-root <path>       Source directory, repeatable. Default: src
  --lcov <path>              LCOV report. Default: coverage/lcov.info
  --coverage-command <cmd>   Shell command. Default: npm run test:coverage
  --use-existing-coverage    Read coverage without running tests or checking freshness
  --since <ref>             Show functions changed since the merge base with ref
  --compare <ref>           Compare merge-base and HEAD scores in temporary checkouts
  --setup-command <cmd>     Comparison setup. Default: npm ci --ignore-scripts
  --refresh                 Regenerate both comparison reports instead of using cache
  -h, --help                Show this help

Normal reports sort by descending OUCH. Comparisons sort by descending score delta.
OUCH means Overall Upkeep and Change Hassle, derived from CRAP.
Scores combine cyclomatic complexity, cognitive complexity, and line coverage.
Path fragments filter the table. Normal reports write .metrics/ouch.json;
comparisons write .metrics/ouch-comparison.json and cache full commit reports.`);
    return;
  }
  validateReportMode(values);
  cwd = await realpath(cwd);
  const options = projectOptions(values, cwd);
  if (values.compare !== undefined) {
    const report = await compareProject(values.compare, {
      ...options, setupCommand: values["setup-command"], refresh: values.refresh ?? false,
    });
    await writeReport(cwd, "ouch-comparison.json", report);
    console.log(formatComparison(report.entries.filter(entry =>
      matchesPath(entry.file, positionals))));
    return;
  }
  await reportCurrent(options, values.since, positionals);
}

async function reportCurrent(options: Parameters<typeof analyzeProject>[0], since: string | undefined, positionals: string[]) {
  const isChanged = since === undefined ? () => true : changedFunctionFilter(since, options.cwd);
  const entries = await analyzeProject(options);
  await writeReport(options.cwd, "ouch.json", { entries });
  const visible = entries.filter(entry => isChanged(entry) && matchesPath(entry.file, positionals));
  console.log(formatReport(visible));
  const unknown = entries.filter(entry => entry.coverage === null).length;
  if (unknown) console.error(`Warning: ${unknown} functions have N/A coverage. Check LCOV source paths and source maps.`);
}

function formatReport(entries: Awaited<ReturnType<typeof analyzeProject>>) {
  const rows = [["Function", "File", "CC", "Cog", "Cov%", "OUCH"], ...entries.map(entry => [
    entry.name, `${entry.file}:${entry.line}`, String(entry.complexity), String(entry.cognitive),
    entry.coverage === null ? "N/A" : entry.coverage.toFixed(1) + "%",
    entry.ouch === null ? "N/A" : entry.ouch.toFixed(1),
  ])];
  return formatTable("OUCH Report", rows);
}

type Metric = Awaited<ReturnType<typeof analyzeProject>>[number];

function formatComparison(entries: Awaited<ReturnType<typeof compareProject>>["entries"]) {
  const rows = [["Function", "File", "CC base/head", "Cog base/head", "Cov% base/head", "OUCH base", "OUCH head", "Delta", "Status"],
    ...entries.map(entry => [entry.name, entry.file,
      pairedComplexity(entry.base, entry.head, "complexity"), pairedComplexity(entry.base, entry.head, "cognitive"),
      `${sideScore(entry.base, "coverage")} / ${sideScore(entry.head, "coverage")}`,
      sideScore(entry.base, "ouch"), sideScore(entry.head, "ouch"), formatDelta(entry.delta.ouch), entry.status,
    ])];
  return formatTable("OUCH Comparison", rows) + (entries.length === 0 ? "\nNo matching metric changes." : "");
}

function pairedComplexity(base: Metric | null, head: Metric | null, field: "complexity" | "cognitive") {
  return `${base?.[field] ?? "-"} / ${head?.[field] ?? "-"}`;
}

function sideScore(entry: Metric | null, field: "coverage" | "ouch") {
  if (entry === null) return "-";
  const value = entry[field];
  return value === null ? "N/A" : value.toFixed(1);
}

function formatDelta(value: number | null) {
  if (value === null) return "-";
  return (value > 0 ? "+" : "") + value.toFixed(1);
}

function formatTable(title: string, rows: string[][]) {
  const widths = rows[0]!.map((_, column) => {
    const lengths = rows.map(row => row[column]!.length);
    return Math.max(...lengths);
  });
  const formatted = rows.map(row => {
    const columns = row.map((value, column) =>
      column < 2 ? value.padEnd(widths[column]!) : value.padStart(widths[column]!)
    );
    return columns.join("  ").trimEnd();
  });
  return [title, "=".repeat(title.length), ...formatted].join("\n");
}

type CliValues = ReturnType<typeof parseOptions>["values"];

function validateReportMode(values: CliValues) {
  if (values.compare === undefined) {
    if (values.refresh) throw new Error("--refresh requires --compare");
    return;
  }
  if (values.since !== undefined || values["use-existing-coverage"]) {
    throw new Error("--compare cannot combine with --since or --use-existing-coverage");
  }
}

function projectOptions(values: CliValues, cwd: string) {
  return {
    cwd, sourceRoots: values["source-root"] ?? ["src"], lcov: values.lcov,
    coverageCommand: values["coverage-command"], useExistingCoverage: values["use-existing-coverage"] ?? false,
  };
}

function matchesPath(file: string, filters: string[]) {
  if (filters.length === 0) return true;
  return filters.some(filter => file.includes(filter));
}

async function writeReport(cwd: string, filename: string, report: unknown) {
  await mkdir(resolve(cwd, ".metrics"), { recursive: true });
  await writeFile(resolve(cwd, ".metrics", filename), JSON.stringify(report, null, 2) + "\n");
}
