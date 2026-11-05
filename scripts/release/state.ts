import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { GitHub, type Release } from "./github.ts";
import { assertReleaseLine, branchSchema, isReleaseProposal, planRelease, planSchema, prSchema, releaseLabel, shaSchema, stableVersionSchema } from "./plan.ts";

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

export function recordsFrom(releases: Release[]) {
  return releases.filter((release) => release.tag_name.startsWith("record-")).map((release) => {
    const record = recordSchema.parse(JSON.parse(release.body ?? "null"));
    if (release.tag_name !== `record-${record.source}`) throw new Error("Release record identity mismatch");
    return { release, record };
  });
}

export async function loadRun(context: ReturnType<typeof runContext>) {
  const { env, github } = context;
  const releases = await github.releases();
  const records = recordsFrom(releases);
  const current = records.find(({ record }) => record.source === env.GITHUB_SHA && record.branch === env.RELEASE_BRANCH);
  if (!current) throw new Error("No frozen merge record. Direct pushes cannot release; wait for the recorder or rerun this source run");
  if (current.record.state !== "recorded") return { ...current, releases, records, active: current.record };
  if (env.GITHUB_EVENT_NAME !== "push") throw new Error("An unplanned release must first run from its original push event");
  const before = z.object({ before: shaSchema, after: shaSchema }).parse(readJson(env.GITHUB_EVENT_PATH));
  if (before.after !== env.GITHUB_SHA) throw new Error("Push source differs from workflow source");
  git("merge-base", "--is-ancestor", before.before, env.GITHUB_SHA);
  const bootstrapSource = git("rev-parse", `${env.RELEASE_BASELINE_TAG}^{commit}`);
  const bootstrapVersion = stableVersionSchema.parse(z.object({ version: z.string() }).parse(JSON.parse(git("show", `${env.RELEASE_BASELINE_TAG}:package.json`))).version);
  if (!releases.some((release) => release.tag_name === env.RELEASE_BASELINE_TAG && !release.draft)) throw new Error("Bootstrap GitHub release is incomplete");
  const pending = [];
  let cursor = before.before;
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
  const published = releases.filter((release) => !release.draft && /^v\d+\.\d+\.\d+$/.test(release.tag_name)).map((release) => stableVersionSchema.parse(release.tag_name.slice(1)));
  assertReleaseLine({ branch: env.RELEASE_BRANCH, baseline: baseline.version, published });
  const changes = kind === "ordinary" ? [...pending, current.record.pr] : pending;
  const computed = planRelease({ branch: env.RELEASE_BRANCH, baseline, source: kind === "stable" ? before.before : env.GITHUB_SHA, changes });
  let plan = computed;
  if (kind === "stable") {
    plan = planSchema.parse(readJson(".release/plan.json"));
    if (JSON.stringify(plan) !== JSON.stringify(computed) || plan.bump === "none") throw new Error("Release proposal is stale or differs from the frozen pending set");
    const pkg = z.object({ version: z.string() }).parse(readJson("package.json"));
    const lock = z.object({ version: z.string(), packages: z.object({ "": z.object({ version: z.string() }) }) }).parse(readJson("package-lock.json"));
    if (pkg.version !== plan.version || lock.version !== plan.version || lock.packages[""].version !== plan.version) throw new Error("Reviewed package and lockfile versions differ from the release plan");
    if (releaseLabel({ branch: env.RELEASE_BRANCH, labels: current.record.pr.labels }) !== plan.bump) throw new Error("Release proposal label differs from its calculated bump");
  }
  const active: ActiveRecord = { ...current.record, state: "planned", before: before.before, runId: env.GITHUB_RUN_ID, kind, plan };
  return { ...current, releases, records, active };
}
