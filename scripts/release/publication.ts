import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import semver from "semver";
import { z } from "zod";
import { shaSchema } from "./plan.ts";

export const publicationSchema = z.object({
  schema: z.literal(1), source: shaSchema, version: z.string().refine((version) => semver.valid(version) === version),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), integrity: z.string().regex(/^sha512-[A-Za-z0-9+/]+=*$/),
  channel: z.string(), runId: z.string().regex(/^\d+$/),
});
export type Publication = z.infer<typeof publicationSchema>;

export function checksums(bytes: Buffer) {
  return { sha256: createHash("sha256").update(bytes).digest("hex"), integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}` };
}

type RegistryArtifact = Pick<Publication, "version" | "source" | "integrity"> & { registry: string; repository: string };
class RegistryNotReady extends Error {}

async function readRegistry(url: string, signal: AbortSignal | null) {
  let response;
  let bytes;
  try {
    response = await fetch(url, { signal });
    bytes = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    throw new RegistryNotReady("Cannot reach npm for verification", { cause: error });
  }
  if (response.status === 408 || response.status === 429 || response.status >= 500) {
    throw new RegistryNotReady(`npm registry verification failed: ${response.status}`);
  }
  return { status: response.status, ok: response.ok, bytes };
}

export async function readMatchingManifest(input: RegistryArtifact, signal: AbortSignal | null = null) {
  const response = await readRegistry(`${input.registry}/ouch4ts/${input.version}`, signal);
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`npm registry verification failed: ${response.status}`);
  const manifest = z.object({ version: z.string(), dist: z.object({ integrity: z.string(), tarball: z.string().url().optional(), attestations: z.object({ url: z.string().url() }).optional() }) }).parse(JSON.parse(response.bytes.toString()));
  if (manifest.version !== input.version || manifest.dist.integrity !== input.integrity) throw new Error(`npm ${input.version} already has different contents`);
  return manifest;
}

async function verifyOnce(input: RegistryArtifact, signal: AbortSignal | null): Promise<boolean> {
  const manifest = await readMatchingManifest(input, signal);
  if (!manifest) return false;
  if (!manifest.dist.attestations) throw new RegistryNotReady("npm provenance is not available yet");
  const attestationResponse = await readRegistry(manifest.dist.attestations.url, signal);
  if (attestationResponse.status === 404) throw new RegistryNotReady("npm provenance is not available yet");
  if (!attestationResponse.ok) throw new Error(`Cannot read npm provenance: ${attestationResponse.status}`);
  const attestations = z.object({ attestations: z.array(z.object({ predicateType: z.string(), bundle: z.unknown() })) }).parse(JSON.parse(attestationResponse.bytes.toString()));
  const attestation = attestations.attestations.find((entry) => entry.predicateType === "https://slsa.dev/provenance/v1");
  if (!attestation) throw new RegistryNotReady("npm SLSA provenance is missing");
  const serialized = z.object({ dsseEnvelope: z.object({ payload: z.string() }) }).parse(attestation.bundle);
  const payload = z.object({
    subject: z.array(z.object({ digest: z.object({ sha512: z.string() }) })),
    predicate: z.object({ buildDefinition: z.object({
      externalParameters: z.object({ workflow: z.object({ repository: z.string(), path: z.string(), ref: z.string() }) }),
      resolvedDependencies: z.array(z.object({ uri: z.string(), digest: z.object({ gitCommit: z.string() }) })),
    }) }),
  }).parse(JSON.parse(Buffer.from(serialized.dsseEnvelope.payload, "base64").toString()));
  const definition = payload.predicate.buildDefinition;
  const workflow = definition.externalParameters.workflow;
  const repositoryUrl = `https://github.com/${input.repository}`;
  const expectedDigest = Buffer.from(input.integrity.replace(/^sha512-/, ""), "base64").toString("hex");
  const hasExpectedWorkflow = workflow.repository === repositoryUrl && workflow.path === ".github/workflows/release.yml";
  const hasExpectedSource = definition.resolvedDependencies.some((entry) => entry.uri.startsWith(`git+${repositoryUrl}@`) && entry.digest.gitCommit === input.source);
  const hasExpectedArtifact = payload.subject.length === 1 && payload.subject[0]?.digest.sha512 === expectedDigest;
  if (!hasExpectedWorkflow || !hasExpectedSource || !hasExpectedArtifact) throw new Error("npm provenance source, workflow, or artifact differs from the release plan");
  // npm validates attestations on publication. Bind the registry's statement to our retained source and bytes.
  if (!manifest.dist.tarball) throw new RegistryNotReady("npm tarball URL is missing");
  const tarball = await readRegistry(manifest.dist.tarball, signal);
  if (tarball.status === 404) throw new RegistryNotReady("npm tarball is not available yet");
  if (!tarball.ok) throw new Error(`Cannot read npm tarball: ${tarball.status}`);
  if (checksums(tarball.bytes).integrity !== input.integrity) throw new Error("npm tarball bytes differ from the retained artifact");
  return true;
}

