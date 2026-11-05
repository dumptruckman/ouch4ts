import { spawnSync } from "node:child_process";

export function git(args: string[], cwd = process.cwd()) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw new Error(`Cannot run Git: ${result.error.message}. Install Git and ensure it is on PATH.`);
  if (result.status !== 0) {
    const hint = args[0] === "rev-parse" || args[0] === "merge-base"
      ? " Check the selected project's Git repository and reference names. Fetch missing references or history, including in shallow checkouts."
      : "";
    throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}${hint}`);
  }
  return result.stdout;
}
