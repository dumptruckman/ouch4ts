import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { z } from "zod";
import { GitHub } from "./github.ts";
import { isReleaseProposal, planSchema, releaseLabel, releaseNotes, type ReleasePlan } from "./plan.ts";
import { loadRun, readJson, type runContext } from "./state.ts";

export function prepareProposal(plan: ReleasePlan): void {
  if (plan.bump === "none") return;
  mkdirSync(".changeset", { recursive: true });
  for (const file of readdirSync(".changeset")) {
    if (file.endsWith(".md") && file !== "README.md") rmSync(path.join(".changeset", file));
  }
  for (const pr of plan.changes) {
    const bump = releaseLabel({ branch: plan.branch, labels: pr.labels });
    if (bump === "none") continue;
    writeFileSync(`.changeset/pr-${pr.number}.md`, `---\n"ouch4ts": ${bump}\n---\n\n[${pr.title}](${pr.url})\n`);
  }
  mkdirSync(".release", { recursive: true });
  writeFileSync(".release/plan.json", `${JSON.stringify(plan, null, 2)}\n`);
}

export function versionProposal(): void {
  const plan = planSchema.parse(readJson(".release/plan.json"));
  const require = createRequire(import.meta.url);
  const cli = path.join(path.dirname(require.resolve("@changesets/cli/package.json")), "bin.js");
  execFileSync(process.execPath, [cli, "version"], { stdio: "inherit" });
  execFileSync("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], { stdio: "inherit" });
  const pkg = z.object({ version: z.string() }).parse(readJson("package.json"));
  const lock = z.object({ version: z.string(), packages: z.object({ "": z.object({ version: z.string() }) }) }).parse(readJson("package-lock.json"));
  if (pkg.version !== plan.version || lock.version !== plan.version || lock.packages[""].version !== plan.version) throw new Error("Changesets and the frozen release plan disagree on the version");
  if (readdirSync(".changeset").some((file) => file.startsWith("pr-") && file.endsWith(".md"))) throw new Error("Changesets did not consume generated inputs");
}

const pullSchema = z.object({
  number: z.number(), title: z.string(), body: z.string().nullable(), html_url: z.string(),
  labels: z.array(z.object({ name: z.string() })), user: z.object({ login: z.string() }),
  base: z.object({ ref: z.string(), sha: z.string() }),
  head: z.object({ ref: z.string(), sha: z.string(), repo: z.object({ full_name: z.string() }).nullable() }),
});

async function contentAt(github: GitHub, file: string, ref: string): Promise<unknown> {
  const data = z.object({ encoding: z.literal("base64"), content: z.string() }).parse(await github.request("GET", `contents/${file}?ref=${encodeURIComponent(ref)}`));
  return JSON.parse(Buffer.from(data.content, "base64").toString());
}

export async function checkLabels(): Promise<void> {
  const env = z.object({ GH_TOKEN: z.string().min(1), GITHUB_REPOSITORY: z.string(), GITHUB_API_URL: z.string().default("https://api.github.com"), GITHUB_EVENT_PATH: z.string() }).parse(process.env);
  const event = z.object({ pull_request: z.object({ number: z.number() }) }).parse(readJson(env.GITHUB_EVENT_PATH));
  const github = new GitHub({ repository: env.GITHUB_REPOSITORY, token: env.GH_TOKEN, api: env.GITHUB_API_URL });
  const pr = pullSchema.parse(await github.request("GET", `pulls/${event.pull_request.number}`));
  const labels = pr.labels.map((label) => label.name);
  const bump = releaseLabel({ branch: pr.base.ref, labels });
  const proposal = isReleaseProposal({ number: pr.number, title: pr.title, body: pr.body ?? "", url: pr.html_url, labels, head: pr.head.ref, repository: pr.head.repo?.full_name ?? "", author: pr.user.login }, pr.base.ref, env.GITHUB_REPOSITORY);
  if (proposal) {
    const plan = planSchema.parse(await contentAt(github, ".release/plan.json", pr.head.sha));
    if (plan.source !== pr.base.sha || plan.branch !== pr.base.ref || plan.bump !== bump || bump === "none") throw new Error("Release proposal must be current with its target and calculated label");
    const pkg = z.object({ version: z.string() }).parse(await contentAt(github, "package.json", pr.head.sha));
    const lock = z.object({ version: z.string(), packages: z.object({ "": z.object({ version: z.string() }) }) }).parse(await contentAt(github, "package-lock.json", pr.head.sha));
    if (pkg.version !== plan.version || lock.version !== plan.version || lock.packages[""].version !== plan.version) throw new Error("Release proposal versions are inconsistent");
  }
}

export async function finishProposal(context: ReturnType<typeof runContext>): Promise<void> {
  const run = await loadRun(context);
  if (run.active.kind !== "ordinary" || run.active.plan.bump === "none") throw new Error("No release proposal is expected");
  const number = z.coerce.number().int().positive().parse(process.env.RELEASE_PR);
  const pr = pullSchema.parse(await context.github.request("GET", `pulls/${number}`));
  if (pr.base.ref !== run.active.branch || pr.base.sha !== run.active.source || pr.head.ref !== `changeset-release/${run.active.branch}` || pr.user.login !== "github-actions[bot]") throw new Error("Proposal target moved; rerun this source after recovering pending work");
  const plan = planSchema.parse(await contentAt(context.github, ".release/plan.json", pr.head.sha));
  if (JSON.stringify(plan) !== JSON.stringify(run.active.plan)) throw new Error("Generated proposal differs from the frozen plan");
  const otherLabels = pr.labels.map((label) => label.name).filter((label) => !label.startsWith("release:") && label !== "no release");
  await context.github.request("PATCH", `issues/${number}`, { labels: [...otherLabels, `release:${plan.bump}`] });
  await context.github.request("PATCH", `pulls/${number}`, { body: `Merging this current proposal approves ouch4ts@${plan.version}.\n\n${releaseNotes(plan, plan.source, context.env.GITHUB_REPOSITORY)}` });
  await context.github.update(run.release, { body: JSON.stringify({ ...run.active, state: "proposal current" }, null, 2) });
}
