#!/usr/bin/env node
import { runCommandLine } from "./command.js";

process.exitCode = await runCommandLine(process.argv.slice(2), process.cwd());
