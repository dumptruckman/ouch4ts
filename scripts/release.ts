import { loadRun, runContext } from "./release/state.ts";
import { checkLabels, finishProposal, prepareProposal, versionProposal } from "./release/proposal.ts";
import { publishRelease } from "./release/publish.ts";

try {
  const command = process.argv[2];
  if (command === "labels") await checkLabels();
  else if (command === "version") versionProposal();
  else if (command === "proposal") await finishProposal(runContext());
  else if (command === "publish") await publishRelease(runContext());
  else if (command === "plan" || command === "prepare") {
    const run = await loadRun(runContext());
    if (command === "prepare") prepareProposal(run.active.plan);
    else process.stdout.write(`${JSON.stringify(run.active.plan)}\n`);
  } else throw new Error(`Unknown release command: ${command}`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
