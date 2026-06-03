import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { createEmptyMetrics } from "./lib/collect-usage.mjs";
import {
  buildFdTraceDisparityAnalysis,
  buildFdTraceBudget,
  buildFdTracePrompt,
  buildReadSequenceTrace,
  compareTraceToBudget,
  estimateObservedTraceInputs,
  listFdTraceContextFiles,
  normalizeTraceToolPaths,
  readFdTraceContext,
  validateTraceReadPaths,
} from "./lib/fd-trace.mjs";
import { buildSessionBaseline, compareSessionToBaseline } from "./lib/session-trace.mjs";

const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = path.resolve(HARNESS_ROOT, "..", "..", "..");
const TRACE_ROOT = path.join(HARNESS_ROOT, "traces");
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

test("fd-trace: all committed contexts load with unique trace ids", () => {
  const contextFiles = listFdTraceContextFiles(TRACE_ROOT);
  assert.ok(contextFiles.length >= 4, "expected representative trace coverage");
  const traceIds = new Set();
  for (const contextFile of contextFiles) {
    const context = readFdTraceContext(contextFile);
    assert.equal(context.schema_version, 1);
    assert.equal(traceIds.has(context.trace_id), false, `duplicate trace_id: ${context.trace_id}`);
    traceIds.add(context.trace_id);
    assert.ok(context.expected_required_reads.length > 0);
    assert.ok(context.required_artifact_paths.length > 0);
  }
});

test("fd-trace: normalizeTraceToolPaths converts fixture-absolute paths to relative", () => {
  const root = "/tmp/fd-trace";
  const normalized = normalizeTraceToolPaths(
    [
      "/tmp/fd-trace/pipeline/99999_sandbox/task/handoff.md",
      "/tmp/fd-trace/pipeline/99999_sandbox/task/handoff.md",
      "/tmp/fd-trace/lib/internal/packages/demo-svc/handler.ts",
    ],
    root,
  );
  assert.deepEqual(normalized, [
    "pipeline/99999_sandbox/task/handoff.md",
    "lib/internal/packages/demo-svc/handler.ts",
  ]);
});

