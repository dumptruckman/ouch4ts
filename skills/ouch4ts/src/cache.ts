import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { analyzeProject } from "./project.js";
import { isMissingFile } from "./files.js";

type Report = Awaited<ReturnType<typeof analyzeProject>>;
type Metric = Report["entries"][number];

export async function readCache(path: string, commit: string, settingsKey: string) {
  let data: unknown;
  try {
    data = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError || isMissingFile(error)) return null;
    throw error;
  }
  return cachedReport(data, commit, settingsKey);
}

function cachedReport(data: unknown, commit: string, settingsKey: string) {
  if (!isMatchingReport(data, commit, settingsKey)) return null;
  if (!Array.isArray(data.entries) || !data.entries.every(isMetric)) return null;
  if (!Array.isArray(data.files) || !data.files.every(isFileMetric)) return null;
  return { entries: data.entries, files: data.files };
}

function isMatchingReport(data: unknown, commit: string, settingsKey: string): data is Record<string, unknown> {
  return isRecord(data) && data.commit === commit && data.settingsKey === settingsKey;
}

export async function writeCache(path: string, commit: string, settingsKey: string, report: Report) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify({ commit, settingsKey, ...report }, null, 2) + "\n");
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

function isMetric(value: unknown): value is Metric {
  if (!isRecord(value)) return false;
  return hasFunctionIdentity(value) && hasFunctionRange(value) && hasComplexities(value) && hasCoverageAndScores(value);
}

function hasComplexities(value: Record<string, unknown>) {
  return isIntegerAtLeast(value.complexity, 1) && isIntegerAtLeast(value.cognitive, 0);
}

function isFileMetric(value: unknown): value is Report["files"][number] {
  return isRecord(value) && typeof value.file === "string" && isIntegerAtLeast(value.complexity, 0)
    && isIntegerAtLeast(value.cognitive, 0) && isIntegerAtLeast(value.functions, 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasFunctionIdentity(value: Record<string, unknown>) {
  return typeof value.name === "string" && typeof value.file === "string";
}

function hasFunctionRange(value: Record<string, unknown>) {
  return isIntegerAtLeast(value.line, 1) && isIntegerAtLeast(value.endLine, 1) && value.endLine >= value.line;
}

function isIntegerAtLeast(value: unknown, minimum: number): value is number {
  return isNumber(value) && Number.isInteger(value) && value >= minimum;
}

function hasCoverageAndScores(value: Record<string, unknown>) {
  if (value.coverage === null) return value.crap === null && value.ouch === null;
  return isCoverage(value.coverage) && isNumber(value.crap) && value.crap >= 1 &&
    isNumber(value.ouch) && value.ouch >= 1;
}

function isCoverage(value: unknown) {
  return isNumber(value) && value >= 0 && value <= 100;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
