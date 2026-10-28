import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { analyzeProject } from "./project.js";
import { isMissingFile } from "./files.js";
import { isRecord, validatedReport } from "./report.js";

type Report = Awaited<ReturnType<typeof analyzeProject>>;

export async function readCache(path: string, commit: string, settingsKey: string) {
  let data: unknown;
  try {
    data = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (isCacheMiss(error)) return null;
    throw error;
  }
  return cachedReport(data, commit, settingsKey);
}

function isCacheMiss(error: unknown) {
  return error instanceof SyntaxError || isMissingFile(error);
}

function cachedReport(data: unknown, commit: string, settingsKey: string) {
  if (!isMatchingReport(data, commit, settingsKey)) return null;
  return validatedReport(data);
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