test("fd-trace: validateTraceReadPaths enforces required and forbidden contracts", () => {
  const context = readFdTraceContext(TRACE_CONTEXT_PATH);
  const ok = validateTraceReadPaths(
    [
      "AGENTS.md",
      "pipeline/99999_sandbox/task/handoff.md",
      "pipeline/99999_sandbox/task/touch-set.json",
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

test("fd-trace: each committed context builds a valid in-budget envelope", () => {
  const contextFiles = listFdTraceContextFiles(TRACE_ROOT);
  for (const contextFile of contextFiles) {
    const context = readFdTraceContext(contextFile);
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
    const comparison = compareTraceToBudget(inBudget, budget);
    assert.equal(comparison.ok, true, `${context.trace_id}: ${comparison.errors.join("; ")}`);
  }
});

test("fd-trace: observed input analysis reports extra-read and unexplained deltas", () => {
  const context = readFdTraceContext(TRACE_CONTEXT_PATH);
  const fixtureAbs = path.join(REPO_ROOT, context.fixture_root);
  const stagePromptText = fs.readFileSync(path.join(fixtureAbs, context.stage_prompt.path), "utf8");
  const prompt = buildFdTracePrompt(context, stagePromptText);
  const budget = buildFdTraceBudget(context, prompt, fixtureAbs);
  const normalizedReads = [
    "AGENTS.md",
    "pipeline/99999_sandbox/task/handoff.md",
    "pipeline/99999_sandbox/task/touch-set.json",
    "lib/internal/packages/demo-svc/handler.ts",
    "tests/handler.test.ts",
  ];
  const observedInputs = estimateObservedTraceInputs(normalizedReads, fixtureAbs, context);
  assert.ok(observedInputs.extra_estimated_tokens > 0);

  const analysis = buildFdTraceDisparityAnalysis({
    context,
    budget,
    promptText: prompt,
    fixtureAbs,
    normalizedReads,
    readEvents: [
      { event_index: 1, path: "AGENTS.md" },
      { event_index: 2, path: "pipeline/99999_sandbox/task/handoff.md" },
      { event_index: 3, path: "pipeline/99999_sandbox/task/touch-set.json" },
      { event_index: 4, path: "lib/internal/packages/demo-svc/handler.ts" },
      { event_index: 5, path: "tests/handler.test.ts" },
    ],
    observedMetrics: {
      ...createEmptyMetrics(),
      input_tokens: 100000,
      cache_read_tokens: 75000,
      total_tokens: 180000,
      output_tokens: 2000,
    },
  });
  assert.equal(analysis.observed_inputs.extra_estimated_tokens, observedInputs.extra_estimated_tokens);
  assert.ok(analysis.unexplained_input_tokens > 0);
  assert.equal(analysis.read_sequence.length, 5);
});

test("fd-trace: buildReadSequenceTrace keeps cumulative first-seen token totals", () => {
  const context = readFdTraceContext(TRACE_CONTEXT_PATH);
  const fixtureAbs = path.join(REPO_ROOT, context.fixture_root);
  const sequence = buildReadSequenceTrace(
    [
      { event_index: 1, path: "AGENTS.md" },
      { event_index: 2, path: "AGENTS.md" },
      { event_index: 3, path: "pipeline/99999_sandbox/task/handoff.md" },
    ],
    fixtureAbs,
    context,
  );
  assert.equal(sequence.length, 3);
  assert.equal(sequence[0].first_seen, true);
  assert.equal(sequence[1].first_seen, false);
  assert.equal(sequence[1].cumulative_estimated_tokens, sequence[0].cumulative_estimated_tokens);
  assert.ok(sequence[2].cumulative_estimated_tokens > sequence[1].cumulative_estimated_tokens);
});

test("fd-session: compareSessionToBaseline passes at exact boundary", () => {
  const traceBaseline = {
    traces: {
      a: {
        trace_id: "a",
        stage_id: "implement",
        budgets: {
          input_tokens: { max: 100 },
          cache_read_tokens: { max: 80 },
          total_tokens: { max: 200 },
          output_tokens: { max: 20 },
          duration_ms: { max: 1000 },
          turn_count: { max: 3 },
          tool_read_count: { min: 1, max: 4 },
        },
      },
      b: {
        trace_id: "b",
        stage_id: "review",
        budgets: {
          input_tokens: { max: 90 },
          cache_read_tokens: { max: 75 },
          total_tokens: { max: 180 },
          output_tokens: { max: 25 },
          duration_ms: { max: 1000 },
          turn_count: { max: 3 },
          tool_read_count: { min: 1, max: 4 },
        },
      },
    },
  };
  const sessionBaseline = buildSessionBaseline(
    traceBaseline,
    {
      maxima: { input_tokens: 120, cache_read_tokens: 90, total_tokens: 220, output_tokens: 30 },
      tolerance: { cache_read_tokens: 20 },
      noise_floor: { cache_read_tokens: 10 },
    },
    {
      traceOrder: ["a", "b"],
      model: "composer-2.5",
      sourceTraceBaseline: "tests/compliance/context-usage/baselines/fd-skeleton.json",
      sourceModelBaseline: "tests/compliance/context-usage/baselines/composer-2.5.json",
    },
  );
  const cmp = compareSessionToBaseline(
    [
      {
        trace_id: "a",
        metrics: {
          input_tokens: 100,
          cache_read_tokens: 80,
          total_tokens: 200,
          output_tokens: 20,
          duration_ms: 1000,
          turn_count: 3,
          tool_read_count: 4,
        },
      },
      {
        trace_id: "b",
        metrics: {
          input_tokens: 90,
          cache_read_tokens: 75,
          total_tokens: 180,
          output_tokens: 25,
          duration_ms: 1000,
          turn_count: 3,
          tool_read_count: 4,
        },
      },
    ],
    sessionBaseline,
  );
  assert.equal(cmp.ok, true, cmp.errors.join("\n"));
});

test("fd-session: compareSessionToBaseline fails on step and cumulative regressions", () => {
  const baseline = {
    trace_sequence: ["a", "b"],
    per_step: {
      a: {
        input_tokens_max: 100,
        cache_read_tokens_max: 80,
        total_tokens_max: 200,
        output_tokens_max: 20,
        duration_ms_max: 1000,
        turn_count_max: 3,
        tool_read_count: { min: 1, max: 4 },
      },
      b: {
        input_tokens_max: 90,
        cache_read_tokens_max: 75,
        total_tokens_max: 180,
        output_tokens_max: 25,
        duration_ms_max: 1000,
        turn_count_max: 3,
        tool_read_count: { min: 1, max: 4 },
      },
    },
    cumulative: {
      input_tokens_max: 190,
      cache_read_tokens_max: 155,
      total_tokens_max: 380,
      output_tokens_max: 45,
    },
    cache_growth: { max_step_delta: 5 },
  };
  const cmp = compareSessionToBaseline(
    [
      {
        trace_id: "a",
        metrics: {
          input_tokens: 101,
          cache_read_tokens: 80,
          total_tokens: 200,
          output_tokens: 20,
          duration_ms: 1000,
          turn_count: 3,
          tool_read_count: 4,
        },
      },
      {
        trace_id: "b",
        metrics: {
          input_tokens: 95,
          cache_read_tokens: 60,
          total_tokens: 181,
          output_tokens: 26,
          duration_ms: 1000,
          turn_count: 3,
          tool_read_count: 5,
        },
      },
    ],
    baseline,
  );
  assert.equal(cmp.ok, false);
  assert.ok(cmp.errors.some((err) => err.includes("a input_tokens")));
  assert.ok(cmp.errors.some((err) => err.includes("b total_tokens")));
  assert.ok(cmp.errors.some((err) => err.includes("session cumulative input_tokens")));
  assert.ok(cmp.errors.some((err) => err.includes("cache_read_tokens delta")));
});
