#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildFdTraceBudget, buildFdTracePrompt, readFdTraceContext } from "./lib/fd-trace.mjs";

const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const TRACE_DIR = path.join(HARNESS_ROOT, "traces", "fd-skeleton");
const BASELINE_PATH = path.join(HARNESS_ROOT, "baselines", "fd-skeleton.json");
const REPO_ROOT = path.resolve(HARNESS_ROOT, "..", "..");

/**
 * @param {string} dir
 */
function findTraceContextFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...findTraceContextFiles(full));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".context.json")) {
      out.push(full);
    }
  }
  return out.sort();
}

const traceContextFiles = findTraceContextFiles(TRACE_DIR);
if (traceContextFiles.length === 0) {
  throw new Error(
    `[context-usage] no fd-trace context files found under ${TRACE_DIR}. Expected *.context.json files.`,
  );
}

/** @type {Record<string, unknown>} */
const traces = {};
for (const contextPath of traceContextFiles) {
  const context = readFdTraceContext(contextPath);
  const fixtureAbs = path.join(REPO_ROOT, context.fixture_root);
  const stagePromptAbs = path.join(fixtureAbs, context.stage_prompt.path);
  const stagePromptText = fs.readFileSync(stagePromptAbs, "utf8");
  const promptText = buildFdTracePrompt(context, stagePromptText);
  traces[context.trace_id] = {
    context_file: path.relative(REPO_ROOT, contextPath).replace(/\\/g, "/"),
    ...buildFdTraceBudget(context, promptText, fixtureAbs),
  };
}

const baseline = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  traces,
};

fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
fs.writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2));
console.log(`[context-usage] fd-trace baseline written: ${BASELINE_PATH}`);
