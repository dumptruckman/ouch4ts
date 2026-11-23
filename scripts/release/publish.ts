import { execFile } from "node:child_process";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";
import semver from "semver";
import { z } from "zod";
import { GitHubError, releaseSchema, type GitHub, type Release } from "./github.ts";
import { minorLine, releaseLabel, releaseNotes } from "./plan.ts";
import { canAdvanceChannel, checksums, confirmChannel, packArtifact, publicationSchema, readMatchingManifest, registryTags, verifyRegistryArtifact, type Publication } from "./publication.ts";
import { loadRun, publishedStableVersions, type runContext } from "./state.ts";

const exec = promisify(execFile);
function registryUrl(): string {
  return z.string().url().parse(process.env.NPM_CONFIG_REGISTRY ?? "https://registry.npmjs.org");
}

function outputs(branch: string, proposal: boolean): void {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `branch=${branch}\nproposal=${proposal}\n`);
}

async function refresh(github: GitHub, release: Release): Promise<Release> {
  return releaseSchema.parse(await github.request("GET", `releases/${release.id}`));
}

async function retainArtifact(input: { github: GitHub; release: Release; version: string; source: string; runId: string; channel: string }) {
  let release = await refresh(input.github, input.release);
  const retained = await input.github.asset(release, "publication.json");
  let publication = retained ? publicationSchema.parse(JSON.parse(retained.toString())) : undefined;
  if (publication && (publication.source !== input.source || publication.version !== input.version || publication.runId !== input.runId || publication.channel !== input.channel)) throw new Error("Retained publication identity differs from this source run");
  let bytes = await input.github.asset(release, "ouch4ts.tgz");
  if (!bytes) bytes = packArtifact(input.version);
  const digest = checksums(bytes);
  if (publication && (digest.sha256 !== publication.sha256 || digest.integrity !== publication.integrity)) throw new Error("Retained tarball checksum differs from the publication plan");
  if (!publication) {
    publication = { schema: 1, version: input.version, source: input.source, runId: input.runId, channel: input.channel, ...digest };
    await input.github.upload(release, "publication.json", Buffer.from(JSON.stringify(publication, null, 2)));
  }
  release = await refresh(input.github, release);
  if (!release.assets.some((asset) => asset.name === "SHA256SUMS")) await input.github.upload(release, "SHA256SUMS", Buffer.from(`${publication.sha256}  ouch4ts.tgz\n`));
  if (!release.assets.some((asset) => asset.name === "ouch4ts.tgz")) await input.github.upload(release, "ouch4ts.tgz", bytes);
  // Download both before publishing, including after a partial asset upload.
  release = await refresh(input.github, release);
  const saved = await input.github.asset(release, "ouch4ts.tgz");
  if (!saved || checksums(saved).integrity !== publication.integrity) throw new Error("GitHub did not retain the exact tarball");
  return { publication, bytes: saved };
}

async function submitTarball(bytes: Buffer, channel: string, registry: string) {
  const temp = mkdtempSync(path.join(tmpdir(), "ouch-publish-"));
  try {
    const archive = path.join(temp, "ouch4ts.tgz");
    writeFileSync(archive, bytes);
    await exec("npm", ["publish", archive, "--ignore-scripts", "--access", "public", "--provenance", "--tag", channel, "--registry", registry]);
  } finally { rmSync(temp, { recursive: true, force: true }); }
}

async function publishOrVerify(input: { publication: Publication; bytes: Buffer; repository: string }): Promise<void> {
  const registry = registryUrl();
  const verifyInput = { registry, repository: input.repository, ...input.publication };
  const existing = await readMatchingManifest(verifyInput);
  let publishError: unknown;
  if (!existing) {
    try {
      await submitTarball(input.bytes, input.publication.channel, registry);
    } catch (error) { publishError = error; }
  }
  // A successful submission can take several minutes to clear npm's scan.
  const wait = publishError
    ? { timeoutMs: 15_000, intervalMs: 1_000 }
    : { timeoutMs: 20 * 60_000, intervalMs: 30_000 };
  if (await verifyRegistryArtifact(verifyInput, wait)) return;
  throw publishError ?? new Error(`Timed out verifying ouch4ts@${input.publication.version}; rerun the original source run`);
}

async function moveChannels(publication: Publication): Promise<void> {
  const registry = registryUrl();
  const channels = semver.prerelease(publication.version) ? [publication.channel] : [publication.channel, "latest"];
  for (const channel of new Set(channels)) {
    const current = (await registryTags(registry))[channel];
    if (!canAdvanceChannel(current, publication.version, channel) || current === publication.version) continue;
    await exec("npm", ["dist-tag", "add", `ouch4ts@${publication.version}`, channel, "--registry", registry]);
    await confirmChannel({ registry, channel, version: publication.version });
  }
}

