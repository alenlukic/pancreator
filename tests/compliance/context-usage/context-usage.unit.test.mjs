import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { establishExpectedFromRaw } from "./establish-expected.mjs";
import {
  TurnEndedUsageMissingError,
  createEmptyMetrics,
  createTraceSink,
  processStreamEvent,
} from "./lib/collect-usage.mjs";
import {
  analyzeTraceSummary,
  classifyInefficiencies,
  classifyPolicyViolations,
  selectLatestSummariesByRunIndex,
  writeFindings,
} from "./lib/analyzer.mjs";
import { copyTaskFixtureToTemp } from "./lib/copy-sandbox.mjs";
import { repoRelativePath } from "./lib/live-env.mjs";
import {
  buildExpectedBaseline,
  compareObservedToExpectedUpper,
  computeVariableSamples,
  expectedUpperBound,
} from "./lib/expected.mjs";
import { summarizeMetric } from "./lib/calibration-stats.mjs";
import {
  assertPrototypeModel,
  parseModelArg,
  resolveOverheadBaselinePath,
  resolveSdkModelId,
} from "./lib/model.mjs";
import { normalizePath, stripTempSandboxPrefix } from "./lib/paths.mjs";
import {
  PROTOTYPE_MODELS,
  TASK_IDS,
  buildTaskPrompt,
  comboKey,
  getTaskSpec,
  resolveExpectedBaselinePath,
} from "./lib/tasks.mjs";

const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

test("model: resolveSdkModelId strips bracket qualifiers", () => {
  assert.equal(resolveSdkModelId("composer-2.5"), "composer-2.5");
  assert.equal(resolveSdkModelId("composer-2.5[fast=false]"), "composer-2.5");
});

test("model: prototype matrix rejects unknown models", () => {
  assert.equal(assertPrototypeModel("composer-2.5"), "composer-2.5");
  assert.throws(() => assertPrototypeModel("gpt-5.4-mini"), /prototype matrix/);
  assert.equal(parseModelArg(["--model", "gpt-5.5"]), "gpt-5.5");
});

test("model: overhead baseline path uses per-model file", () => {
  assert.equal(
    resolveOverheadBaselinePath(HARNESS_ROOT, "composer-2.5"),
    path.join(HARNESS_ROOT, "baselines", "overhead.composer-2.5.json"),
  );
});

test("tasks: TASK_IDS and PROTOTYPE_MODELS define 4-combination matrix", () => {
  assert.deepEqual(TASK_IDS, ["task-low", "task-high"]);
  assert.deepEqual(PROTOTYPE_MODELS, ["composer-2.5", "gpt-5.5"]);
  assert.equal(comboKey("task-low", "composer-2.5"), "task-low.composer-2.5");
});

test("tasks: getTaskSpec and buildTaskPrompt for both tasks", () => {
  const low = getTaskSpec("task-low");
  assert.equal(low.requiresWrites, false);
  assert.ok(low.readAllowlist.length >= 4);
  assert.match(buildTaskPrompt("task-low"), /task-low/);
  const high = getTaskSpec("task-high");
  assert.equal(high.requiresWrites, true);
  assert.ok(high.requiredOutputArtifacts.includes("work/99999_probe/task/answer.md"));
  assert.match(buildTaskPrompt("task-high"), /answer\.md/);
});

