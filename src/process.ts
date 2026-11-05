import { spawnSync } from "node:child_process";

export function runCommand(command: string, cwd: string, label: "Setup" | "Coverage") {
  const result = spawnSync(command, { cwd, shell: true, stdio: ["ignore", 2, 2] });
  const hint = `Check the command and project dependencies in ${cwd}. Pass --${label.toLowerCase()}-command to override it.`;
  if (result.error) throw new Error(`${label} command could not start: ${result.error.message}. ${hint}`);
  if (result.status !== 0) throw new Error(`${label} command failed: ${result.signal ?? result.status}. ${hint}`);
}
