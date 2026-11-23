import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { GitHub, type Release } from "./github.ts";
import { assertPackageVersions, assertReleaseLine, branchSchema, isReleaseProposal, planRelease, planSchema, prSchema, releaseLabel, shaSchema, stableVersionSchema } from "./plan.ts";

const snapshotSchema = z.object({ schema: z.literal(1), source: shaSchema, branch: branchSchema, pr: prSchema });
const recordedSchema = snapshotSchema.extend({ state: z.literal("recorded") });
const activeSchema = snapshotSchema.extend({
  state: z.enum(["planned", "artifact verified", "npm verified", "preview verified", "proposal current", "github complete"]),
  before: shaSchema, runId: z.string().regex(/^\d+$/), kind: z.enum(["ordinary", "stable"]), plan: planSchema,
});
export const recordSchema = z.discriminatedUnion("state", [recordedSchema, activeSchema]);
export type MergeRecord = z.infer<typeof recordSchema>;
export type ActiveRecord = z.infer<typeof activeSchema>;

export function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8"));
}

export function runContext() {
  const env = z.object({
    GITHUB_SHA: shaSchema, GITHUB_REPOSITORY: z.string().regex(/^[\w.-]+\/[\w.-]+$/), GH_TOKEN: z.string().min(1),
    GITHUB_API_URL: z.string().url().default("https://api.github.com"), GITHUB_EVENT_NAME: z.enum(["push", "workflow_dispatch", "pull_request_target"]),
    GITHUB_EVENT_PATH: z.string(), GITHUB_RUN_ID: z.string().regex(/^\d+$/),
    RELEASE_BRANCH: branchSchema, RELEASE_BASELINE_TAG: z.string().regex(/^v\d+\.\d+\.\d+$/),
  }).parse(process.env);
  if (git("rev-parse", "HEAD") !== env.GITHUB_SHA) throw new Error("Checkout must equal the workflow's provenance source SHA");
  return { env, github: new GitHub({ repository: env.GITHUB_REPOSITORY, token: env.GH_TOKEN, api: env.GITHUB_API_URL }) };
}

export function publishedStableVersions(releases: Release[]): string[] {
  return releases.filter(release => !release.draft && !release.prerelease && /^v\d+\.\d+\.\d+$/.test(release.tag_name))
    .map(release => stableVersionSchema.parse(release.tag_name.slice(1)));
}

export function recordsFrom(releases: Release[]) {
  return releases.filter((release) => release.tag_name.startsWith("record-")).map((release) => {
    const record = recordSchema.parse(JSON.parse(release.body ?? "null"));
    if (release.tag_name !== `record-${record.source}`) throw new Error("Release record identity mismatch");
    return { release, record };
  });
}

async function pushIdentity(context: ReturnType<typeof runContext>, record: MergeRecord) {
  const { env, github } = context;
  if (env.GITHUB_EVENT_NAME === "push") {
    const event = z.object({ before: shaSchema, after: shaSchema }).parse(readJson(env.GITHUB_EVENT_PATH));
    if (event.after !== env.GITHUB_SHA) throw new Error("Push source differs from workflow source");
    return { before: event.before, runId: env.GITHUB_RUN_ID };
  }
  const recovery = z.object({ RELEASE_RECOVER_RUN: z.string().regex(/^\d+$/), RELEASE_RECOVER_BEFORE: shaSchema }).parse(process.env);
  const original = z.object({ id: z.number().int(), event: z.literal("push"), head_sha: shaSchema, head_branch: branchSchema, path: z.string() }).parse(await github.request("GET", `actions/runs/${recovery.RELEASE_RECOVER_RUN}`));
  if (String(original.id) !== recovery.RELEASE_RECOVER_RUN || original.head_sha !== env.GITHUB_SHA || original.head_branch !== env.RELEASE_BRANCH || original.path !== ".github/workflows/release.yml") throw new Error("Recovery must identify the original push run for this source and branch");
  const commits = git("rev-list", "--first-parent", `${recovery.RELEASE_RECOVER_BEFORE}..${env.GITHUB_SHA}`).split("\n").filter(Boolean);
  if (commits.length === 0) throw new Error("Recovery predecessor must precede the merged source");
  for (const commit of commits) {
    const pulls = z.array(z.object({ number: z.number(), merged_at: z.string().nullable() })).parse(await github.request("GET", `commits/${commit}/pulls?per_page=100`));
    if (!pulls.some((pr) => pr.number === record.pr.number && pr.merged_at !== null)) throw new Error("Recovery predecessor would include commits outside the frozen merged PR");
  }
  return { before: recovery.RELEASE_RECOVER_BEFORE, runId: recovery.RELEASE_RECOVER_RUN };
}

