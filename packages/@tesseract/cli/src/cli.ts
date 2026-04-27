#!/usr/bin/env node
import { parseAndRun } from "./run.js";

const code = await parseAndRun(process.argv.slice(2));
process.exit(code);
