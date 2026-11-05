import { resolve } from "node:path";
import { isManifestObject, readOptionalFile } from "./manifest.js";

/** Load only the selected project's config, with paths left relative to that project. */
export async function loadConfiguration(cwd: string, explicitPath: string | undefined, disabled: boolean) {
  const path = explicitPath ?? resolve(cwd, "ouch4ts.config.json");
  const text = disabled ? null : await readOptionalFile(path);
  if (!disabled && explicitPath !== undefined && text === null) throw new Error(`Config not found: ${path}`);
  return parseConfiguration(text, path);
}

function parseConfiguration(text: string | null, path: string) {
  let data: unknown;
  try {
    data = text === null ? {} : JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`Invalid JSON config ${path}: ${error.message}`);
    throw error;
  }
  if (!isManifestObject(data)) throw new Error(`Expected a config object in ${path}`);
  const keys = new Set(["sourceRoots", "exclude", "lcov", "coverageCommand", "setupCommand", "outputDir"]);
  for (const key of Object.keys(data)) {
    if (!keys.has(key)) throw new Error(`Unknown config property ${key} in ${path}`);
  }
  const sourceRoots = stringList(data.sourceRoots, `${path}: sourceRoots`);
  if (sourceRoots?.length === 0) throw new Error(`${path}: sourceRoots must not be empty`);
  return {
    sourceRoots, exclude: stringList(data.exclude, `${path}: exclude`),
    lcov: stringSetting(data.lcov, `${path}: lcov`),
    coverageCommand: stringSetting(data.coverageCommand, `${path}: coverageCommand`),
    setupCommand: stringSetting(data.setupCommand, `${path}: setupCommand`),
    outputDir: stringSetting(data.outputDir, `${path}: outputDir`),
  };
}

function stringSetting(value: unknown, label: string) {
  if (value === undefined) return undefined;
  return nonEmptyString(value, label);
}

function nonEmptyString(value: unknown, label: string) {
  if (typeof value !== "string" || value.trim() === "" || value.includes("\0")) {
    throw new Error(`${label} must be a non-empty string without NUL characters`);
  }
  return value;
}

function stringList(value: unknown, label: string) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${label} must be a list of strings`);
  return value.map((item: unknown) => nonEmptyString(item, label));
}
