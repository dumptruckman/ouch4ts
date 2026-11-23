import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { changedSourceFilter } from "./changes.js";
import { analyzeProject, warnUnknownCoverage } from "./project.js";
import { compareProject } from "./comparison.js";
import { loadConfiguration } from "./configuration.js";
import { readManifest } from "./manifest.js";
import { writeJson } from "./files.js";
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
    version: { type: "boolean" },
    format: { type: "string" },
    project: { type: "string" },
    config: { type: "string" },
    "no-config": { type: "boolean" },
    "output-dir": { type: "string" },
    "use-existing-coverage": { type: "boolean" },
    "source-root": { type: "string", multiple: true },
    exclude: { type: "string", multiple: true },
    lcov: { type: "string" },
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

  --project <directory>     Project to analyze. Default: launching directory
  --config <file>           JSON config, relative to launching directory
  --no-config               Ignore project-local ouch4ts.config.json
  --source-root <path>       Source directory, repeatable. Default: src
  --exclude <glob>           Exclude project-relative paths, repeatable. Quote globs.
  --lcov <path>              LCOV report. Default: coverage/lcov.info
  --coverage-command <cmd>   Shell command. Default: <package-manager> run test:coverage
  --use-existing-coverage    Read coverage without running tests or checking freshness
  --since <ref>             Show functions changed since the merge base with ref
  --compare <ref>           Compare merge-base and HEAD scores in temporary checkouts
  --setup-command <cmd>      Comparison setup. Default: detected manager's frozen install
  --refresh                 Regenerate both comparison reports instead of using cache
  --format <table|json>      Stdout format. Default: table
  --output-dir <directory>  Report and comparison cache storage. Default: .metrics
  --version                 Show the package version
  -h, --help                Show this help

Paths and commands use the selected project. Config overrides defaults; flags override config.
Repeated flags replace configured lists. Case-sensitive path fragments filter stdout with OR matching.
File rows sort by cognitive complexity or its delta; function rows sort by OUCH or its delta.
Complete reports write ouch.json or ouch-comparison.json in the output directory.
Fresh coverage runs a shell command; comparisons also install dependencies in temporary checkouts.
Diagnostics and command output use stderr. Failures exit 1; unknown coverage stays null/N/A.

CLI reference: ${fileURLToPath(new URL("../docs/cli.md", import.meta.url))}`);
    return;
  }
  const analyzerVersion = await readAnalyzerVersion();
  if (values.version) {
    console.log(analyzerVersion);
    return;
  }
  validateReportMode(values);
  const format = reportFormat(values.format);
  const configPath = values.config === undefined ? undefined : resolve(cwd, values.config);
  cwd = await realpath(resolve(cwd, values.project ?? "."));
  const config = await loadConfiguration(cwd, configPath, values["no-config"] ?? false);
  const options = projectOptions(values, cwd, config);
  if (values.compare !== undefined) {
    const comparison = await compareProject(values.compare, {
      ...options, refresh: values.refresh ?? false,
    });
    const report = { analyzerVersion, ...comparison };
    await writeReport(options.outputDir, "ouch-comparison.json", report);
    const files = report.files.filter(entry => matchesPath(entry.file, positionals));
    const entries = report.entries.filter(entry => matchesPath(entry.file, positionals));
    console.log(format === "json" ? JSON.stringify({ ...report, entries, files })
      : formatFileComparison(files) + "\n\n" + formatComparison(entries));
    return;
  }
  await reportCurrent(options, values.since, positionals, format, analyzerVersion);
}

function reportFormat(value: string | undefined) {
  if (value === undefined || value === "table") return "table";
  if (value === "json") return "json";
  throw new Error("--format must be table or json");
}

async function readAnalyzerVersion() {
  const manifest = await readManifest(fileURLToPath(new URL("../", import.meta.url)));
  if (typeof manifest.version !== "string") throw new Error("Package version is missing");
  return manifest.version;
}

async function reportCurrent(options: ReturnType<typeof projectOptions>, since: string | undefined,
  positionals: string[], format: ReturnType<typeof reportFormat>, analyzerVersion: string) {
  const changes = since === undefined ? undefined : changedSourceFilter(since, options.cwd);
  const metrics = await analyzeProject(options);
  const report = { analyzerVersion, ...metrics };
  await writeReport(options.outputDir, "ouch.json", report);
  const entries = report.entries.filter(entry => changes?.matchesFunction(entry) ?? true)
    .filter(entry => matchesPath(entry.file, positionals));
  const files = report.files.filter(entry => changes?.matchesFile(entry.file) ?? true)
    .filter(entry => matchesPath(entry.file, positionals));
  console.log(format === "json" ? JSON.stringify({ ...report, entries, files })
    : formatFiles(files) + "\n\n" + formatReport(entries));
  warnUnknownCoverage(report.entries);
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
  if (values.config !== undefined && values["no-config"]) {
    throw new Error("--config cannot combine with --no-config");
  }
  if (values["coverage-command"] !== undefined && values["use-existing-coverage"]) {
    throw new Error("--coverage-command cannot combine with --use-existing-coverage");
  }
  if (values.compare === undefined) return validateCurrentReport(values);
  if (hasCurrentReportOptions(values)) {
    throw new Error("--compare cannot combine with --since or --use-existing-coverage");
  }
}

function validateCurrentReport(values: CliValues) {
  if (values.refresh) throw new Error("--refresh requires --compare");
  if (values["setup-command"] !== undefined) throw new Error("--setup-command requires --compare");
}

function hasCurrentReportOptions(values: CliValues) {
  return values.since !== undefined || values["use-existing-coverage"] === true;
}

function validateNonEmptyOptions(values: CliValues) {
  for (const pattern of values.exclude ?? []) validateNonEmptyValue("exclude", pattern);
  for (const root of values["source-root"] ?? []) validateNonEmptyValue("source-root", root);
  for (const option of ["project", "config", "output-dir", "lcov", "since", "compare", "coverage-command", "setup-command"] as const) {
    validateNonEmptyValue(option, values[option]);
  }
}

function validateNonEmptyValue(option: string, value: string | undefined) {
  if (value?.trim() === "") throw new Error(`--${option} must not be empty`);
  if (value?.includes("\0")) throw new Error(`--${option} must not contain NUL characters`);
}

function projectOptions(values: CliValues, cwd: string, config: Awaited<ReturnType<typeof loadConfiguration>>) {
  return {
    cwd, sourceRoots: values["source-root"] ?? config.sourceRoots ?? ["src"],
    exclude: values.exclude ?? config.exclude ?? [], lcov: values.lcov ?? config.lcov ?? "coverage/lcov.info",
    coverageCommand: values["coverage-command"] ?? config.coverageCommand,
    setupCommand: values["setup-command"] ?? config.setupCommand,
    outputDir: resolve(cwd, values["output-dir"] ?? config.outputDir ?? ".metrics"),
    useExistingCoverage: values["use-existing-coverage"] ?? false,
  };
}

function matchesPath(file: string, filters: string[]) {
  if (filters.length === 0) return true;
  return filters.some(filter => file.includes(filter));
}

async function writeReport(outputDir: string, filename: string, report: unknown) {
  await writeJson(resolve(outputDir, filename), report);
}