export async function loadRun(context: ReturnType<typeof runContext>) {
  const { env, github } = context;
  const releases = await github.releases();
  const records = recordsFrom(releases);
  const current = records.find(({ record }) => record.source === env.GITHUB_SHA && record.branch === env.RELEASE_BRANCH);
  if (!current) throw new Error("No frozen merge record. Direct pushes cannot release; wait for the recorder or rerun this source run");
  if (current.record.state !== "recorded") return { ...current, releases, records, active: current.record };
  const identity = await pushIdentity(context, current.record);
  git("merge-base", "--is-ancestor", identity.before, env.GITHUB_SHA);
  const bootstrapSource = git("rev-parse", `${env.RELEASE_BASELINE_TAG}^{commit}`);
  const bootstrapVersion = stableVersionSchema.parse(z.object({ version: z.string() }).parse(JSON.parse(git("show", `${env.RELEASE_BASELINE_TAG}:package.json`))).version);
  if (!releases.some((release) => release.tag_name === env.RELEASE_BASELINE_TAG && !release.draft)) throw new Error("Bootstrap GitHub release is incomplete");
  const pending = [];
  let cursor = identity.before;
  let baseline = { tag: env.RELEASE_BASELINE_TAG, source: bootstrapSource, version: bootstrapVersion };
  while (cursor !== bootstrapSource) {
    const previous = records.find(({ record }) => record.source === cursor);
    if (!previous || previous.record.state === "recorded" || !["proposal current", "github complete"].includes(previous.record.state)) {
      throw new Error(`Unfinished predecessor ${cursor}; recover its original run first`);
    }
    const record = previous.record;
    if (record.kind === "stable") {
      if (record.state !== "github complete" || !releases.some((release) => release.tag_name === `v${record.plan.version}` && !release.draft)) throw new Error("Stable predecessor is incomplete");
      baseline = { tag: `v${record.plan.version}`, source: record.source, version: record.plan.version };
      break;
    }
    if (record.branch !== env.RELEASE_BRANCH) throw new Error("Release lines cannot share ordinary changes");
    pending.unshift(record.pr);
    cursor = record.before;
  }
  const kind = isReleaseProposal(current.record.pr, env.RELEASE_BRANCH, env.GITHUB_REPOSITORY) ? "stable" : "ordinary";
  assertReleaseLine({ branch: env.RELEASE_BRANCH, baseline: baseline.version, published: publishedStableVersions(releases) });
  const changes = kind === "ordinary" ? [...pending, current.record.pr] : pending;
  const computed = planRelease({ branch: env.RELEASE_BRANCH, baseline, source: kind === "stable" ? identity.before : env.GITHUB_SHA, changes });
  let plan = computed;
  if (kind === "stable") {
    plan = planSchema.parse(readJson(".release/plan.json"));
    if (JSON.stringify(plan) !== JSON.stringify(computed) || plan.bump === "none") throw new Error("Release proposal is stale or differs from the frozen pending set");
    assertPackageVersions({ packageJson: readJson("package.json"), lockfile: readJson("package-lock.json"), expected: plan.version });
    if (releaseLabel({ branch: env.RELEASE_BRANCH, labels: current.record.pr.labels }) !== plan.bump) throw new Error("Release proposal label differs from its calculated bump");
  }
  const active: ActiveRecord = { ...current.record, state: "planned", before: identity.before, runId: identity.runId, kind, plan };
  return { ...current, releases, records, active };
}