test("fixtures: task-low and task-high copy to temp with minimum file count", async () => {
  for (const taskId of TASK_IDS) {
    const dest = await copyTaskFixtureToTemp(taskId);
    assert.ok(dest.includes(`context-usage-${taskId}-`));
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

test("expected: computeVariableSamples subtracts overhead median", () => {
  assert.deepEqual(computeVariableSamples([10000, 12000], 4600), [5400, 7400]);
  assert.deepEqual(computeVariableSamples([3000], 5000), [0]);
});

test("expected: buildExpectedBaseline uses overhead plus variable upper bounds", () => {
  const overhead = summarizeMetric([4500, 4600, 4700, 4800, 4600, 4550, 4650, 4750]);
  const variableTotals = computeVariableSamples(
    [9000, 9500, 8800, 10200, 9100, 9300, 8900, 9800],
    overhead.median,
  );
  const baseline = buildExpectedBaseline({
    taskId: "task-low",
    model: "composer-2.5",
    overheadBaseline: { model: "composer-2.5", total_tokens: overhead },
    variableTotals,
  });
  const variable = baseline.variable;
  assert.equal(
    baseline.expected_total_tokens.upper_confidence_bound,
    expectedUpperBound(overhead, variable),
  );
  assert.ok(baseline.expected_total_tokens.upper_confidence_bound > overhead.median);
});

test("collect-usage: turn-ended without usage throws", () => {
  const metrics = createEmptyMetrics();
  assert.throws(
    () => processStreamEvent({ type: "turn-ended" }, metrics, []),
    TurnEndedUsageMissingError,
  );
});

test("collect-usage: trace sink writes ndjson and summary", () => {
  const traceDir = path.join(HARNESS_ROOT, "calibration", "traces");
  fs.mkdirSync(traceDir, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(traceDir, ".unit-test-"));
  const sink = createTraceSink({
    traceDir: tmp,
    combo: "task-low.composer-2.5",
    runIndex: 1,
    taskId: "task-low",
    model: "composer-2.5",
  });
  processStreamEvent(
    {
      type: "turn-ended",
      usage: { input_tokens: 100, output_tokens: 20, cache_read_tokens: 0, cache_write_tokens: 0 },
    },
    createEmptyMetrics(),
    [],
  );
  sink.onEvent({
    type: "tool_call",
    name: "read",
    args: { path: "docs/PRD.summary.md" },
  });
  const metrics = createEmptyMetrics();
  metrics.turn_count = 1;
  metrics.total_tokens = 120;
  const summary = sink.finish(metrics, ["docs/PRD.summary.md"]);
  assert.ok(fs.existsSync(sink.tracePath));
  assert.ok(fs.existsSync(sink.summaryPath));
  assert.equal(summary.trace_path, repoRelativePath(sink.tracePath));
  assert.equal(summary.turn_count, 1);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("analyzer: policy violations for forbidden and inbox notes", () => {
  const spec = getTaskSpec("task-low");
  const violations = classifyPolicyViolations({
    taskId: "task-low",
    summary: {
      tool_paths: ["docs/PRD.md", "lib/inbox/notes/private.md"],
      turn_count: 2,
      trace_records: [],
    },
  });
  assert.ok(violations.some((v) => v.kind === "forbidden_path_read"));
  assert.ok(violations.some((v) => v.kind === "inbox_notes_read"));
  assert.ok(spec.decoyPaths.includes("docs/PRD.md"));
});

test("analyzer: inefficiencies for duplicate, decoy, and excess turns", () => {
  const ineff = classifyInefficiencies({
    taskId: "task-low",
    summary: {
      tool_paths: ["docs/PRD.summary.md", "docs/PRD.summary.md", "docs/PRD.md"],
      turn_count: 99,
    },
  });
  assert.ok(ineff.some((i) => i.kind === "duplicate_read"));
  assert.ok(ineff.some((i) => i.kind === "decoy_read"));
  assert.ok(ineff.some((i) => i.kind === "excess_turns"));
});

test("analyzer: duplicate_read from createTraceSink summary with deduped tool_paths", () => {
  const traceDir = path.join(HARNESS_ROOT, "calibration", "traces");
  fs.mkdirSync(traceDir, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(traceDir, ".unit-test-"));
  const sink = createTraceSink({
    traceDir: tmp,
    combo: "task-low.composer-2.5",
    runIndex: 1,
    taskId: "task-low",
    model: "composer-2.5",
  });
  const dupPath = "docs/PRD.summary.md";
  sink.onEvent({ type: "tool_call", name: "read", args: { path: dupPath } });
  sink.onEvent({ type: "tool_call", name: "read", args: { path: dupPath } });
  const metrics = createEmptyMetrics();
  metrics.turn_count = 2;
  const summary = sink.finish(metrics, [dupPath]);
  assert.equal(summary.tool_paths?.length, 1);
  assert.ok(summary.trace_records.length >= 3);
  const finding = analyzeTraceSummary(summary);
  assert.ok(finding.inefficiencies.some((i) => i.kind === "duplicate_read"));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("analyzer: analyzeTraceSummary and writeFindings", () => {
  const summary = {
    task_id: "task-high",
    model: "gpt-5.5",
    run_index: 1,
    tool_paths: ["lib/internal/packages/demo-svc/handler.ts"],
    turn_count: 3,
    trace_records: [],
  };
  const finding = analyzeTraceSummary(summary);
  assert.equal(finding.task_id, "task-high");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "context-usage-findings-"));
  const out = writeFindings(tmp, "task-high.gpt-5.5", [finding]);
  assert.ok(fs.existsSync(out));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("tasks: task-high prompt forbids discovery and includes durable spec", () => {
  const high = getTaskSpec("task-high");
  assert.ok(high.readAllowlist.includes("lib/memory/features/token-economy-probe/spec.md"));
  assert.ok(high.requiredReadPaths.includes("lib/memory/features/token-economy-probe/spec.md"));
  const prompt = buildTaskPrompt("task-high");
  assert.match(prompt, /Do NOT use discovery tools/i);
  assert.match(prompt, /read each exactly once/i);
  assert.match(prompt, /token-economy-probe\/spec\.md/);
});

test("paths: stripTempSandboxPrefix reports fixture-relative paths", () => {
  const tempPath =
    "var/folders/_m/bnsbbl5s4bl8t0hrt3p5k3kc0000gn/T/context-usage-task-high-FFXHkK/lib/memory/handbook/routing.md";
  assert.equal(stripTempSandboxPrefix(tempPath), "lib/memory/handbook/routing.md");
  assert.equal(normalizePath("docs/PRD.summary.md"), "docs/PRD.summary.md");
});

test("expected: compareObservedToExpectedUpper pass and exceedance", () => {
  const baseline = {
    expected_total_tokens: { upper_confidence_bound: 10000 },
  };
  const pass = compareObservedToExpectedUpper({
    taskId: "task-low",
    model: "composer-2.5",
    observedTotal: 9000,
    runIndex: 1,
    expectedBaseline: baseline,
  });
  assert.equal(pass.status, "pass");
  assert.equal(pass.exceeded, false);
  const exceed = compareObservedToExpectedUpper({
    taskId: "task-high",
    model: "gpt-5.5",
    observedTotal: 15000,
    runIndex: 3,
    expectedBaseline: baseline,
  });
  assert.equal(exceed.status, "exceedance");
  assert.equal(exceed.exceeded, true);
  assert.equal(exceed.expected_upper, 10000);
});

test("analyzer: selectLatestSummariesByRunIndex keeps newest trace per run", () => {
  const selected = selectLatestSummariesByRunIndex([
    {
      name: "run-1-2026-06-03T22-54-11-607Z.summary.json",
      summary: { run_index: 1, model: "composer-2.5" },
    },
    {
      name: "run-1-2026-06-04T05-51-26-747Z.summary.json",
      summary: { run_index: 1, model: "composer-2.5" },
    },
    {
      name: "run-2-2026-06-04T05-51-30-637Z.summary.json",
      summary: { run_index: 2, model: "composer-2.5" },
    },
  ]);
  assert.equal(selected.length, 2);
  assert.equal(selected[0].run_index, 1);
  assert.equal(selected[1].run_index, 2);
});

test("analyzer: duplicate_read paths normalized from temp sandbox prefix", () => {
  const tempPath =
    "var/folders/_m/bnsbbl5s4bl8t0hrt3p5k3kc0000gn/T/context-usage-task-high-abc/lib/memory/active/current.md";
  const ineff = classifyInefficiencies({
    taskId: "task-high",
    summary: {
      tool_paths: [],
      turn_count: 2,
      trace_records: [
        { type: "tool_call", name: "read", paths: [tempPath] },
        { type: "tool_call", name: "read", paths: [tempPath] },
      ],
    },
  });
  const dup = ineff.find((i) => i.kind === "duplicate_read");
  assert.ok(dup);
  assert.equal(dup.path, "lib/memory/active/current.md");
});

test("establishExpectedFromRaw: throws when raw file is missing", () => {
  assert.throws(
    () => establishExpectedFromRaw(["--raw", path.join(os.tmpdir(), "missing-matrix-samples.json")]),
    /missing calibration raw file/,
  );
});

test("establishExpectedFromRaw: committed expected baselines match formula", () => {
  for (const taskId of TASK_IDS) {
    for (const model of PROTOTYPE_MODELS) {
      const expectedPath = resolveExpectedBaselinePath(HARNESS_ROOT, taskId, model);
      const payload = JSON.parse(fs.readFileSync(expectedPath, "utf8"));
      assert.equal(
        payload.expected_total_tokens.upper_confidence_bound,
        expectedUpperBound(payload.overhead, payload.variable),
      );
    }
  }
});

test("paths: normalizePath", () => {
  assert.equal(normalizePath(".\\docs\\PRD.summary.md"), "docs/PRD.summary.md");
});

test("baselines: committed prototype baseline files exist", () => {
  for (const model of PROTOTYPE_MODELS) {
    assert.ok(fs.existsSync(resolveOverheadBaselinePath(HARNESS_ROOT, model)));
  }
  for (const taskId of TASK_IDS) {
    for (const model of PROTOTYPE_MODELS) {
      assert.ok(fs.existsSync(resolveExpectedBaselinePath(HARNESS_ROOT, taskId, model)));
    }
  }
});
