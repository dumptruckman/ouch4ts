import { z } from "zod";
import semver from "semver";

const labels = {
  "release:major": "major",
  "release:minor": "minor",
  "release:patch": "patch",
  "no release": "none",
} as const;
const releaseLabels = ["release:major", "release:minor", "release:patch", "no release"] as const;

export const branchSchema = z.string().regex(/^(main|maintenance\/(0|[1-9]\d*)\.(0|[1-9]\d*))$/);
export const bumpSchema = z.enum(["major", "minor", "patch", "none"]);
export type Bump = z.infer<typeof bumpSchema>;

export function releaseLabel(input: { branch: string; labels: string[] }): Bump {
  const branch = branchSchema.parse(input.branch);
  const selected = releaseLabels.filter((label) => input.labels.includes(label));
  if (selected.length !== 1) throw new Error("Exactly one release label is required");
  const label = selected[0];
  const bump = label === undefined ? undefined : labels[label];
  if (bump === undefined) throw new Error("Unknown release label");
  if (branch !== "main" && bump !== "patch" && bump !== "none") {
    throw new Error("Maintenance branches accept only release:patch or no release");
  }
  return bump;
}

export const shaSchema = z.string().regex(/^[a-f0-9]{40}$/);
export const stableVersionSchema = z.string().refine((version) => semver.valid(version) === version && semver.prerelease(version) === null);
export const baselineSchema = z.object({ tag: z.string(), source: shaSchema, version: stableVersionSchema });
export const prSchema = z.object({
  number: z.number().int().positive(), title: z.string(), body: z.string(), url: z.string().url(),
  labels: z.array(z.string()), head: z.string(), repository: z.string(), author: z.string(),
});
export const planSchema = z.object({
  branch: branchSchema, baseline: baselineSchema, source: shaSchema, changes: z.array(prSchema),
  bump: bumpSchema, version: stableVersionSchema,
});
export type ReleasePlan = z.infer<typeof planSchema>;
export type PullRequest = z.infer<typeof prSchema>;

export function assertPackageVersions(input: { packageJson: unknown; lockfile: unknown; expected: string }): void {
  const pkg = z.object({ version: z.string() }).parse(input.packageJson);
  const lock = z.object({ version: z.string(), packages: z.object({ "": z.object({ version: z.string() }) }) }).parse(input.lockfile);
  if (pkg.version !== input.expected || lock.version !== input.expected || lock.packages[""].version !== input.expected) throw new Error("Package and lockfile versions differ from the frozen release plan");
}

export function planRelease(input: Omit<ReleasePlan, "bump" | "version">): ReleasePlan {
  const branch = branchSchema.parse(input.branch);
  const baseline = baselineSchema.parse(input.baseline);
  if (branch !== "main" && branch !== `maintenance/${minorLine(baseline.version)}`) {
    throw new Error("Maintenance baseline must belong to its named minor line");
  }
  const bumps = input.changes.map((pr) => releaseLabel({ branch, labels: pr.labels }));
  const priorities: Exclude<Bump, "none">[] = ["major", "minor", "patch"];
  const bump = priorities.find((candidate) => bumps.includes(candidate)) ?? "none";
  const version = bump === "none" ? baseline.version : semver.inc(baseline.version, bump);
  if (version === null) throw new Error("Cannot increment baseline version");
  return planSchema.parse({ ...input, branch, baseline, bump, version });
}

export function minorLine(version: string): string {
  return `${semver.major(version)}.${semver.minor(version)}`;
}

export function assertReleaseLine(input: { branch: string; baseline: string; published: string[] }): void {
  if (input.branch === "main") return;
  const line = minorLine(input.baseline);
  if (input.branch !== `maintenance/${line}`) throw new Error("Maintenance baseline differs from its named minor line");
  const sameLine = input.published.filter((version) => minorLine(version) === line);
  if (sameLine.some((version) => semver.gt(version, input.baseline))) throw new Error("Maintenance must start at its latest stable tag");
  if (!input.published.some((version) => semver.gt(version, input.baseline) && minorLine(version) !== line)) throw new Error("Main still owns this minor line; publish a newer line before creating maintenance");
}

export function isReleaseProposal(pr: PullRequest, branch: string, repository: string): boolean {
  return pr.head === `changeset-release/${branch}` && pr.repository === repository && pr.author === "github-actions[bot]";
}

export function releaseNotes(plan: ReleasePlan, source: string, repository: string): string {
  const eligible = plan.changes.filter((pr) => releaseLabel({ branch: plan.branch, labels: pr.labels }) !== "none");
  const skipped = plan.changes.filter((pr) => releaseLabel({ branch: plan.branch, labels: pr.labels }) === "none");
  const entries = (prs: PullRequest[]) => prs.map((pr) => `### [${pr.title}](${pr.url})\n\n${pr.body}`).join("\n\n");
  return `Source: ${source}\n\n[Compare changes](https://github.com/${repository}/compare/${plan.baseline.tag}...${source})\n\n## Released changes\n\n${entries(eligible)}\n\n## Changes without a release bump\n\n${entries(skipped) || "None."}`;
}
