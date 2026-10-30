import type { analyzeReport } from "./index.js";

type Report = ReturnType<typeof analyzeReport>;
type Metric = Report["entries"][number];

export function validatedReport(data: Record<string, unknown>) {
  if (!isMetricArray(data.entries)) return null;
  if (!isFileMetricArray(data.files)) return null;
  return { entries: data.entries, files: data.files };
}

function isMetricArray(value: unknown): value is Metric[] {
  return Array.isArray(value) && value.every(isMetric);
}

function isFileMetricArray(value: unknown): value is Report["files"] {
  return Array.isArray(value) && value.every(isFileMetric);
}

function isMetric(value: unknown): value is Metric {
  if (!isRecord(value)) return false;
  return [hasFunctionIdentity, hasFunctionRange, hasComplexities, hasCoverageAndScores].every(validate => validate(value));
}

function hasComplexities(value: Record<string, unknown>) {
  return isIntegerAtLeast(value.complexity, 1) && isIntegerAtLeast(value.cognitive, 0);
}

function isFileMetric(value: unknown): value is Report["files"][number] {
  return isRecord(value) && typeof value.file === "string" && isIntegerAtLeast(value.complexity, 0)
    && isIntegerAtLeast(value.cognitive, 0) && isIntegerAtLeast(value.functions, 0);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
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
  if (value.coverage === null) return hasUnknownScores(value);
  return hasMeasuredScores(value);
}

function hasUnknownScores(value: Record<string, unknown>) {
  return value.crap === null && value.ouch === null;
}

function hasMeasuredScores(value: Record<string, unknown>) {
  return isCoverage(value.coverage) && isScore(value.crap) && isScore(value.ouch);
}

function isScore(value: unknown) {
  return isNumber(value) && value >= 1;
}

function isCoverage(value: unknown) {
  return isNumber(value) && value >= 0 && value <= 100;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