export async function verifyRegistryArtifact(input: RegistryArtifact, wait?: { timeoutMs: number; intervalMs: number }): Promise<boolean> {
  if (!wait) return verifyOnce(input, null);

  const deadline = Date.now() + wait.timeoutMs;
  const signal = AbortSignal.timeout(wait.timeoutMs);
  while (Date.now() < deadline && !signal.aborted) {
    let reason = "version is not visible yet";
    try {
      if (await verifyOnce(input, signal)) return true;
    } catch (error) {
      if (signal.aborted) break;
      if (!(error instanceof RegistryNotReady)) throw error;
      reason = error.message;
    }
    const remaining = Math.max(0, deadline - Date.now());
    console.error(`Waiting for npm to verify ouch4ts@${input.version} (${Math.ceil(remaining / 1000)}s remaining): ${reason}`);
    await delay(Math.min(remaining, wait.intervalMs));
  }
  return false;
}

function verifyPackageContents(entries: string[]) {
  const required = [
    "package/package.json", "package/LICENSE", "package/README.md",
    "package/dist/cli.js", "package/dist/index.js", "package/dist/index.d.ts",
    "package/docs/analyze-project.md", "package/docs/cli.md", "package/docs/comparison.md",
    "package/docs/coverage.md", "package/docs/library.md", "package/docs/measurement.md",
  ];
  const allowed = new Set([...required, "package/CHANGELOG.md"]);
  for (const entry of entries) {
    if (!allowed.has(entry) && !/^package\/dist\/[\w/-]+\.(js|d\.ts)$/.test(entry)) {
      throw new Error(`Packed artifact contains files outside the MIT distribution: ${entry}`);
    }
  }
  for (const file of required) {
    if (!entries.includes(file)) throw new Error(`Packed artifact is missing ${file}`);
  }
}

export function packArtifact(version: string): Buffer {
  const temp = mkdtempSync(path.join(tmpdir(), "ouch-artifact-"));
  try {
    const pkg = z.object({ version: z.string() }).parse(JSON.parse(readFileSync("package.json", "utf8")));
    if (pkg.version !== version) execFileSync("npm", ["version", version, "--no-git-tag-version", "--ignore-scripts"], { stdio: "inherit" });
    execFileSync("npm", ["run", "build"], { stdio: "inherit" });
    execFileSync("npm", ["pack", "--ignore-scripts", "--pack-destination", temp], { stdio: "pipe" });
    const archives = readdirSync(temp).filter((file) => file.endsWith(".tgz"));
    const [filename] = archives;
    if (archives.length !== 1 || !filename) throw new Error("npm pack must produce exactly one artifact");
    const archive = path.join(temp, filename);
    const entries = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).trim().split("\n");
    verifyPackageContents(entries);
    execFileSync("npm", ["install", "--prefix", path.join(temp, "install"), "--ignore-scripts", "--omit=dev", "--no-package-lock", "--no-audit", "--no-fund", archive], { stdio: "inherit" });
    const installed = path.join(temp, "install/node_modules/ouch4ts");
    const actualVersion = execFileSync(process.execPath, [path.join(installed, "dist/cli.js"), "--version"], { encoding: "utf8" }).trim();
    if (actualVersion !== version) throw new Error(`Packed CLI reported ${actualVersion}, expected ${version}`);
    const moduleUrl = pathToFileURL(path.join(installed, "dist/index.js")).href;
    execFileSync(process.execPath, ["--input-type=module", "--eval", `const api = await import(${JSON.stringify(moduleUrl)}); if (typeof api.analyze !== 'function' || typeof api.analyzeReport !== 'function') process.exit(1);`], { stdio: "inherit" });
    return readFileSync(archive);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

export async function registryTags(registry: string): Promise<Record<string, string>> {
  const response = await fetch(`${registry}/-/package/ouch4ts/dist-tags`);
  if (!response.ok) throw new Error(`Cannot read npm channels: ${response.status}`);
  return z.record(z.string(), z.string()).parse(await response.json());
}

export function canAdvanceChannel(current: string | undefined, next: string, channel: string): boolean {
  if (current === undefined) return true;
  if (!semver.valid(current)) throw new Error(`Invalid current npm channel version: ${current}`);
  if (channel.startsWith("preview")) {
    const currentRun = semver.prerelease(current)?.at(-1);
    const nextRun = semver.prerelease(next)?.at(-1);
    if (currentRun === undefined || nextRun === undefined) throw new Error("Preview channel does not contain a run ID");
    return BigInt(nextRun) >= BigInt(currentRun);
  }
  return semver.gte(next, current);
}
