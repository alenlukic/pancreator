import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  TurnEndedUsageMissingError,
  createEmptyMetrics,
  processStreamEvent,
} from "./lib/collect-usage.mjs";
import { verifyRun } from "./lib/verify-run.mjs";
import {
  buildBudgetBaseline,
  buildLiveEnvelope,
  comparableBudgetBaseline,
  compareToBudget,
  computeFixtureHash,
  estimateTextTokens,
} from "./lib/stats.mjs";
import { copySandboxToTemp } from "./lib/copy-sandbox.mjs";
import {
  DEFAULT_SCENARIO_ID,
  getScenarioById,
  normalizePath,
  promptMentionsForbiddenPrd,
  promptMentionsPath,
} from "./lib/expected.mjs";
import { loadRepoEnv, resolveHarnessRepoRoot } from "./lib/live-env.mjs";
import { HARNESS_MODEL, resolveSdkModelId } from "./lib/model.mjs";
import { computeTierAndIndexingStats } from "../../lib/internal/tools/context-budget-report.mjs";

test("model: resolveSdkModelId strips bracket qualifiers", () => {
  assert.equal(resolveSdkModelId("composer-2.5"), "composer-2.5");
  assert.equal(resolveSdkModelId("composer-2.5[fast=false]"), "composer-2.5");
  assert.equal(
    resolveSdkModelId("claude-4.6-sonnet-medium-thinking"),
    "claude-sonnet-4-6",
  );
});

test("expected: normalizePath strips leading ./ and backslashes", () => {
  assert.equal(normalizePath(".\\lib\\memory\\active\\current.md"), "lib/memory/active/current.md");
  assert.equal(normalizePath("./docs/PRD.summary.md"), "docs/PRD.summary.md");
});

test("expected: promptMentionsPath matches explicit path mentions", () => {
  const prompt = "Read docs/PRD.index.md and summarize.";
  assert.equal(promptMentionsPath(prompt, "docs/PRD.index.md"), true);
  assert.equal(promptMentionsPath(prompt, "docs/PRD.md"), false);
});

test("copy-sandbox: copies non-empty fixture tree to temp", async () => {
  const dest = await copySandboxToTemp();
  assert.ok(dest.includes("context-usage-sandbox-"));
});

test("budget: estimateTextTokens rounds up chars divided by four", () => {
  assert.equal(estimateTextTokens(""), 0);
  assert.equal(estimateTextTokens("abcd"), 1);
  assert.equal(estimateTextTokens("abcde"), 2);
});

test("collect-usage: turn-ended without usage throws", () => {
  const metrics = createEmptyMetrics();
  const toolPaths = [];
  assert.throws(
    () => processStreamEvent({ type: "turn-ended" }, metrics, toolPaths),
    TurnEndedUsageMissingError,
  );
});

test("collect-usage: aggregates turn-ended usage", () => {
  const metrics = createEmptyMetrics();
  processStreamEvent(
    {
      type: "turn-ended",
      usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2, cacheWriteTokens: 1 },
    },
    metrics,
    [],
  );
  assert.equal(metrics.input_tokens, 10);
  assert.equal(metrics.output_tokens, 5);
  assert.equal(metrics.turn_count, 1);
  assert.equal(metrics.total_tokens, 18);
});

test("collect-usage: counts unique read targets across duplicate tool_call events", () => {
  const metrics = createEmptyMetrics();
  const toolPaths = [];

  processStreamEvent(
    {
      type: "tool_call",
      name: "read",
      args: { path: "/tmp/a.md" },
    },
    metrics,
    toolPaths,
  );
  processStreamEvent(
    {
      type: "tool_call",
      name: "read",
      args: { path: "/tmp/a.md" },
    },
    metrics,
    toolPaths,
  );
  processStreamEvent(
    {
      type: "assistant",
      message: { content: [] },
    },
    metrics,
    toolPaths,
  );
  processStreamEvent(
    {
      type: "tool_call",
      name: "read",
      args: { path: "/tmp/a.md" },
    },
    metrics,
    toolPaths,
  );

  assert.equal(metrics.tool_read_count, 1);
  assert.deepEqual(toolPaths, ["/tmp/a.md"]);
});

