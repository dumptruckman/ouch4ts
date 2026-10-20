import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import type { analyze } from "./index.js";

/** Read the Git diff once, then match current-source function ranges against changed lines. */
export function changedFunctionFilter(reference: string) {
  const root = git(["rev-parse", "--show-toplevel"]).trimEnd();
  const commit = git(["rev-parse", "--verify", "--end-of-options", `${reference}^{commit}`]).trim();
  const base = git(["merge-base", commit, "HEAD"]).trim();
  const diff = git(["-c", "core.quotePath=false", "diff", "--no-color", "--no-ext-diff", "--no-textconv",
    "--no-relative", "--src-prefix=a/", "--dst-prefix=b/", "--find-renames", "--unified=0",
    "--inter-hunk-context=0", base, "--"]);
  const changes = new Map<string, { start: number; count: number }[]>();
  let file: string | undefined;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) file = undefined;
    else if (file === undefined && line.startsWith("+++ ")) {
      const path = decodeGitPath(line.slice(4).replace(/\t$/, ""));
      if (path.startsWith("b/")) file = resolve(root, path.slice(2));
    } else if (file) {
      const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (!hunk) continue;
      const range = { start: Number(hunk[1]), count: Number(hunk[2] ?? 1) };
      const ranges = changes.get(file) ?? [];
      ranges.push(range);
      changes.set(file, ranges);
    }
  }
  return (entry: ReturnType<typeof analyze>[number]) => (changes.get(resolve(entry.file)) ?? [])
    // A deletion belongs to a surviving function when both adjacent lines remain inside it.
    .some(({ start, count }) => count === 0
      ? entry.line <= start && entry.endLine >= start + 1
      : entry.line <= start + count - 1 && entry.endLine >= start);
}

// Git uses C escapes for special path characters even with core.quotePath disabled.
function decodeGitPath(path: string) {
  if (!path.startsWith('"')) return path;
  const escapes: Record<string, string> = {
    a: "\x07", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v", '"': '"', "\\": "\\",
  };
  return path.slice(1, -1).replace(/\\([0-7]{1,3}|[abfnrtv"\\])/g,
    (_, token: string) => escapes[token] ?? String.fromCharCode(Number.parseInt(token, 8)));
}

function git(args: string[]) {
  const result = spawnSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`);
  return result.stdout;
}
