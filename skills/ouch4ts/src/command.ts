import { mkdir, realpath, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { changedSourceFilter } from "./changes.js";
import { analyzeProject } from "./project.js";
import { compareProject } from "./comparison.js";

function parseOptions(args: string[]) {
  return parseArgs({ args, allowPositionals: true, options: {
    help: { type: "boolean", short: "h" },
    "use-existing-coverage": { type: "boolean" },
    "source-root": { type: "string", multiple: true },
    exclude: { type: "string", multiple: true },
    lcov: { type: "string", default: "coverage/lcov.info" },
    "coverage-command": { type: "string" },
    since: { type: "string" },
    compare: { type: "string" },
    "setup-command": { type: "string" },
    refresh: { type: "boolean" },
  } });
}

/** Run a report in the supplied project without changing the process working directory. */
export async function runCli(args: string[], cwd: string) {
  const { values, positionals } = parseOptions(args);
  if (values.help) {
    console.log(`Usage: ouch4ts [options] [path-fragment ...]

  --source-root <path>       Source directory, repeatable. Default: src
  --exclude <glob>           Exclude project-relative paths, repeatable. Quote globs.
  --lcov <path>              LCOV report. Default: coverage/lcov.info
  --coverage-command <cmd>   Shell command. Default: <package-manager> run test:coverage
  --use-existing-coverage    Read coverage without running tests or checking freshness
  --since <ref>             Show functions changed since the merge base with ref
  --compare <ref>           Compare merge-base and HEAD scores in temporary checkouts
  --setup-command <cmd>      Comparison setup. Default: detected manager's frozen install
  --refresh                 Regenerate both comparison reports instead of using cache
  -h, --help                Show this help

File tables sort by cognitive complexity or its delta. Function tables sort by OUCH or its delta.
File metrics follow SonarJS. Function Cog incl includes nested functions; CRAP and OUCH use own scores.
OUCH means Overall Upkeep and Change Hassle, derived from CRAP.
CRAP combines cyclomatic complexity and line coverage; OUCH adds cognitive complexity.
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
    const files = report.files.filter(entry => matchesPath(entry.file, positionals));
    const entries = report.entries.filter(entry => matchesPath(entry.file, positionals));
    console.log(formatFileComparison(files) + "\n\n" + formatComparison(entries));
    return;
  }
  await reportCurrent(options, values.since, positionals);
}

async function reportCurrent(options: Parameters<typeof analyzeProject>[0], since: string | undefined, positionals: string[]) {
  const changes = since === undefined ? undefined : changedSourceFilter(since, options.cwd);
  const report = await analyzeProject(options);
  await writeReport(options.cwd, "ouch.json", report);
  const entries = report.entries.filter(entry => (changes?.matchesFunction(entry) ?? true) && matchesPath(entry.file, positionals));
  const files = report.files.filter(entry => (changes?.matchesFile(entry.file) ?? true) && matchesPath(entry.file, positionals));
  console.log(formatFiles(files) + "\n\n" + formatReport(entries));
  const unknown = report.entries.filter(entry => entry.coverage === null).length;
  if (unknown) console.error(`Warning: ${unknown} functions have N/A coverage. Check LCOV source paths and source maps.`);
}

function formatFiles(files: Awaited<ReturnType<typeof analyzeProject>>["files"]) {
  const rows = [["File", "CC", "Cog", "Functions"], ...files.map(entry => [
    entry.file, String(entry.complexity), String(entry.cognitive), String(entry.functions),
  ])];
  return formatTable("File complexity", rows, 1);
}

function formatReport(entries: Awaited<ReturnType<typeof analyzeProject>>["entries"]) {
  const rows = [["Function", "File", "CC", "Cog", "Cog incl", "Cov%", "CRAP", "OUCH"], ...entries.map(entry => [
    entry.name, `${entry.file}:${entry.line}`, String(entry.complexity), String(entry.cognitive), String(entry.inclusiveCognitive),
    entry.coverage === null ? "N/A" : entry.coverage.toFixed(1) + "%",
    entry.crap === null ? "N/A" : entry.crap.toFixed(1),
    entry.ouch === null ? "N/A" : entry.ouch.toFixed(1),
  ])];
  return formatTable("OUCH Report", rows);
}

type Metric = Awaited<ReturnType<typeof analyzeProject>>["entries"][number];

function formatComparison(entries: Awaited<ReturnType<typeof compareProject>>["entries"]) {
  const rows = [["Function", "File", "CC base/head", "Cog base/head", "Cog incl base/head", "Cov% base/head",
    "CRAP base", "CRAP head", "CRAP delta", "OUCH base", "OUCH head", "Delta", "Status"],
    ...entries.map(entry => [entry.name, entry.file,
      formatPair(entry.base?.complexity, entry.head?.complexity), formatPair(entry.base?.cognitive, entry.head?.cognitive),
      formatPair(entry.base?.inclusiveCognitive, entry.head?.inclusiveCognitive),
      `${sideScore(entry.base, "coverage")} / ${sideScore(entry.head, "coverage")}`,
      sideScore(entry.base, "crap"), sideScore(entry.head, "crap"), formatDelta(entry.delta.crap),
      sideScore(entry.base, "ouch"), sideScore(entry.head, "ouch"), formatDelta(entry.delta.ouch), entry.status,
    ])];
  return formatTable("OUCH Comparison", rows) + (entries.length === 0 ? "\nNo matching function metric changes." : "");
}

function formatFileComparison(entries: Awaited<ReturnType<typeof compareProject>>["files"]) {
  const rows = [["File", "CC base/head", "CC delta", "Cog base/head", "Cog delta", "Functions base/head", "Status"],
    ...entries.map(entry => [entry.file,
      formatPair(entry.base?.complexity, entry.head?.complexity), formatDelta(entry.delta.complexity),
      formatPair(entry.base?.cognitive, entry.head?.cognitive), formatDelta(entry.delta.cognitive),
      formatPair(entry.base?.functions, entry.head?.functions), entry.status,
    ])];
  return formatTable("File complexity comparison", rows, 1);
}

function formatPair(base: number | undefined, head: number | undefined) {
  return `${base ?? "-"} / ${head ?? "-"}`;
}

function sideScore(entry: Metric | null, field: "coverage" | "crap" | "ouch") {
  if (entry === null) return "-";
  const value = entry[field];
  return value === null ? "N/A" : value.toFixed(1);
}

function formatDelta(value: number | null) {
  if (value === null) return "-";
  return (value > 0 ? "+" : "") + value.toFixed(1);
}

function formatTable(title: string, rows: string[][], leftColumns = 2) {
  const widths = rows[0]!.map((_, column) => {
    const lengths = rows.map(row => row[column]!.length);
    return Math.max(...lengths);
  });
  const formatted = rows.map(row => {
    const columns = row.map((value, column) =>
      column < leftColumns ? value.padEnd(widths[column]!) : value.padStart(widths[column]!)
    );
    return columns.join("  ").trimEnd();
  });
  return [title, "=".repeat(title.length), ...formatted].join("\n");
}

type CliValues = ReturnType<typeof parseOptions>["values"];

function validateReportMode(values: CliValues) {
  validateNonEmptyOptions(values);
  if (values.compare === undefined) {
    if (values.refresh) throw new Error("--refresh requires --compare");
    return;
  }
  if (values.since !== undefined || values["use-existing-coverage"]) {
    throw new Error("--compare cannot combine with --since or --use-existing-coverage");
  }
}

function validateNonEmptyOptions(values: CliValues) {
  if (values.exclude?.some(pattern => pattern.trim() === "")) throw new Error("--exclude must not be empty");
  for (const option of ["coverage-command", "setup-command"] as const) {
    if (values[option]?.trim() === "") throw new Error(`--${option} must not be empty`);
  }
}

function projectOptions(values: CliValues, cwd: string) {
  return {
    cwd, sourceRoots: values["source-root"] ?? ["src"], exclude: values.exclude ?? [], lcov: values.lcov,
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
