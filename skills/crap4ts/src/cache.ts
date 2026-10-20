import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { analyzeProject } from "./project.js";
import { isMissingFile } from "./files.js";

type Metric = Awaited<ReturnType<typeof analyzeProject>>[number];

export async function readCache(path: string, commit: string, settingsKey: string) {
  let data: unknown;
  try {
    data = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError || isMissingFile(error)) return null;
    throw error;
  }
  return cachedEntries(data, commit, settingsKey);
}

function cachedEntries(data: unknown, commit: string, settingsKey: string) {
  if (!isRecord(data) || data.commit !== commit || data.settingsKey !== settingsKey) return null;
  if (!Array.isArray(data.entries) || !data.entries.every(isMetric)) return null;
  return data.entries;
}

export async function writeCache(path: string, commit: string, settingsKey: string, entries: Metric[]) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify({ commit, settingsKey, entries }, null, 2) + "\n");
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

function isMetric(value: unknown): value is Metric {
  return isRecord(value) && hasFunctionIdentity(value) && hasFunctionRange(value) &&
    isPositiveInteger(value.complexity) && hasRiskScores(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasFunctionIdentity(value: Record<string, unknown>) {
  return typeof value.name === "string" && typeof value.file === "string";
}

function hasFunctionRange(value: Record<string, unknown>) {
  return isPositiveInteger(value.line) && isPositiveInteger(value.endLine) && value.endLine >= value.line;
}

function isPositiveInteger(value: unknown): value is number {
  return isNumber(value) && Number.isInteger(value) && value >= 1;
}

function hasRiskScores(value: Record<string, unknown>) {
  if (value.coverage === null) return value.crap === null;
  return isCoverage(value.coverage) && isNumber(value.crap) && value.crap >= 1;
}

function isCoverage(value: unknown) {
  return isNumber(value) && value >= 0 && value <= 100;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
