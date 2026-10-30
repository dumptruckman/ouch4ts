import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { isManifestObject, readManifest, readOptionalFile } from "./manifest.js";

export async function defaultCoverageCommand(cwd: string) {
  const manifest = await readManifest(cwd);
  if (!coverageScript(manifest.scripts)) {
    throw new Error('No "test:coverage" script in package.json. Pass --coverage-command \'<command>\' '
      + "to generate LCOV, or --use-existing-coverage to read an existing report.");
  }
  const manager = await detectPackageManager(cwd, "--coverage-command");
  return `${manager.name} run test:coverage`;
}

function coverageScript(scripts: unknown) {
  if (!isManifestObject(scripts)) return;
  const command = scripts["test:coverage"];
  if (typeof command !== "string") return;
  return command.trim();
}

export async function defaultSetupCommand(cwd: string) {
  const manager = await detectPackageManager(cwd, "--setup-command");
  if (manager.name === "npm") return "npm ci --ignore-scripts";
  if (manager.name === "yarn") return yarnSetupCommand(manager);
  return `${manager.name} install --frozen-lockfile --ignore-scripts`;
}

async function yarnSetupCommand(manager: Awaited<ReturnType<typeof detectPackageManager>>) {
  const lockfile = await yarnLockfile(manager.directory);
  if (lockfile === null) throw new Error("Default Yarn setup requires yarn.lock. Pass --setup-command '<command>'.");
  return yarnInstallCommand(manager.major ?? yarnMajor(manager.directory, lockfile));
}

function yarnInstallCommand(major: number) {
  if (major === 2) return "yarn install --immutable --skip-builds";
  if (major >= 3) return "yarn install --immutable --mode=skip-build";
  return "yarn install --frozen-lockfile --ignore-scripts";
}

function yarnMajor(cwd: string, lockfile: string) {
  if (!/^__metadata:/m.test(lockfile)) return 1;
  return installedYarnMajor(cwd);
}

function installedYarnMajor(cwd: string) {
  const result = spawnSync("yarn", ["--version"], { cwd, encoding: "utf8" });
  const major = Number.parseInt(String(result.stdout), 10);
  if (!succeeded(result) || !isModernYarnMajor(major)) {
    throw new Error("Cannot determine modern Yarn's version with yarn --version. Pass --setup-command '<command>'.");
  }
  return major;
}

function succeeded(result: ReturnType<typeof spawnSync>) {
  return !result.error && result.status === 0;
}

function isModernYarnMajor(major: number) {
  return Number.isFinite(major) && major >= 2;
}

async function yarnLockfile(cwd: string): Promise<string | null> {
  const text = await readOptionalFile(resolve(cwd, "yarn.lock"));
  if (text !== null) return text;
  return parentYarnLockfile(cwd);
}

async function parentYarnLockfile(cwd: string): Promise<string | null> {
  if (await stopsYarnSearch(cwd)) return null;
  return yarnLockfile(dirname(cwd));
}

async function stopsYarnSearch(cwd: string) {
  if (dirname(cwd) === cwd) return true;
  return (await readdir(cwd)).includes(".git");
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
    return { ...declaredPackageManager(manifest.packageManager, flag), directory: cwd };
  }
  return detectUndeclaredManager(cwd, flag);
}

async function detectUndeclaredManager(cwd: string, flag: string): ReturnType<typeof detectPackageManager> {
  const files = new Set(await readdir(cwd));
  const manager = lockfileManager(files, flag);
  if (manager) return { name: manager.name, major: undefined, directory: cwd };
  if (isSearchRoot(cwd, files)) return { name: "npm", major: undefined, directory: cwd };
  return detectPackageManager(dirname(cwd), flag);
}

function isSearchRoot(cwd: string, files: ReadonlySet<string>) {
  return dirname(cwd) === cwd || files.has(".git");
}

function lockfileManager(files: ReadonlySet<string>, flag: string) {
  const matches = lockfiles.filter(manager => manager.files.some(file => files.has(file)));
  if (matches.length > 1) {
    throw new Error(`Multiple package-manager lockfiles found. Set packageManager in package.json or pass ${flag} '<command>'.`);
  }
  return matches[0];
}

function declaredPackageManager(value: unknown, flag: string) {
  const [name, version = ""] = packageManagerParts(value);
  const major = Number.parseInt(version, 10);
  const manager = lockfiles.find(manager => manager.name === name);
  if (!manager || !Number.isFinite(major)) {
    throw new Error(`Unsupported packageManager in package.json. Pass ${flag} '<command>'.`);
  }
  return { name: manager.name, major };
}

function packageManagerParts(value: unknown) {
  return typeof value === "string" ? value.split("@") : [];
}
