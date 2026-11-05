import { describe, expect, test } from "vitest";
import { assertReleaseLine, planRelease, releaseLabel } from "../scripts/release/plan.ts";
import { canAdvanceChannel } from "../scripts/release/publication.ts";

describe("release labels", () => {
  test.each([
    { branch: "main", labels: ["release:patch"], expected: "patch" },
    { branch: "main", labels: ["release:minor", "bug"], expected: "minor" },
    { branch: "main", labels: ["release:major"], expected: "major" },
    { branch: "maintenance/0.1", labels: ["no release"], expected: "none" },
    { branch: "maintenance/0.1", labels: ["release:patch"], expected: "patch" },
  ])("$branch accepts $labels", ({ branch, labels, expected }) => {
    expect(releaseLabel({ branch, labels })).toBe(expected);
  });

  test.each([
    { branch: "main", labels: [] },
    { branch: "main", labels: ["release:patch", "no release"] },
    { branch: "maintenance/0.1", labels: ["release:minor"] },
    { branch: "maintenance/0.1", labels: ["release:major"] },
    { branch: "feature/test", labels: ["no release"] },
  ])("$branch rejects $labels", ({ branch, labels }) => {
    expect(() => releaseLabel({ branch, labels })).toThrow();
  });
});

const base = { tag: "v0.1.0", source: "a".repeat(40), version: "0.1.0" };
const change = (number: number, label: string) => ({
  number, title: `Change ${number}`, body: "Details", url: `https://github.com/test/repo/pull/${number}`,
  labels: [label], head: `change-${number}`, repository: "test/repo", author: "human",
});

test.each([
  { labels: ["release:patch"], bump: "patch", version: "0.1.1" },
  { labels: ["release:patch", "release:minor", "no release"], bump: "minor", version: "0.2.0" },
  { labels: ["release:minor", "release:major"], bump: "major", version: "1.0.0" },
  { labels: ["no release"], bump: "none", version: "0.1.0" },
])("plans $labels as $version", ({ labels, bump, version }) => {
  const plan = planRelease({ branch: "main", baseline: base, source: "b".repeat(40), changes: labels.map((label, i) => change(i + 1, label)) });
  expect(plan).toMatchObject({ bump, version });
  expect(plan.changes.map((pr) => pr.number)).toEqual(labels.map((_, i) => i + 1));
});

test("maintenance cannot allocate a version outside its own minor line", () => {
  expect(() => planRelease({ branch: "maintenance/0.2", baseline: base, source: "b".repeat(40), changes: [change(1, "release:patch")] })).toThrow(/minor line/);
});

test.each([
  { baseline: "0.1.0", published: ["0.1.0"], allowed: false },
  { baseline: "0.1.0", published: ["0.1.0", "0.2.0"], allowed: true },
  { baseline: "0.1.0", published: ["0.1.0", "0.1.1", "0.2.0"], allowed: false },
  { baseline: "0.1.1", published: ["0.1.0", "0.1.1", "0.2.0"], allowed: true },
])("maintenance baseline $baseline with $published is allowed=$allowed", ({ baseline, published, allowed }) => {
  const check = () => assertReleaseLine({ branch: "maintenance/0.1", baseline, published });
  if (allowed) expect(check).not.toThrow();
  else expect(check).toThrow();
});

test.each([
  { channel: "latest", current: "1.1.0", next: "1.0.2", advances: false },
  { channel: "release-1.0", current: "1.0.1", next: "1.0.2", advances: true },
  { channel: "preview", current: "1.1.0-preview.200", next: "1.0.1-preview.100", advances: false },
  { channel: "preview", current: "1.0.1-preview.100", next: "1.1.0-preview.200", advances: true },
])("$channel cannot rewind from $current to $next", ({ channel, current, next, advances }) => {
  expect(canAdvanceChannel(current, next, channel)).toBe(advances);
});
