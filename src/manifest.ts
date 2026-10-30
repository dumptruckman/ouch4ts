import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { missingFileOrThrow } from "./files.js";

export async function readManifest(cwd: string): Promise<Record<string, unknown>> {
  const text = await readOptionalFile(resolve(cwd, "package.json"));
  if (text === null) return {};
  const manifest: unknown = JSON.parse(text);
  if (!isManifestObject(manifest)) {
    throw new Error(`Expected an object in ${resolve(cwd, "package.json")}`);
  }
  return manifest;
}

export function isManifestObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readOptionalFile(path: string) {
  return readFile(path, "utf8").catch(missingFileOrThrow);
}
