import { spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { isMissingFile } from "./files.js";

export async function defaultCoverageCommand(cwd: string) {
  const manifest = await readManifest(cwd);
  const scripts = manifest.scripts;
  if (typeof scripts !== "object" || scripts === null || !("test:coverage" in scripts)
    || typeof scripts["test:coverage"] !== "string" || !scripts["test:coverage"].trim()) {
    throw new Error('No "test:coverage" script in package.json. Pass --coverage-command \'<command>\' '
      + "to generate LCOV, or --use-existing-coverage to read an existing report.");
  }
  const manager = await detectPackageManager(cwd, "--coverage-command");
  return `${manager.name} run test:coverage`;
}

export async function defaultSetupCommand(cwd: string) {
  const manager = await detectPackageManager(cwd, "--setup-command");
  if (manager.name === "npm") return "npm ci --ignore-scripts";
  if (manager.name === "yarn") {
    const lockfile = await yarnLockfile(manager.directory);
    if (lockfile === null) throw new Error("Default Yarn setup requires yarn.lock. Pass --setup-command '<command>'.");
    const major = manager.major ?? yarnMajor(manager.directory, lockfile);
    if (major === 2) return "yarn install --immutable --skip-builds";
    if (major >= 3) return "yarn install --immutable --mode=skip-build";
  }
  return `${manager.name} install --frozen-lockfile --ignore-scripts`;
}

function yarnMajor(cwd: string, lockfile: string) {
  if (!/^__metadata:/m.test(lockfile)) return 1;
  const result = spawnSync("yarn", ["--version"], { cwd, encoding: "utf8" });
  const major = Number.parseInt(result.stdout?.trim() ?? "", 10);
  if (result.error || result.status !== 0 || !Number.isFinite(major) || major < 2) {
    throw new Error("Cannot determine modern Yarn's version with yarn --version. Pass --setup-command '<command>'.");
  }
  return major;
}

async function yarnLockfile(cwd: string): Promise<string | null> {
  const text = await readOptionalFile(resolve(cwd, "yarn.lock"));
  if (text !== null) return text;
  if (dirname(cwd) === cwd || (await readdir(cwd)).includes(".git")) return null;
  return yarnLockfile(dirname(cwd));
}

const lockfiles = [
  { name: "npm", files: ["package-lock.json", "npm-shrinkwrap.json"] },
  { name: "yarn", files: ["yarn.lock"] },
  { name: "pnpm", files: ["pnpm-lock.yaml"] },
  { name: "bun", files: ["bun.lock", "bun.lockb"] },
] as const;

async function detectPackageManager(cwd: string, flag: string): Promise<{
  name: (typeof lockfiles)[number]["name"];
  major: number | undefined;
  directory: string;
}> {
  const manifest = await readManifest(cwd);
  if (manifest.packageManager !== undefined) {
    const value = manifest.packageManager;
    const [name, version] = typeof value === "string" ? value.split("@") : [];
    const major = Number.parseInt(version ?? "", 10);
    const manager = lockfiles.find(manager => manager.name === name);
    if (!manager || !Number.isFinite(major)) {
      throw new Error(`Unsupported packageManager in package.json. Pass ${flag} '<command>'.`);
    }
    return { name: manager.name, major, directory: cwd };
  }
  const files = new Set(await readdir(cwd));
  const matches = lockfiles.filter(manager => manager.files.some(file => files.has(file)));
  if (matches.length > 1) {
    throw new Error(`Multiple package-manager lockfiles found. Set packageManager in package.json or pass ${flag} '<command>'.`);
  }
  const manager = matches[0];
  if (manager) return { name: manager.name, major: undefined, directory: cwd };
  if (files.has(".git") || dirname(cwd) === cwd) return { name: "npm", major: undefined, directory: cwd };
  return detectPackageManager(dirname(cwd), flag);
}

async function readManifest(cwd: string): Promise<Record<string, unknown>> {
  const text = await readOptionalFile(resolve(cwd, "package.json"));
  if (text === null) return {};
  const manifest: unknown = JSON.parse(text);
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
    throw new Error(`Expected an object in ${resolve(cwd, "package.json")}`);
  }
  return manifest as Record<string, unknown>;
}

async function readOptionalFile(path: string) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}
