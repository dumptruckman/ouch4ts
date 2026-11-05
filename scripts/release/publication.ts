import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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

export async function verifyRegistryArtifact(input: { registry: string; repository: string; version: string; source: string; integrity: string }): Promise<boolean> {
  const response = await fetch(`${input.registry}/ouch4ts/${input.version}`);
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`npm registry verification failed: ${response.status}`);
  const manifest = z.object({ version: z.string(), dist: z.object({ integrity: z.string(), tarball: z.string().url().optional(), attestations: z.object({ url: z.string().url() }).optional() }) }).parse(await response.json());
  if (manifest.version !== input.version || manifest.dist.integrity !== input.integrity) throw new Error(`npm ${input.version} already has different contents`);
  if (!manifest.dist.attestations) throw new Error("npm provenance is not available yet; retry this original run");
  const attestationResponse = await fetch(manifest.dist.attestations.url);
  if (!attestationResponse.ok) throw new Error(`Cannot read npm provenance: ${attestationResponse.status}`);
  const attestations = z.object({ attestations: z.array(z.object({ predicateType: z.string(), bundle: z.unknown() })) }).parse(await attestationResponse.json());
  const attestation = attestations.attestations.find((entry) => entry.predicateType === "https://slsa.dev/provenance/v1");
  if (!attestation) throw new Error("npm SLSA provenance is missing");
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
  if (!manifest.dist.tarball) throw new Error("npm tarball URL is missing");
  const tarball = await fetch(manifest.dist.tarball);
  if (!tarball.ok || checksums(Buffer.from(await tarball.arrayBuffer())).integrity !== input.integrity) throw new Error("npm tarball bytes differ from the retained artifact");
  return true;
}

export function packArtifact(version: string): Buffer {
  const temp = mkdtempSync(path.join(tmpdir(), "ouch-artifact-"));
  try {
    const pkg = z.object({ version: z.string() }).parse(JSON.parse(readFileSync("package.json", "utf8")));
    if (pkg.version !== version) execFileSync("npm", ["version", version, "--no-git-tag-version", "--ignore-scripts"], { stdio: "inherit" });
    execFileSync("npm", ["run", "build"], { stdio: "inherit" });
    const packed = z.array(z.object({ filename: z.string() })).parse(JSON.parse(execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", temp], { encoding: "utf8" })));
    const filename = packed[0]?.filename;
    if (!filename) throw new Error("npm pack produced no artifact");
    const archive = path.join(temp, filename);
    const entries = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).trim().split("\n");
    if (entries.some((entry) => !/^package\/(package\.json|README\.md|LICENSE|CHANGELOG\.md|dist\/[\w/-]+\.(js|d\.ts))$/.test(entry))) throw new Error("Packed artifact contains files outside the MIT distribution");
    for (const required of ["package/package.json", "package/LICENSE", "package/README.md", "package/dist/cli.js", "package/dist/index.js", "package/dist/index.d.ts"]) {
      if (!entries.includes(required)) throw new Error(`Packed artifact is missing ${required}`);
    }
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
