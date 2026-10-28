import { resolve } from "node:path";

export function readLcov(text: string, root: string) {
  const files = new Map<string, Map<number, number>>();
  let lines: Map<number, number> | undefined;
  for (const record of text.split(/\r?\n/)) {
    lines = readCoverageRecord(record, root, files, lines);
  }
  validateLcovComplete(files, lines);
  return files;
}

function readCoverageRecord(record: string, root: string, files: Map<string, Map<number, number>>,
  lines: Map<number, number> | undefined) {
  if (record === "end_of_record") return undefined;
  switch (record.slice(0, 3)) {
    case "SF:": return sourceCoverage(record, root, files, lines);
    case "DA:": recordLineCoverage(record, lines);
  }
  return lines;
}

function sourceCoverage(record: string, root: string, files: Map<string, Map<number, number>>,
  current: Map<number, number> | undefined) {
  if (current || record.length === 3) throw new Error("Invalid LCOV source record");
  const path = resolve(root, record.slice(3));
  const lines = files.get(path) ?? new Map<number, number>();
  files.set(path, lines);
  return lines;
}

function recordLineCoverage(record: string, lines: Map<number, number> | undefined) {
  if (!lines) throw new Error(`Invalid LCOV line record: ${record}`);
  const { line, hits } = parseLineCoverage(record);
  lines.set(line, (lines.get(line) ?? 0) + hits);
}

function parseLineCoverage(record: string) {
  const [line, hits] = record.slice(3).split(",").map(Number);
  if (!isSafeCount(line, 1) || !isSafeCount(hits, 0) || !/^\d+,\d+(?:,.*)?$/.test(record.slice(3))) {
    throw new Error(`Invalid LCOV line record: ${record}`);
  }
  return { line, hits };
}

function isSafeCount(value: number | undefined, minimum: number): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value >= minimum;
}

function validateLcovComplete(files: Map<string, Map<number, number>>, current: Map<number, number> | undefined) {
  if (current) throw new Error("Incomplete LCOV report: missing end_of_record");
  if (files.size === 0) throw new Error("LCOV report contains no source records");
}
