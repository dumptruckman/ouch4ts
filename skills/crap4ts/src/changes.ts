import { resolve } from "node:path";
import type { analyze } from "./index.js";
import { git } from "./git.js";

/** Read the Git diff once, then match current-source function ranges against changed lines. */
export function changedFunctionFilter(reference: string, cwd = process.cwd()) {
  const root = git(["rev-parse", "--show-toplevel"], cwd).trimEnd();
  const commit = git(["rev-parse", "--verify", "--end-of-options", `${reference}^{commit}`], cwd).trim();
  const base = git(["merge-base", commit, "HEAD"], cwd).trim();
  const diff = git(["-c", "core.quotePath=false", "diff", "--no-color", "--no-ext-diff", "--no-textconv",
    "--no-relative", "--src-prefix=a/", "--dst-prefix=b/", "--find-renames", "--unified=0",
    "--inter-hunk-context=0", base, "--"], cwd);
  const changes = changedRanges(diff, root);
  return (entry: ReturnType<typeof analyze>[number]) => (changes.get(resolve(cwd, entry.file)) ?? [])
    .some(range => overlapsFunction(range, entry));
}

function changedRanges(diff: string, root: string) {
  const changes = new Map<string, { start: number; count: number }[]>();
  let file: string | undefined;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) file = undefined;
    else if (file === undefined && line.startsWith("+++ ")) {
      file = currentFilePath(line, root);
    } else if (file) {
      addHunk(changes, file, line);
    }
  }
  return changes;
}

function currentFilePath(header: string, root: string) {
  const path = decodeGitPath(header.slice(4).replace(/\t$/, ""));
  return path.startsWith("b/") ? resolve(root, path.slice(2)) : undefined;
}

function addHunk(changes: Map<string, { start: number; count: number }[]>, file: string, line: string) {
  const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
  if (!hunk) return;
  const ranges = changes.get(file) ?? [];
  ranges.push({ start: Number(hunk[1]), count: Number(hunk[2] ?? 1) });
  changes.set(file, ranges);
}

function overlapsFunction({ start, count }: { start: number; count: number }, entry: ReturnType<typeof analyze>[number]) {
  // A deletion belongs to a surviving function when both adjacent lines remain inside it.
  return count === 0
    ? entry.line <= start && entry.endLine >= start + 1
    : entry.line <= start + count - 1 && entry.endLine >= start;
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