test("verify-run: forbidden path fails", () => {
  const result = verifyRun({
    scenarioId: DEFAULT_SCENARIO_ID,
    report: {
      answers: {
        active_feature: "tier-sandbox-probe",
        handbook_anchor: "alpha-7f3c",
        product_route_token: "route-summary-only",
        handoff_stage: "implement",
        handler_export_count: 2,
      },
      files_read: ["docs/PRD.md"],
    },
    toolPaths: [],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("forbidden")));
});

test("verify-run: missing required read fails", () => {
  const result = verifyRun({
    scenarioId: DEFAULT_SCENARIO_ID,
    report: {
      answers: {
        active_feature: "tier-sandbox-probe",
        handbook_anchor: "alpha-7f3c",
        product_route_token: "route-summary-only",
        handoff_stage: "implement",
        handler_export_count: 2,
      },
      files_read: ["lib/memory/active/current.md"],
    },
    toolPaths: [],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("missing required read")));
});

test("verify-run: prompt regression mentioning docs/PRD.md fails early", () => {
  const badPrompt = "Read docs/PRD.md for full requirements.";
  assert.ok(promptMentionsForbiddenPrd(badPrompt));
  const result = verifyRun({
    scenarioId: DEFAULT_SCENARIO_ID,
    report: { answers: {}, files_read: [] },
    promptText: badPrompt,
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("prompt regression")));
});

test("expected: production prompt prohibition of docs/PRD.md is not a regression", () => {
  const harnessRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
  const promptText = fs.readFileSync(path.join(harnessRoot, "prompt.md"), "utf8");
  assert.equal(promptMentionsForbiddenPrd(promptText), false);
});

test("verify-run: summary-first routing scenario passes compact product reads", () => {
  const scenario = getScenarioById("summary_first_routing");
  const prompt = fs.readFileSync(path.join(resolveHarnessRepoRoot(), scenario.prompt_file), "utf8");
  const result = verifyRun({
    scenarioId: "summary_first_routing",
    promptText: prompt,
    report: {
      answers: {
        product_route_token: "route-summary-only",
        m1_index_anchor: "m1-index-sandbox",
        prd_index_anchor: "prd-index-sandbox",
      },
      files_read: ["docs/PRD.summary.md", "docs/M1.index.md", "docs/PRD.index.md"],
    },
    toolPaths: ["docs/PRD.summary.md", "docs/M1.index.md", "docs/PRD.index.md"],
    metrics: { tool_read_count: 3 },
  });
  assert.equal(result.ok, true, result.errors.join("\n"));
});

test("verify-run: simple-source-task scenario rejects memory and work reads", () => {
  const result = verifyRun({
    scenarioId: "simple_source_task",
    promptText: "Read lib/internal/packages/demo-svc/handler.ts only.",
    report: {
      answers: {
        handler_export_count: 2,
      },
      files_read: ["lib/internal/packages/demo-svc/handler.ts", "work/99999_sandbox/task/handoff.md"],
    },
    toolPaths: [],
    metrics: { tool_read_count: 2 },
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("forbidden read")));
  assert.ok(result.errors.some((e) => e.includes("allowlist")));
});

test("verify-run: generated-artifact-preference scenario rejects generated index read", () => {
  const result = verifyRun({
    scenarioId: "generated_artifact_preference",
    promptText: "Read lib/memory/features/tier-sandbox/spec.md.",
    report: {
      answers: {
        durable_spec_anchor: "durable-tier-sandbox-001",
      },
      files_read: [
        "lib/memory/features/tier-sandbox/spec.md",
        "lib/memory/features/tier-sandbox/index.json",
      ],
    },
    toolPaths: [],
    metrics: { tool_read_count: 2 },
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("index.json")));
});

