import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { createEmptyMetrics } from "./lib/collect-usage.mjs";
import {
  buildFdTraceBudget,
  buildFdTracePrompt,
  compareTraceToBudget,
  normalizeTraceToolPaths,
  readFdTraceContext,
  validateTraceReadPaths,
} from "./lib/fd-trace.mjs";

const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = path.resolve(HARNESS_ROOT, "..", "..");
const TRACE_CONTEXT_PATH = path.join(
  HARNESS_ROOT,
  "traces",
  "fd-skeleton",
  "implement.context.json",
);

test("fd-trace: buildFdTracePrompt composes sdk-style prompt", () => {
  const context = readFdTraceContext(TRACE_CONTEXT_PATH);
  const fixtureAbs = path.join(REPO_ROOT, context.fixture_root);
  const stagePromptText = fs.readFileSync(path.join(fixtureAbs, context.stage_prompt.path), "utf8");
  const prompt = buildFdTracePrompt(context, stagePromptText);
  assert.match(prompt, /Persona: coder/);
  assert.match(prompt, /Required output artifacts/);
  assert.match(prompt, /Use subagent\/persona: coder/);
});

test("fd-trace: normalizeTraceToolPaths converts fixture-absolute paths to relative", () => {
  const root = "/tmp/fd-trace";
  const normalized = normalizeTraceToolPaths(
    [
      "/tmp/fd-trace/work/99999_sandbox/task/handoff.md",
      "/tmp/fd-trace/work/99999_sandbox/task/handoff.md",
      "/tmp/fd-trace/lib/internal/packages/demo-svc/handler.ts",
    ],
    root,
  );
  assert.deepEqual(normalized, [
    "work/99999_sandbox/task/handoff.md",
    "lib/internal/packages/demo-svc/handler.ts",
  ]);
});

test("fd-trace: validateTraceReadPaths enforces required and forbidden contracts", () => {
  const context = readFdTraceContext(TRACE_CONTEXT_PATH);
  const ok = validateTraceReadPaths(
    [
      "AGENTS.md",
      "work/99999_sandbox/task/handoff.md",
      "work/99999_sandbox/task/touch-set.json",
      "lib/internal/packages/demo-svc/handler.ts",
    ],
    context,
  );
  assert.deepEqual(ok, []);

  const bad = validateTraceReadPaths(
    [
      "AGENTS.md",
      "work/99999_sandbox/task/handoff.md",
      "docs/PRD.md",
    ],
    context,
  );
  assert.ok(bad.some((e) => e.includes("missing required read")));
  assert.ok(bad.some((e) => e.includes("forbidden read")));
});

test("fd-trace: budget comparison fails when metrics exceed computed limits", () => {
  const context = readFdTraceContext(TRACE_CONTEXT_PATH);
  const fixtureAbs = path.join(REPO_ROOT, context.fixture_root);
  const stagePromptText = fs.readFileSync(path.join(fixtureAbs, context.stage_prompt.path), "utf8");
  const prompt = buildFdTracePrompt(context, stagePromptText);
  const budget = buildFdTraceBudget(context, prompt, fixtureAbs);

  const inBudget = createEmptyMetrics();
  inBudget.input_tokens = budget.budgets.input_tokens.max;
  inBudget.output_tokens = budget.budgets.output_tokens.max;
  inBudget.cache_read_tokens = budget.budgets.cache_read_tokens.max;
  inBudget.cache_write_tokens = budget.budgets.cache_write_tokens.max;
  inBudget.total_tokens = budget.budgets.total_tokens.max;
  inBudget.duration_ms = budget.budgets.duration_ms.max;
  inBudget.turn_count = budget.budgets.turn_count.max;
  inBudget.tool_read_count = budget.budgets.tool_read_count.max;
  assert.equal(compareTraceToBudget(inBudget, budget).ok, true);

  const overBudget = createEmptyMetrics();
  overBudget.input_tokens = budget.budgets.input_tokens.max + 1;
  overBudget.output_tokens = 1;
  overBudget.cache_read_tokens = 1;
  overBudget.cache_write_tokens = 0;
  overBudget.total_tokens = budget.budgets.total_tokens.max + 1;
  overBudget.duration_ms = 1000;
  overBudget.turn_count = 1;
  overBudget.tool_read_count = budget.budgets.tool_read_count.max + 1;
  const cmp = compareTraceToBudget(overBudget, budget);
  assert.equal(cmp.ok, false);
  assert.ok(cmp.errors.some((e) => e.includes("input_tokens")));
  assert.ok(cmp.errors.some((e) => e.includes("tool_read_count")));
});