async function finalizeStable(input: { github: GitHub; release: Release; publication: Publication; latest: boolean; notes: string }): Promise<void> {
  const tag = `v${input.publication.version}`;
  let exists = false;
  try {
    let ref = z.object({ object: z.object({ sha: z.string(), type: z.string() }) }).parse(await input.github.request("GET", `git/ref/tags/${tag}`)).object;
    while (ref.type === "tag") ref = z.object({ object: z.object({ sha: z.string(), type: z.string() }) }).parse(await input.github.request("GET", `git/tags/${ref.sha}`)).object;
    if (ref.type !== "commit" || ref.sha !== input.publication.source) throw new Error(`Existing ${tag} points at different source`);
    exists = true;
  } catch (error) { if (!(error instanceof GitHubError && error.status === 404)) throw error; }
  if (!exists) await input.github.request("POST", "git/refs", { ref: `refs/tags/${tag}`, sha: input.publication.source });
  await input.github.update(input.release, { draft: false, prerelease: false, make_latest: input.latest ? "true" : "false", body: input.notes, target_commitish: input.publication.source });
}

export async function publishRelease(context: ReturnType<typeof runContext>): Promise<void> {
  const { env, github } = context;
  if (process.env.GITHUB_ACTIONS !== "true" || !process.env.GITHUB_WORKFLOW_REF?.startsWith(`${env.GITHUB_REPOSITORY}/.github/workflows/release.yml@`)) throw new Error("Publication must run in release.yml at the original source commit");
  let run;
  for (let attempt = 0; ; attempt++) {
    try { run = await loadRun(context); break; }
    catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith("No frozen merge record") || attempt >= 9 || env.GITHUB_EVENT_NAME !== "push") throw error;
      await setTimeout(3000);
    }
  }
  const { active } = run;
  if (active.state === "proposal current" || active.state === "github complete") { outputs(active.branch, false); return; }
  const unfinishedStable = run.records.find(({ record }) => record.source !== active.source && record.branch === active.branch && record.state !== "recorded" && record.kind === "stable" && record.state !== "github complete");
  if (unfinishedStable) throw new Error(`Recover unfinished stable source ${unfinishedStable.record.source} before continuing this line`);
  await github.update(run.release, { body: JSON.stringify(active, null, 2) });
  const plan = active.plan;
  if (plan.bump === "none") {
    await github.update(run.release, { body: JSON.stringify({ ...active, state: "proposal current" }, null, 2) });
    outputs(active.branch, false); return;
  }
  if (active.kind === "ordinary" && releaseLabel({ branch: active.branch, labels: active.pr.labels }) === "none") {
    outputs(active.branch, true); return;
  }
  const stable = active.kind === "stable";
  const version = stable ? plan.version : `${plan.version}-preview.${active.runId}`;
  const channel = stable ? `release-${minorLine(plan.version)}` : active.branch === "main" ? "preview" : `preview-${minorLine(plan.version)}`;
  const notes = releaseNotes(plan, active.source, env.GITHUB_REPOSITORY);
  let release = run.release;
  if (stable) {
    release = run.releases.find(entry => entry.tag_name === `v${version}`) ?? await github.create({
      tag_name: `v${version}`, target_commitish: active.source, name: `ouch4ts ${version}`, draft: true,
      body: notes,
    });
  }
  const retained = await retainArtifact({ github, release, version, source: active.source, runId: active.runId, channel });
  await github.update(run.release, { body: JSON.stringify({ ...active, state: "artifact verified" }, null, 2) });
  await publishOrVerify({ ...retained, repository: env.GITHUB_REPOSITORY });
  await github.update(run.release, { body: JSON.stringify({ ...active, state: "npm verified" }, null, 2) });
  await moveChannels(retained.publication);
  if (stable) {
    const latest = publishedStableVersions(run.releases).every(published => semver.lte(published, version));
    await finalizeStable({ github, release, publication: retained.publication, notes, latest });
    await github.update(run.release, { body: JSON.stringify({ ...active, state: "github complete" }, null, 2) });
    outputs(active.branch, false);
  } else {
    await github.update(run.release, {
      name: `ouch4ts ${version} (PR #${active.pr.number})`, prerelease: true,
      body: JSON.stringify({ ...active, state: "preview verified" }, null, 2),
    });
    outputs(active.branch, true);
  }
}
