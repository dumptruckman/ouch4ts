import { mkdir, realpath, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { changedSourceFilter } from "./changes.js";
import { analyzeProject } from "./project.js";
import { compareProject } from "./comparison.js";
import { formatCoverage, formatDelta, formatPair, formatScore, formatTable } from "./format.js";

/** Report command errors and return the process exit code. */
export async function runCommandLine(args: string[], cwd: string) {
  try {
    await runCli(args, cwd);
    return 0;
  } catch (error) {
    console.error(`ouch4ts: ${errorMessage(error)}`);
    return 1;
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

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
Cog follows the Cognitive Complexity whitepaper and includes nested functions.
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
  const entries = report.entries.filter(entry => changes?.matchesFunction(entry) ?? true)
    .filter(entry => matchesPath(entry.file, positionals));
  const files = report.files.filter(entry => changes?.matchesFile(entry.file) ?? true)
    .filter(entry => matchesPath(entry.file, positionals));
  console.log(formatFiles(files) + "\n\n" + formatReport(entries));
  warnUnknownCoverage(report.entries);
}

function warnUnknownCoverage(entries: Metric[]) {
  const unknown = entries.filter(entry => entry.coverage === null).length;
  if (unknown) console.error(`Warning: ${unknown} functions have N/A coverage. Check LCOV source paths and source maps.`);
}

function formatFiles(files: Awaited<ReturnType<typeof analyzeProject>>["files"]) {
  const rows = [["File", "CC", "Cog", "Functions"], ...files.map(entry => [
    entry.file, String(entry.complexity), String(entry.cognitive), String(entry.functions),
  ])];
  return formatTable("File complexity", rows, 1);
}

function formatReport(entries: Awaited<ReturnType<typeof analyzeProject>>["entries"]) {
  const rows = [["Function", "File", "CC", "Cog", "Cov%", "CRAP", "OUCH"], ...entries.map(entry => [
    entry.name, `${entry.file}:${entry.line}`, String(entry.complexity), String(entry.cognitive),
    formatCoverage(entry.coverage), formatScore(entry.crap), formatScore(entry.ouch),
  ])];
  return formatTable("OUCH Report", rows);
}

type Metric = Awaited<ReturnType<typeof analyzeProject>>["entries"][number];

function formatComparison(entries: Awaited<ReturnType<typeof compareProject>>["entries"]) {
  const rows = [["Function", "File", "CC base/head", "Cog base/head", "Cov% base/head",
    "CRAP base", "CRAP head", "CRAP delta", "OUCH base", "OUCH head", "Delta", "Status"],
    ...entries.map(entry => [entry.name, entry.file,
      formatPair(entry.base?.complexity, entry.head?.complexity), formatPair(entry.base?.cognitive, entry.head?.cognitive),
      `${sideScore(entry.base, "coverage")} / ${sideScore(entry.head, "coverage")}`,
      sideScore(entry.base, "crap"), sideScore(entry.head, "crap"), formatDelta(entry.delta.crap),
      sideScore(entry.base, "ouch"), sideScore(entry.head, "ouch"), formatDelta(entry.delta.ouch), entry.status,
    ])];
  return formatTable("OUCH Comparison", rows) + (entries.length === 0 ? "\nNo matching function metric changes." : "");
}

function formatFileComparison(entries: Awaited<ReturnType<typeof compareProject>>["files"]) {
  const rows = [["File", "CC base/head", "CC delta", "Cog base/head", "Cog delta", "Functions base/head", "Status"],
    ...entries.map(entry => [entry.file,
      fileScorePair(entry, "complexity"), formatDelta(entry.delta.complexity),
      fileScorePair(entry, "cognitive"), formatDelta(entry.delta.cognitive),
      fileScorePair(entry, "functions"), entry.status,
    ])];
  return formatTable("File complexity comparison", rows, 1);
}

function fileScorePair(entry: Awaited<ReturnType<typeof compareProject>>["files"][number], field: "complexity" | "cognitive" | "functions") {
  return formatPair(entry.base?.[field], entry.head?.[field]);
}

function sideScore(entry: Metric | null, field: "coverage" | "crap" | "ouch") {
  if (entry === null) return "-";
  return formatScore(entry[field]);
}

type CliValues = ReturnType<typeof parseOptions>["values"];

function validateReportMode(values: CliValues) {
  validateNonEmptyOptions(values);
  if (values.compare === undefined) return validateCurrentReport(values);
  if (hasCurrentReportOptions(values)) {
    throw new Error("--compare cannot combine with --since or --use-existing-coverage");
  }
}

function validateCurrentReport(values: CliValues) {
  if (values.refresh) throw new Error("--refresh requires --compare");
}

function hasCurrentReportOptions(values: CliValues) {
  return values.since !== undefined || values["use-existing-coverage"] === true;
}

function validateNonEmptyOptions(values: CliValues) {
  for (const pattern of values.exclude ?? []) validateNonEmptyValue("exclude", pattern);
  for (const option of ["coverage-command", "setup-command"] as const) {
    validateNonEmptyValue(option, values[option]);
  }
}

function validateNonEmptyValue(option: string, value: string | undefined) {
  if (value?.trim() === "") throw new Error(`--${option} must not be empty`);
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
