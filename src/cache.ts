import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { analyzeProject } from "./project.js";

type Metric = Awaited<ReturnType<typeof analyzeProject>>[number];

export async function readCache(path: string, commit: string, settingsKey: string) {
  let data: unknown;
  try {
    data = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError ||
      (error instanceof Error && "code" in error && error.code === "ENOENT")) return null;
    throw error;
  }
  if (typeof data !== "object" || data === null || !("commit" in data) || data.commit !== commit ||
    !("settingsKey" in data) || data.settingsKey !== settingsKey || !("entries" in data) ||
    !Array.isArray(data.entries) || !data.entries.every(isMetric)) return null;
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
  if (typeof value !== "object" || value === null) return false;
  return "name" in value && typeof value.name === "string" && "file" in value && typeof value.file === "string" &&
    "line" in value && isNumber(value.line) && Number.isInteger(value.line) && value.line >= 1 &&
    "endLine" in value && isNumber(value.endLine) && Number.isInteger(value.endLine) && value.endLine >= value.line &&
    "complexity" in value && isNumber(value.complexity) && Number.isInteger(value.complexity) && value.complexity >= 1 &&
    "coverage" in value && "crap" in value && (value.coverage === null ? value.crap === null :
      isNumber(value.coverage) && value.coverage >= 0 && value.coverage <= 100 && isNumber(value.crap) && value.crap >= 1);
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