test("verify-run: explicit-read-generated-index requires prompt path mention", () => {
  const missingPromptMention = verifyRun({
    scenarioId: "explicit_read_generated_index",
    promptText: "Read generated machine artifacts if needed.",
    report: {
      answers: {
        generated_machine_anchor: "index-json-tier-sandbox",
      },
      files_read: ["lib/memory/features/tier-sandbox/index.json"],
    },
    toolPaths: [],
    metrics: { tool_read_count: 1 },
  });
  assert.equal(missingPromptMention.ok, false);
  assert.ok(missingPromptMention.errors.some((e) => e.includes("explicit-read-only")));

  const explicitPrompt = verifyRun({
    scenarioId: "explicit_read_generated_index",
    promptText: "Read lib/memory/features/tier-sandbox/index.json explicitly.",
    report: {
      answers: {
        generated_machine_anchor: "index-json-tier-sandbox",
      },
      files_read: ["lib/memory/features/tier-sandbox/index.json"],
    },
    toolPaths: [],
    metrics: { tool_read_count: 1 },
  });
  assert.equal(explicitPrompt.ok, true, explicitPrompt.errors.join("\n"));
});

test("live-env: loadRepoEnv reads repo-root .env without overriding shell env", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "context-usage-env-"));
  fs.writeFileSync(path.join(tmp, ".env"), "CURSOR_API_KEY=from-dotenv\nEXISTING=dotenv\n");
  const previousKey = process.env.CURSOR_API_KEY;
  const previousExisting = process.env.EXISTING;
  delete process.env.CURSOR_API_KEY;
  process.env.EXISTING = "shell";
  try {
    loadRepoEnv(tmp);
    assert.equal(process.env.CURSOR_API_KEY, "from-dotenv");
    assert.equal(process.env.EXISTING, "shell");
  } finally {
    if (previousKey === undefined) {
      delete process.env.CURSOR_API_KEY;
    } else {
      process.env.CURSOR_API_KEY = previousKey;
    }
    if (previousExisting === undefined) {
      delete process.env.EXISTING;
    } else {
      process.env.EXISTING = previousExisting;
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("live-env: resolveHarnessRepoRoot points at repository root", () => {
  const repoRoot = resolveHarnessRepoRoot();
  assert.ok(fs.existsSync(path.join(repoRoot, "package.json")));
  assert.ok(fs.existsSync(path.join(repoRoot, "tests/context-usage/prompt.md")));
});

test("budget: committed baseline is reproducible from fixture and constants", () => {
  const harnessRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
  const baselinePath = path.join(harnessRoot, "baselines", "composer-2.5.json");
  const committed = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  const derived = buildBudgetBaseline({ modelId: HARNESS_MODEL });

  assert.deepEqual(comparableBudgetBaseline(committed), comparableBudgetBaseline(derived));
  assert.equal(committed.fixture_hash, computeFixtureHash());
  assert.equal(committed.visible_inputs.required_reads.files.length, 5);
  assert.equal(committed.visible_inputs.repo_policy.files.length, 5);
  assert.ok(committed.live_envelope?.maxima, "committed baseline should include ratified live_envelope");
});

test("budget: buildBudgetBaseline consumes calibration artifact envelope", () => {
  const baseline = buildBudgetBaseline({
    modelId: HARNESS_MODEL,
    calibrationBaseline: {
      schema_version: 1,
      generated_at: "2026-06-03T00:00:00.000Z",
      method: { quantile: 0.9, confidence: 0.8 },
      models: {
        "composer-2.5": {
          sample_counts: { repo_root: 30, empty_dir: 30 },
          conditions: {
            repo_root: {
              metrics: {
                input_tokens: { median: 34000 },
                cache_read_tokens: { median: 29000 },
                total_tokens: { median: 64000 },
                output_tokens: { median: 700 },
              },
            },
          },
          envelope: {
            quantile_target: 0.9,
            confidence: 0.8,
            maxima: {
              input_tokens: 36000,
              cache_read_tokens: 32000,
              total_tokens: 70000,
              output_tokens: 1100,
            },
            noise_floor: {
              input_tokens: 400,
              cache_read_tokens: 500,
              total_tokens: 900,
              output_tokens: 50,
            },
          },
        },
      },
    },
  });
  assert.equal(baseline.calibration_overhead.maxima.input_tokens, 36000);
  assert.equal(baseline.calibration_overhead.calibration_method.repo_root_samples, 30);
  assert.equal(baseline.calibration_overhead.noise_floor.cache_read_tokens, 500);
});

function baselineWithLiveEnvelope() {
  const baseline = buildBudgetBaseline({ modelId: HARNESS_MODEL });
  baseline.live_envelope = buildLiveEnvelope(baseline, {
    ratified_at: "2026-06-03T00:00:00.000Z",
    source_report: "tests/context-usage/output/example-report.json",
    metrics: {
      input_tokens: 34_429,
      output_tokens: 769,
      cache_read_tokens: 29_897,
      cache_write_tokens: 0,
      total_tokens: 65_162,
      tool_read_count: 5,
    },
  });
  return baseline;
}

test("compareToBudget: metrics within ratified live envelope pass", () => {
  const baseline = baselineWithLiveEnvelope();
  const observed = createEmptyMetrics();

  observed.input_tokens = baseline.live_envelope.maxima.input_tokens;
  observed.output_tokens = baseline.budgets.output_tokens.max;
  observed.cache_read_tokens = baseline.live_envelope.maxima.cache_read_tokens;
  observed.cache_write_tokens = baseline.budgets.cache_write_tokens.max;
  observed.total_tokens = baseline.live_envelope.maxima.total_tokens;
  observed.duration_ms = baseline.budgets.duration_ms.max;
  observed.turn_count = baseline.budgets.turn_count.max;
  observed.tool_read_count = baseline.budgets.tool_read_count.max;

  const cmp = compareToBudget(observed, baseline);
  assert.equal(cmp.ok, true);
  assert.deepEqual(cmp.errors, []);
});

test("compareToBudget: regression beyond ratified live envelope fails", () => {
  const baseline = baselineWithLiveEnvelope();
  const observed = createEmptyMetrics();

  observed.input_tokens = baseline.live_envelope.maxima.input_tokens + 1;
  observed.output_tokens = 10;
  observed.cache_read_tokens = baseline.live_envelope.maxima.cache_read_tokens + 1;
  observed.cache_write_tokens = 0;
  observed.total_tokens = baseline.live_envelope.maxima.total_tokens + 1;
  observed.duration_ms = 1000;
  observed.turn_count = 1;
  observed.tool_read_count = baseline.budgets.tool_read_count.max + 1;

  const cmp = compareToBudget(observed, baseline);
  assert.equal(cmp.ok, false);
  assert.ok(cmp.errors.some((e) => e.includes("input_tokens")));
  assert.ok(cmp.errors.some((e) => e.includes("cache_read_tokens")));
  assert.ok(cmp.errors.some((e) => e.includes("tool_read_count")));
});

test("compareToBudget: missing live envelope fails closed for live comparison", () => {
  const baseline = buildBudgetBaseline({
    modelId: HARNESS_MODEL,
    calibrationBaseline: { schema_version: 1, models: {} },
  });
  const observed = createEmptyMetrics();
  observed.input_tokens = 1000;
  observed.tool_read_count = baseline.budgets.tool_read_count.min;

  const cmp = compareToBudget(observed, baseline);
  assert.equal(cmp.ok, false);
  assert.ok(cmp.errors.some((e) => e.includes("live_envelope")));
});

test("fixture: sandbox stays small and free of synthetic filler", () => {
  const harnessRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
  const fixtureRoot = path.join(harnessRoot, "fixtures", "tier-sandbox");
  const paddingPath = path.join(fixtureRoot, "lib/memory/features/tier-sandbox/padding.md");

  assert.equal(fs.existsSync(paddingPath), false);

  const stats = computeTierAndIndexingStats(fixtureRoot);
  const indexableEstimatedTokens = Math.ceil(stats.indexableChars / 4);
  assert.ok(
    indexableEstimatedTokens <= 750,
    `expected sandbox indexable footprint <= 750 rough tokens, got ${indexableEstimatedTokens}`,
  );
});

test("package.json: root test script excludes live harness entry points", () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const testScript = pkg.scripts?.test ?? "";
  assert.match(testScript, /node --test/);
  assert.doesNotMatch(testScript, /run-live\.mjs|establish-baseline\.mjs/);
});
