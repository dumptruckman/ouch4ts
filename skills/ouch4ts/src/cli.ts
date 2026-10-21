#!/usr/bin/env node
import { runCli } from "./command.js";

runCli(process.argv.slice(2), process.cwd()).catch((error: unknown) => {
  console.error(`ouch4ts: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
