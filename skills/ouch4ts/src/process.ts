import { spawnSync } from "node:child_process";

export function runCommand(command: string, cwd: string, label: string) {
  const result = spawnSync(command, { cwd, shell: true, stdio: ["ignore", 2, 2] });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} command failed: ${result.signal ?? result.status}`);
}
