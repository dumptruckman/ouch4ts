import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { readCache, writeCache } from "../src/cache.js";

const directories: string[] = [];
const metric = {
  name: "price", file: "src/orders.ts", line: 1, endLine: 4,
  complexity: 2, cognitive: 1, inclusiveCognitive: 1, coverage: 50, crap: 2.5, ouch: 3.5,
};
const fileMetric = { file: "src/orders.ts", complexity: 2, cognitive: 1, functions: 1 };

afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

async function cachePath() {
  const directory = await mkdtemp(join(tmpdir(), "ouch4ts-cache-test-"));
  directories.push(directory);
  return join(directory, "report.json");
}

test("caches file metrics together with inclusive function scores", async () => {
  const path = await cachePath();
  const report = { entries: [metric], files: [fileMetric] };
  await writeCache(path, "commit", "settings", report);
  expect(await readCache(path, "commit", "settings")).toEqual(report);
});

test.each([
  { name: "known coverage", entry: metric },
  { name: "zero cognitive complexity", entry: { ...metric, cognitive: 0, ouch: 2.5 } },
  { name: "unknown coverage", entry: { ...metric, coverage: null, crap: null, ouch: null } },
])("round-trips a commit report with $name", async ({ entry }) => {
  const path = await cachePath();
  const report = { entries: [entry], files: [fileMetric] };
  await writeCache(path, "commit", "settings", report);
  expect(await readCache(path, "commit", "settings")).toEqual(report);
  expect(await readCache(path, "other-commit", "settings")).toBeNull();
  expect(await readCache(path, "commit", "other-settings")).toBeNull();
});

test.each([
  { name: "null report", report: null },
  { name: "missing entries", report: { commit: "commit", settingsKey: "settings" } },
  { name: "non-array entries", report: { commit: "commit", settingsKey: "settings", entries: {} } },
  { name: "legacy report without file metrics", report: { commit: "commit", settingsKey: "settings", entries: [metric] } },
  ...[
    { name: "missing file metrics", files: undefined },
    { name: "null file metric", files: [null] },
    { name: "negative file complexity", files: [{ ...fileMetric, complexity: -1 }] },
    { name: "fractional file cognitive complexity", files: [{ ...fileMetric, cognitive: 0.5 }] },
    { name: "missing function count", files: [{ ...fileMetric, functions: undefined }] },
  ].map(({ name, files }) => ({ name, report: { commit: "commit", settingsKey: "settings", entries: [metric], files } })),
  ...[
    { name: "null metric", entry: null },
    { name: "missing identity", entry: { ...metric, name: undefined } },
    { name: "fractional line", entry: { ...metric, line: 1.5 } },
    { name: "reversed range", entry: { ...metric, endLine: 0 } },
    { name: "zero complexity", entry: { ...metric, complexity: 0 } },
    { name: "missing cognitive complexity", entry: { ...metric, cognitive: undefined } },
    { name: "negative cognitive complexity", entry: { ...metric, cognitive: -1 } },
    { name: "fractional cognitive complexity", entry: { ...metric, cognitive: 0.5 } },
    { name: "missing inclusive cognitive complexity", entry: { ...metric, inclusiveCognitive: undefined } },
    { name: "inclusive complexity below own complexity", entry: { ...metric, inclusiveCognitive: 0 } },
    { name: "out-of-range coverage", entry: { ...metric, coverage: 101 } },
    { name: "missing CRAP score", entry: { ...metric, crap: undefined } },
    { name: "null CRAP score with known coverage", entry: { ...metric, crap: null } },
    { name: "zero CRAP score", entry: { ...metric, crap: 0 } },
    { name: "numeric CRAP score with unknown coverage", entry: { ...metric, coverage: null, ouch: null } },
    { name: "missing score", entry: { ...metric, ouch: undefined } },
    { name: "numeric score with unknown coverage", entry: { ...metric, coverage: null } },
  ].map(({ name, entry }) => ({ name, report: { commit: "commit", settingsKey: "settings", entries: [entry], files: [fileMetric] } })),
])("rejects a cached report with $name", async ({ report }) => {
  const path = await cachePath();
  await writeFile(path, JSON.stringify(report));
  expect(await readCache(path, "commit", "settings")).toBeNull();
});

test("treats absent and truncated cache files as misses", async () => {
  const path = await cachePath();
  expect(await readCache(path, "commit", "settings")).toBeNull();
  await writeFile(path, '{"commit":');
  expect(await readCache(path, "commit", "settings")).toBeNull();
});

test("propagates filesystem failures rather than treating them as cache misses", async () => {
  const path = await cachePath();
  await writeFile(path, "blocks a directory");
  await expect(readCache(join(path, "report.json"), "commit", "settings")).rejects.toMatchObject({ code: "ENOTDIR" });
});
