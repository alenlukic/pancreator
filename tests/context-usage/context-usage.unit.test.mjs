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
  compareToBaseline,
  exceedsThreshold,
  buildBaselineFromSamples,
  computeFixtureHash,
} from "./lib/stats.mjs";
import { copySandboxToTemp } from "./lib/copy-sandbox.mjs";
import { normalizePath, promptMentionsForbiddenPrd } from "./lib/expected.mjs";
import { loadRepoEnv, resolveHarnessRepoRoot } from "./lib/live-env.mjs";
import { resolveSdkModelId } from "./lib/model.mjs";

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

test("copy-sandbox: copies non-empty fixture tree to temp", async () => {
  const dest = await copySandboxToTemp();
  assert.ok(dest.includes("context-usage-sandbox-"));
});

test("stats: within 3-sigma passes comparison", () => {
  assert.equal(exceedsThreshold(100, 100, 10, 5, "input_tokens"), false);
});

test("stats: metric spike beyond 3-sigma fails", () => {
  assert.equal(exceedsThreshold(200, 100, 10, 5, "input_tokens"), true);
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

test("verify-run: forbidden path fails", () => {
  const result = verifyRun({
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

test("compareToBaseline: simulated spike beyond 3-sigma fails", () => {
  const samples = [createEmptyMetrics(), createEmptyMetrics(), createEmptyMetrics()];
  samples[0].input_tokens = 100;
  samples[1].input_tokens = 110;
  samples[2].input_tokens = 120;
  for (const m of samples) {
    m.output_tokens = 50;
    m.cache_read_tokens = 0;
    m.cache_write_tokens = 0;
    m.total_tokens = m.input_tokens + m.output_tokens;
    m.duration_ms = 5000;
    m.turn_count = 3;
    m.tool_read_count = 10;
  }
  const fixtureHash = computeFixtureHash();
  const baseline = buildBaselineFromSamples(samples, {
    fixture_hash: fixtureHash,
    prompt_version: "1",
    samples: 3,
  });
  const observed = createEmptyMetrics();
  Object.assign(observed, samples[1]);
  observed.input_tokens = 500;
  const cmp = compareToBaseline(observed, baseline);
  assert.equal(cmp.ok, false);
  assert.ok(cmp.errors.some((e) => e.includes("input_tokens")));
});

test("package.json: root test script excludes live harness entry points", () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const testScript = pkg.scripts?.test ?? "";
  assert.match(testScript, /node --test/);
  assert.doesNotMatch(testScript, /run-live\.mjs|establish-baseline\.mjs/);
});
