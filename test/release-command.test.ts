import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import packageManifest from "../package.json" with { type: "json" };
import { verifyRegistryArtifact } from "../scripts/release/publication.ts";
import type { Release } from "../scripts/release/github.ts";
import { recordSchema } from "../scripts/release/state.ts";
import { planSchema } from "../scripts/release/plan.ts";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "ouch-release-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init", "--initial-branch=main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.com");
  git("config", "commit.gpgsign", "false");
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "ouch4ts", version: "0.1.0", license: "MIT", type: "module", files: packageManifest.files, scripts: { build: "node build.mjs" } }));
  await cp(path.resolve("docs"), path.join(root, "docs"), { recursive: true });
  await writeFile(path.join(root, "README.md"), "# Test package\n");
  await writeFile(path.join(root, "LICENSE"), "MIT\n");
  await mkdir(path.join(root, ".changeset"));
  await writeFile(path.join(root, ".changeset/config.json"), await readFile(path.resolve(".changeset/config.json")));
  await writeFile(path.join(root, "build.mjs"), `import { mkdirSync, writeFileSync } from 'node:fs';
mkdirSync('dist', {recursive:true});
writeFileSync('dist/cli.js', "import {readFileSync} from 'node:fs'; console.log(JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version);");
writeFileSync('dist/index.js', 'export function analyze() {return [];} export function analyzeReport() {return {entries:[],files:[]};}');
writeFileSync('dist/index.d.ts', 'export declare function analyze(): unknown[];');
`);
  git("add", "."); git("commit", "-m", "Baseline");
  const baseline = git("rev-parse", "HEAD");
  git("tag", "v0.1.0");
  await writeFile(path.join(root, "change"), "one");
  git("add", "."); git("commit", "-m", "First change");
  const source = git("rev-parse", "HEAD");
  const pr = { number: 1, title: "First change", body: "A change", url: "https://github.com/test/repo/pull/1", labels: ["release:patch"], head: "first", repository: "test/repo", author: "human" };
  const releases: (Release & { name: string })[] = [
    { id: 1, tag_name: "v0.1.0", name: "Baseline", draft: false, target_commitish: baseline, body: "Baseline", assets: [] },
    { id: 2, tag_name: `record-${source}`, name: "Record", draft: true, target_commitish: source, body: JSON.stringify({ schema: 1, source, branch: "main", state: "recorded", pr }), assets: [] },
  ];
  const requests: string[] = [];
  const registry = {
    value: {} as unknown,
    status: 404,
    version: "0.1.1",
    tarball: Buffer.alloc(0),
    provenanceDigest: "",
    tags: { latest: "0.1.0" } as Record<string, string>,
    publishCount: 0,
    ambiguousPublish: false,
    failFinalization: false,
    visibleAt: 0,
    scanDurationMs: 0,
    hideProvenanceOnce: false,
    interruptTarballOnce: false,
  };
  const assets = new Map<number, Buffer>();
  const refs = new Map<string, string>();
  const pulls = new Map<number, unknown>();
  const contents = new Map<string, unknown>();
  const runs = new Map<number, unknown>();
  let baseUrl = "";
  const bodyBytes = async (req: import("node:http").IncomingMessage) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  };
  const server = createServer(async (req, res) => {
    requests.push(`${req.method} ${req.url}`);
    res.setHeader("Content-Type", "application/json");
    if (req.url === `/ouch4ts/${registry.version}`) {
      res.statusCode = registry.status;
      if (Date.now() < registry.visibleAt) res.statusCode = 404;
      if (registry.hideProvenanceOnce) {
        registry.hideProvenanceOnce = false;
        const integrity = `sha512-${createHash("sha512").update(registry.tarball).digest("base64")}`;
        res.end(JSON.stringify({ version: registry.version, dist: { integrity } }));
        return;
      }
      res.end(JSON.stringify(registry.value));
      return;
    }
    if (req.url === "/-/package/ouch4ts/dist-tags") { res.end(JSON.stringify(registry.tags)); return; }
    if (req.url === "/tarball") {
      if (registry.interruptTarballOnce) {
        registry.interruptTarballOnce = false;
        res.writeHead(200, { "Content-Length": registry.tarball.length });
        res.write(registry.tarball.subarray(0, 1), () => res.destroy());
      } else res.end(registry.tarball);
      return;
    }
    if (req.url === "/attestations") {
      const publication = [...releases].flatMap((release) => release.assets).find((asset) => asset.name === "publication.json" && JSON.parse(assets.get(asset.id)?.toString() ?? "{}").version === registry.version);
      const source = publication ? JSON.parse(assets.get(publication.id)?.toString() ?? "{}").source : "";
      const statement = { subject: [{ digest: { sha512: registry.provenanceDigest } }], predicate: { buildDefinition: { externalParameters: { workflow: { repository: "https://github.com/test/repo", path: ".github/workflows/release.yml", ref: "refs/heads/main" } }, resolvedDependencies: [{ uri: "git+https://github.com/test/repo@refs/heads/main", digest: { gitCommit: source } }] } } };
      res.end(JSON.stringify({ attestations: [{ predicateType: "https://slsa.dev/provenance/v1", bundle: { dsseEnvelope: { payload: Buffer.from(JSON.stringify(statement)).toString("base64") } } }] })); return;
    }
    if (req.url === "/npm/publish" && req.method === "PUT") {
      registry.tarball = await bodyBytes(req); registry.version = String(req.headers["x-version"]);
      registry.provenanceDigest = createHash("sha512").update(registry.tarball).digest("hex");
      registry.publishCount++; registry.status = 200;
      registry.visibleAt = Date.now() + registry.scanDurationMs;
      registry.value = { version: registry.version, dist: { integrity: `sha512-${createHash("sha512").update(registry.tarball).digest("base64")}`, tarball: `${baseUrl}/tarball`, attestations: { url: `${baseUrl}/attestations` } } };
      registry.tags[String(req.headers["x-channel"])] = registry.version;
      res.statusCode = registry.ambiguousPublish ? 500 : 200; res.end("{}"); return;
    }
    if (req.url === "/npm/tag" && req.method === "POST") {
      const data = JSON.parse((await bodyBytes(req)).toString()); registry.tags[data.channel] = data.version; res.end("{}"); return;
    }
    if (req.url?.startsWith("/repos/test/repo/releases?")) { res.end(JSON.stringify(releases)); return; }
    const originalRun = req.url?.match(/^\/repos\/test\/repo\/actions\/runs\/(\d+)$/);
    if (originalRun) { res.end(JSON.stringify(runs.get(Number(originalRun[1])))); return; }
    if (req.url === `/repos/test/repo/commits/${source}/pulls?per_page=100`) { res.end(JSON.stringify([{ number: 1, merged_at: "2026-11-05T00:00:00Z" }])); return; }
    const pull = req.url?.match(/^\/repos\/test\/repo\/pulls\/(\d+)$/);
    if (pull && req.method === "GET") { res.end(JSON.stringify(pulls.get(Number(pull[1])))); return; }
    if (req.url?.startsWith("/repos/test/repo/contents/")) {
      const file = req.url.slice("/repos/test/repo/contents/".length).split("?")[0] ?? "";
      res.end(JSON.stringify({ encoding: "base64", content: Buffer.from(JSON.stringify(contents.get(file))).toString("base64") })); return;
    }
    if ((pull || req.url?.startsWith("/repos/test/repo/issues/")) && req.method === "PATCH") { res.end("{}"); return; }
    if (req.url === "/repos/test/repo/releases" && req.method === "POST") {
      const data = JSON.parse((await bodyBytes(req)).toString());
      const release = { ...data, id: releases.length + 1, assets: [] }; releases.push(release); res.end(JSON.stringify(release)); return;
    }
    const upload = req.url?.match(/^\/repos\/test\/repo\/releases\/(\d+)\/assets\?name=(.+)$/);
    if (upload && req.method === "POST") {
      const release = releases.find((entry) => entry.id === Number(upload[1]));
      if (!release) { res.statusCode = 404; res.end("{}"); return; }
      const id = assets.size + 1, name = decodeURIComponent(upload[2] ?? "");
      assets.set(id, await bodyBytes(req));
      const asset = { id, name, url: `${baseUrl}/repos/test/repo/releases/assets/${id}`, browser_download_url: `${baseUrl}/asset/${id}` };
      release.assets.push(asset); res.end(JSON.stringify(asset)); return;
    }
    const asset = req.url?.match(/^\/repos\/test\/repo\/releases\/assets\/(\d+)$/);
    if (asset) { res.end(assets.get(Number(asset[1]))); return; }
    if (req.url === "/repos/test/repo/git/refs" && req.method === "POST") {
      const data = JSON.parse((await bodyBytes(req)).toString()); refs.set(data.ref, data.sha); res.end("{}"); return;
    }
    const ref = req.url?.match(/^\/repos\/test\/repo\/git\/ref\/(.+)$/);
    if (ref && refs.has(`refs/${ref[1]}`)) { res.end(JSON.stringify({ object: { type: "commit", sha: refs.get(`refs/${ref[1]}`) } })); return; }
    const match = req.url?.match(/^\/repos\/test\/repo\/releases\/(\d+)$/);
    if (match && req.method === "GET") { res.end(JSON.stringify(releases.find((entry) => entry.id === Number(match[1])))); return; }
    if (match && req.method === "PATCH") {
      const data: unknown = JSON.parse((await bodyBytes(req)).toString());
      const release = releases.find((entry) => entry.id === Number(match[1]));
      if (registry.failFinalization && release?.tag_name.startsWith("v") && data && typeof data === "object" && "draft" in data && data.draft === false) { res.statusCode = 500; res.end("{}"); return; }
      if (release && data && typeof data === "object") {
        if (release.draft && !("tag_name" in data)) release.tag_name = `untagged-${release.id}`;
        Object.assign(release, data);
        res.end(JSON.stringify(release));
        return;
      }
    }
    res.statusCode = 404; res.end(JSON.stringify({ message: "Not found" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Missing test server address");
  baseUrl = `http://127.0.0.1:${address.port}`;
  const bin = path.join(root, "bin"); await mkdir(bin);
  const realNpm = process.env.npm_execpath ?? path.resolve(path.dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js");
  await writeFile(path.join(bin, "npm"), `#!${process.execPath}
import {readFileSync} from 'node:fs'; import {execFileSync,spawnSync} from 'node:child_process';
const args=process.argv.slice(2), registry=process.env.NPM_CONFIG_REGISTRY;
if(args[0]==='publish') {
 const bytes=readFileSync(args[1]); const pkg=JSON.parse(execFileSync('tar',['-xOf',args[1],'package/package.json'],{encoding:'utf8'}));
 const r=await fetch(registry+'/npm/publish',{method:'PUT',headers:{'x-version':pkg.version,'x-channel':args[args.indexOf('--tag')+1]},body:bytes}); process.exit(r.ok?0:1);
} else if(args[0]==='dist-tag') {
 const r=await fetch(registry+'/npm/tag',{method:'POST',body:JSON.stringify({version:args[2].split('@')[1],channel:args[3]})});process.exit(r.ok?0:1);
} else {const r=spawnSync(process.execPath,[${JSON.stringify(realNpm)},...args],{stdio:'inherit'});process.exit(r.status??1);}
`, { mode: 0o755 });
  await writeFile(path.join(bin, "package.json"), '{"type":"module"}');
  const eventFile = path.join(root, "event.json");
  await writeFile(eventFile, JSON.stringify({ before: baseline, after: source }));
  const run = async (command: string, environment: NodeJS.ProcessEnv = {}) => {
    const child = spawn(process.execPath, [path.resolve("scripts/release.ts"), command], {
      cwd: root,
      env: { ...process.env, GH_TOKEN: "test", GITHUB_API_URL: `http://127.0.0.1:${address.port}`, GITHUB_REPOSITORY: "test/repo", GITHUB_SHA: source, GITHUB_EVENT_PATH: eventFile, GITHUB_EVENT_NAME: "push", GITHUB_RUN_ID: "123", RELEASE_BRANCH: "main", RELEASE_BASELINE_TAG: "v0.1.0", ...environment },
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
    return { code, stdout, stderr };
  };
  const publisherEnv = { GITHUB_ACTIONS: "true", GITHUB_WORKFLOW_REF: "test/repo/.github/workflows/release.yml@refs/heads/main", NPM_CONFIG_REGISTRY: baseUrl, PATH: `${bin}:${process.env.PATH}` };
  return { root, git, baseline, source, releases, requests, run, pr, eventFile, registry, registryUrl: baseUrl, publisherEnv, pulls, contents, runs };
}

test("the release command plans an exact source from a frozen merge record", async () => {
  const f = await fixture();
  const result = await f.run("plan");
  expect(result.stderr).toBe("");
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ source: f.source, version: "0.1.1", bump: "patch", changes: [{ number: 1, labels: ["release:patch"] }] });
  expect(f.requests.every((request) => request.startsWith("GET "))).toBe(true);
});

test("an ambiguous npm success recovers the original preview and never publishes twice", async () => {
  const f = await fixture();
  f.registry.ambiguousPublish = true;
  const first = await f.run("publish", f.publisherEnv);
  expect(first.code, first.stderr).toBe(0);
  expect(f.registry.version).toBe("0.1.1-preview.123");
  expect(f.registry.publishCount).toBe(1);
  f.registry.hideProvenanceOnce = true;
  const retry = await f.run("publish", { ...f.publisherEnv, GITHUB_RUN_ID: "999" });
  expect(retry.code, retry.stderr).toBe(0);
  expect(f.registry.publishCount).toBe(1);
  expect(f.registry.version).toBe("0.1.1-preview.123");
  const record = f.releases.find((release) => release.tag_name === `record-${f.source}`);
  expect(JSON.parse(record?.body ?? "{}")).toMatchObject({ runId: "123", state: "preview verified" });
  expect(record?.assets.map((asset) => asset.name).sort()).toEqual(["SHA256SUMS", "ouch4ts.tgz", "publication.json"]);
}, 20000);

test("a registry outage before publication preserves the original artifact for recovery", async () => {
  const f = await fixture();
  f.registry.version = "0.1.1-preview.123";
  f.registry.status = 500;
  const failed = await f.run("publish", f.publisherEnv);
  expect(failed.code).toBe(1);
  expect(failed.stderr).toContain("npm registry verification failed: 500");
  expect(f.registry.publishCount).toBe(0);
  const record = f.releases.find((release) => release.tag_name === `record-${f.source}`);
  const artifact = record?.assets.find((asset) => asset.name === "ouch4ts.tgz");
  if (!artifact) throw new Error("Missing retained artifact");
  const bytes = Buffer.from(await (await fetch(artifact.url)).arrayBuffer());
  expect(JSON.parse(record?.body ?? "{}")).toMatchObject({ state: "artifact verified", runId: "123" });

  f.registry.status = 404;
  const recovered = await f.run("publish", { ...f.publisherEnv, GITHUB_RUN_ID: "999" });
  expect(recovered.code, recovered.stderr).toBe(0);
  expect(f.registry.version).toBe("0.1.1-preview.123");
  expect(f.registry.publishCount).toBe(1);
  expect(f.registry.tarball.equals(bytes)).toBe(true);
}, 20000);

test("a successful submit outlasts npm's scan and verifies the original preview", async () => {
  const f = await fixture();
  f.registry.scanDurationMs = 16_000;
  const result = await f.run("publish", f.publisherEnv);
  expect(result.code, result.stderr).toBe(0);
  expect(result.stderr).toContain("Waiting for npm to verify ouch4ts@0.1.1-preview.123");
  expect(f.registry.publishCount).toBe(1);
  expect(f.registry.tags.preview).toBe("0.1.1-preview.123");
}, 75_000);

test("verification retries an interrupted tarball download", async () => {
  const f = await fixture();
  const result = await f.run("publish", f.publisherEnv);
  expect(result.code, result.stderr).toBe(0);
  const input = {
    registry: f.registryUrl,
    repository: "test/repo",
    source: f.source,
    version: f.registry.version,
    integrity: `sha512-${createHash("sha512").update(f.registry.tarball).digest("base64")}`,
  };
  f.registry.interruptTarballOnce = true;
  expect(await verifyRegistryArtifact(input, { timeoutMs: 2000, intervalMs: 10 })).toBe(true);
});

test("maintenance previews use their own channel and preserve newer main channels", async () => {
  const f = await fixture();
  f.releases.push({ id: 3, name: "Newer main release", draft: false, tag_name: "v0.2.0", target_commitish: f.baseline, body: "Newer main line", assets: [] });
  const record = f.releases.find((release) => release.tag_name === `record-${f.source}`);
  if (!record) throw new Error("Missing merge record");
  record.body = JSON.stringify({ schema: 1, source: f.source, branch: "maintenance/0.1", state: "recorded", pr: f.pr });
  f.registry.tags = { latest: "0.2.0", preview: "0.2.1-preview.200" };
  const result = await f.run("publish", { ...f.publisherEnv, RELEASE_BRANCH: "maintenance/0.1", GITHUB_WORKFLOW_REF: "test/repo/.github/workflows/release.yml@refs/heads/maintenance/0.1" });
  expect(result.code, result.stderr).toBe(0);
  expect(f.registry.version).toBe("0.1.1-preview.123");
  expect(f.registry.tags).toEqual({ latest: "0.2.0", preview: "0.2.1-preview.200", "preview-0.1": "0.1.1-preview.123" });
}, 20000);

test.each([
  { failure: "substituted source", error: "npm provenance source, workflow, or artifact differs from the release plan" },
  { failure: "corrupted tarball", error: "npm tarball bytes differ from the retained artifact" },
])("registry verification rejects a $failure", async ({ failure, error }) => {
  const f = await fixture();
  const published = await f.run("publish", f.publisherEnv);
  expect(published.code, published.stderr).toBe(0);
  const integrity = `sha512-${createHash("sha512").update(f.registry.tarball).digest("base64")}`;
  if (failure === "corrupted tarball") f.registry.tarball = Buffer.from("different artifact");
  f.requests.length = 0;
  await expect(verifyRegistryArtifact({
    registry: f.registryUrl, repository: "test/repo", version: "0.1.1-preview.123", integrity,
    source: failure === "substituted source" ? f.baseline : f.source,
  }, { timeoutMs: 2000, intervalMs: 10 })).rejects.toThrow(error);
  expect(f.requests.filter((request) => request === "GET /ouch4ts/0.1.1-preview.123")).toHaveLength(1);
}, 20000);

test("stable recovery finishes GitHub after npm success without changing version or rewinding latest", async () => {
  const f = await fixture();
  expect((await f.run("publish", f.publisherEnv)).code).toBe(0);
  const previous = f.releases.find((release) => release.tag_name === `record-${f.source}`);
  if (!previous) throw new Error("Missing merge record");
  const record = recordSchema.parse(JSON.parse(previous.body ?? "{}"));
  if (record.state === "recorded") throw new Error("Preview was not planned");
  previous.body = JSON.stringify({ ...record, state: "proposal current" });
  await mkdir(path.join(f.root, ".release"));
  await writeFile(path.join(f.root, ".release/plan.json"), JSON.stringify(record.plan));
  const pkg: unknown = JSON.parse(await readFile(path.join(f.root, "package.json"), "utf8"));
  if (!pkg || typeof pkg !== "object") throw new Error("Invalid fixture package");
  await writeFile(path.join(f.root, "package.json"), JSON.stringify({ ...pkg, version: "0.1.1" }));
  await writeFile(path.join(f.root, "package-lock.json"), JSON.stringify({ name: "ouch4ts", version: "0.1.1", lockfileVersion: 3, packages: { "": { name: "ouch4ts", version: "0.1.1" } } }));
  f.git("add", "package.json", "package-lock.json", ".release/plan.json"); f.git("commit", "-m", "Release proposal");
  const stableSource = f.git("rev-parse", "HEAD");
  f.releases.push({ id: 3, name: "Stable record", draft: true, tag_name: `record-${stableSource}`, target_commitish: stableSource, assets: [], body: JSON.stringify({ schema: 1, source: stableSource, branch: "main", state: "recorded", pr: { ...f.pr, number: 2, title: "Release ouch4ts", head: "changeset-release/main", author: "github-actions[bot]" } }) });
  await writeFile(f.eventFile, JSON.stringify({ before: f.source, after: stableSource }));
  const env = { ...f.publisherEnv, GITHUB_SHA: stableSource, GITHUB_RUN_ID: "124" };
  await writeFile(path.join(f.root, ".release/plan.json"), JSON.stringify({ ...record.plan, source: f.baseline }));
  expect((await f.run("plan", env)).stderr).toContain("stale");
  await writeFile(path.join(f.root, ".release/plan.json"), JSON.stringify(record.plan));
  f.registry.failFinalization = true;
  const failed = await f.run("publish", env);
  expect(failed.stderr).toContain("500"); expect(failed.code).toBe(1);
  expect(f.registry.publishCount).toBe(2);
  expect(f.registry.version).toBe("0.1.1");
  f.registry.tags.latest = "0.2.0";
  f.registry.failFinalization = false;
  const recovered = await f.run("publish", { ...env, GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_RUN_ID: "999" });
  expect(recovered.stderr).toBe(""); expect(recovered.code).toBe(0);
  expect(f.registry.publishCount).toBe(2);
  expect(f.registry.tags.latest).toBe("0.2.0");
  const stable = f.releases.find((release) => release.tag_name === "v0.1.1");
  expect(stable?.draft).toBe(false);
  expect(stable?.body).toContain(stableSource);
  expect(stable?.body).toContain("A change");
  expect(JSON.parse(f.releases.find((release) => release.tag_name === `record-${stableSource}`)?.body ?? "{}")).toMatchObject({ state: "github complete", runId: "124", kind: "stable" });
}, 20000);

test("a missing registry artifact is eligible for its original publication", async () => {
  const f = await fixture();
  const input = { registry: f.registryUrl, version: "0.1.1", source: f.source, integrity: "sha512-correct", repository: "test/repo" };
  expect(await verifyRegistryArtifact(input)).toBe(false);
});

test("verification stops at the deadline when the registry still has no version", async () => {
  const f = await fixture();
  const input = { registry: f.registryUrl, version: "0.1.1", source: f.source, integrity: "sha512-correct", repository: "test/repo" };
  expect(await verifyRegistryArtifact(input, { timeoutMs: 100, intervalMs: 30_000 })).toBe(false);
  expect(f.requests).toContain("GET /ouch4ts/0.1.1");
});

test.each([
  { status: 500, manifest: {}, error: /500/ },
  { status: 200, manifest: { version: "0.1.1", dist: { integrity: "sha512-other" } }, error: /different contents/ },
  { status: 200, manifest: { version: "0.1.1", dist: { integrity: "sha512-correct" } }, error: /provenance/ },
])("registry status $status and $manifest prevent publication", async ({ status, manifest, error }) => {
  const f = await fixture();
  f.registry.status = status; f.registry.value = manifest;
  await expect(verifyRegistryArtifact({ registry: f.registryUrl, version: "0.1.1", source: f.source, integrity: "sha512-correct", repository: "test/repo" })).rejects.toThrow(error);
});

test("an out-of-order run refuses to skip an unfinished predecessor", async () => {
  const f = await fixture();
  await writeFile(path.join(f.root, "change"), "two");
  f.git("add", "change"); f.git("commit", "-m", "Second change");
  const next = f.git("rev-parse", "HEAD");
  f.releases.push({ id: 3, tag_name: `record-${next}`, name: "Second record", draft: true, target_commitish: next, body: JSON.stringify({ schema: 1, source: next, branch: "main", state: "recorded", pr: { ...f.pr, number: 2, labels: ["release:minor"] } }), assets: [] });
  await writeFile(f.eventFile, JSON.stringify({ before: f.source, after: next }));
  const result = await f.run("plan", { GITHUB_SHA: next });
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("Unfinished predecessor");
  expect(f.requests.every((request) => request.startsWith("GET "))).toBe(true);
});

test.each([
  { label: "no release", expectedVersion: "0.1.1" },
  { label: "release:minor", expectedVersion: "0.2.0" },
])("a following $label merge refreshes the complete pending plan", async ({ label, expectedVersion }) => {
  const f = await fixture();
  const first = f.releases.find((release) => release.id === 2);
  if (!first) throw new Error("Missing fixture record");
  const previousPlan: unknown = JSON.parse((await f.run("plan")).stdout);
  first.body = JSON.stringify({ schema: 1, source: f.source, branch: "main", state: "proposal current", before: f.baseline, runId: "122", kind: "ordinary", plan: previousPlan, pr: f.pr });
  await writeFile(path.join(f.root, "change"), "two");
  f.git("add", "change"); f.git("commit", "-m", "Second change");
  const next = f.git("rev-parse", "HEAD");
  f.releases.push({ id: 3, tag_name: `record-${next}`, name: "Second record", draft: true, target_commitish: next, body: JSON.stringify({ schema: 1, source: next, branch: "main", state: "recorded", pr: { ...f.pr, number: 2, labels: [label] } }), assets: [] });
  await writeFile(f.eventFile, JSON.stringify({ before: f.source, after: next }));
  const result = await f.run("prepare", { GITHUB_SHA: next });
  expect(result.stderr).toBe("");
  expect(result.code).toBe(0);
  expect(JSON.parse(await readFile(path.join(f.root, ".release/plan.json"), "utf8"))).toMatchObject({ source: next, version: expectedVersion, changes: [{ number: 1 }, { number: 2 }] });
  expect(await readFile(path.join(f.root, ".changeset/pr-1.md"), "utf8")).toContain('"ouch4ts": patch');
});

test("a newer merge permits predecessor completion while keeping its proposal unmergeable", async () => {
  const f = await fixture();
  const plan = planSchema.parse(JSON.parse((await f.run("plan")).stdout));
  const current = f.releases.find((release) => release.tag_name === `record-${f.source}`);
  if (!current) throw new Error("Missing merge record");
  current.body = JSON.stringify({ schema: 1, source: f.source, branch: "main", state: "preview verified", before: f.baseline, runId: "123", kind: "ordinary", plan, pr: f.pr });
  f.pulls.set(42, { number: 42, title: "Release ouch4ts", body: "", html_url: "https://github.com/test/repo/pull/42", labels: [{ name: "release:patch" }], user: { login: "github-actions[bot]" }, base: { ref: "main", sha: "d".repeat(40) }, head: { ref: "changeset-release/main", sha: "e".repeat(40), repo: { full_name: "test/repo" } } });
  f.contents.set(".release/plan.json", plan);
  const result = await f.run("proposal", { RELEASE_PR: "42" });
  expect(result.code, result.stderr).toBe(0);
  expect(JSON.parse(current.body ?? "{}")).toMatchObject({ state: "proposal current", source: f.source });
  await writeFile(f.eventFile, JSON.stringify({ pull_request: { number: 42 } }));
  expect((await f.run("labels")).stderr).toContain("must be current");
});

test("an expired push canceled before planning can recover at its exact source with verified inputs", async () => {
  const f = await fixture();
  f.runs.set(77, { id: 77, event: "push", head_sha: f.source, head_branch: "main", path: ".github/workflows/release.yml" });
  const env = { ...f.publisherEnv, GITHUB_EVENT_NAME: "workflow_dispatch", RELEASE_RECOVER_RUN: "77", RELEASE_RECOVER_BEFORE: f.baseline };
  const result = await f.run("publish", env);
  expect(result.code, result.stderr).toBe(0);
  expect(f.registry.version).toBe("0.1.1-preview.77");
  expect(f.registry.publishCount).toBe(1);
  const current = f.releases.find((release) => release.tag_name === `record-${f.source}`);
  expect(JSON.parse(current?.body ?? "{}")).toMatchObject({ before: f.baseline, runId: "77", state: "preview verified" });
}, 20000);

test("unplanned recovery rejects an original run from a different source before mutation", async () => {
  const f = await fixture();
  f.runs.set(77, { id: 77, event: "push", head_sha: f.baseline, head_branch: "main", path: ".github/workflows/release.yml" });
  const result = await f.run("plan", { GITHUB_EVENT_NAME: "workflow_dispatch", RELEASE_RECOVER_RUN: "77", RELEASE_RECOVER_BEFORE: f.baseline });
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("original push run");
  expect(f.requests.every((request) => request.startsWith("GET "))).toBe(true);
});

test("direct pushes and substituted workflow source SHAs fail before mutation", async () => {
  const f = await fixture();
  expect((await f.run("plan", { GITHUB_SHA: f.baseline })).stderr).toContain("provenance source SHA");
  f.releases.splice(1);
  expect((await f.run("plan")).stderr).toContain("Direct pushes cannot release");
  expect(f.requests.every((request) => request.startsWith("GET "))).toBe(true);
});

test("Changesets consumes generated inputs and synchronizes the package and lockfile", async () => {
  const f = await fixture();
  expect((await f.run("prepare")).code).toBe(0);
  const versioned = await f.run("version", f.publisherEnv);
  expect(versioned.code, versioned.stderr).toBe(0);
  expect(JSON.parse(await readFile(path.join(f.root, "package.json"), "utf8"))).toMatchObject({ version: "0.1.1" });
  expect(JSON.parse(await readFile(path.join(f.root, "package-lock.json"), "utf8"))).toMatchObject({ version: "0.1.1", packages: { "": { version: "0.1.1" } } });
  expect(await readFile(path.join(f.root, "CHANGELOG.md"), "utf8")).toContain("First change");
  expect(await readdir(path.join(f.root, ".changeset"))).toEqual(["config.json"]);
}, 15000);

test("an all-no-release pending set neither publishes nor creates a proposal", async () => {
  const f = await fixture();
  const current = f.releases.find((release) => release.tag_name === `record-${f.source}`);
  if (!current) throw new Error("Missing merge record");
  current.body = JSON.stringify({ schema: 1, source: f.source, branch: "main", state: "recorded", pr: { ...f.pr, labels: ["no release"] } });
  const output = path.join(f.root, "outputs");
  const result = await f.run("publish", { ...f.publisherEnv, GITHUB_OUTPUT: output });
  expect(result.code, result.stderr).toBe(0);
  expect(f.registry.publishCount).toBe(0);
  expect(current.assets).toEqual([]);
  expect(await readFile(output, "utf8")).toContain("proposal=false");
});
