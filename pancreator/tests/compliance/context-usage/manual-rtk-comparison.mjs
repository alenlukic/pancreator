#!/usr/bin/env node
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  assertUsageCaptured,
  createEmptyMetrics,
  drainRunStream,
  processStreamEvent,
} from "./lib/collect-usage.mjs";
import { repoRelativePath, requireLiveEnv, resolveHarnessRepoRoot } from "./lib/live-env.mjs";
import { ensureCursorSdkRipgrepConfigured } from "./lib/ripgrep.mjs";
import { stringifyRepoJson } from "../../../lib/internal/tools/format/canonical-json-format.mjs";

const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = resolveHarnessRepoRoot();
const RAW_DIR = path.join(HARNESS_ROOT, "calibration", "raw");
const FIXED_TURN_INVOCATIONS = 5;
const MAX_SCENARIO_ATTEMPTS = 3;
const DONE_MARKERS = {
  plain: "BENCHMARK_PLAIN_DONE",
  rtk: "BENCHMARK_RTK_DONE",
};
const BENCH_DIR = ".work/rtk-bench";
const BENCH_ARTIFACTS = {
  candidates: `${BENCH_DIR}/candidates.json`,
  extracts: `${BENCH_DIR}/extracts.json`,
  comparisons: `${BENCH_DIR}/comparisons.json`,
  mutationResult: `${BENCH_DIR}/mutation-result.json`,
  finalReport: `${BENCH_DIR}/final-report.json`,
};

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {{ runs: number; model: string; debugStream: boolean }} */
  const out = {
    runs: 3,
    model: "auto",
    debugStream: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--debug-stream") {
      out.debugStream = true;
      continue;
    }
    if (arg === "--runs" && argv[i + 1]) {
      out.runs = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith("--runs=")) {
      out.runs = Number(arg.slice("--runs=".length));
      continue;
    }
    if (arg === "--model" && argv[i + 1]) {
      out.model = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith("--model=")) {
      out.model = arg.slice("--model=".length);
    }
  }
  if (!Number.isInteger(out.runs) || out.runs <= 0) {
    throw new Error("[context-usage] --runs must be a positive integer");
  }
  return out;
}

/**
 * @param {string} model
 */
function normalizeModelForFilename(model) {
  return model.replace(/[^a-z0-9._-]+/giu, "-").replace(/-+/gu, "-");
}

/**
 * @param {number[]} values
 */
function summarize(values) {
  if (values.length === 0) {
    return { n: 0, mean: 0, min: 0, max: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, value) => acc + value, 0);
  return {
    n: sorted.length,
    mean: sum / sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

function ensureRtkAvailable() {
  const probe = spawnSync("rtk", ["--help"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (probe.status !== 0) {
    throw new Error(
      "[context-usage] rtk not found on PATH. Install RTK before running rtk comparison.",
    );
  }
}

/**
 * @param {string} command
 * @param {string} cwd
 */
function runCommandOrThrow(command, cwd) {
  const result = spawnSync("bash", ["-lc", command], {
    cwd,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `[context-usage] setup command failed (${command}): ${result.stderr || result.stdout}`,
    );
  }
}

/**
 * @param {{ mode: "plain"|"rtk"; runIndex: number; attempt: number }} input
 */
export function createSyntheticSandbox(input) {
  const sandboxId = [
    "context-usage-rtk-compare",
    input.mode,
    `run-${input.runIndex}`,
    `attempt-${input.attempt}`,
    randomUUID(),
  ].join("-");
  const sandboxRoot = path.join(os.tmpdir(), sandboxId);
  const workRoot = path.join(sandboxRoot, "work");
  const remoteRoot = path.join(sandboxRoot, "remote.git");
  fs.mkdirSync(path.join(workRoot, "synthetic"), { recursive: true });
  fs.mkdirSync(path.join(workRoot, ".work", "results"), { recursive: true });
  fs.mkdirSync(path.join(workRoot, BENCH_DIR), { recursive: true });
  const writeSyntheticFile = (relativePath, content) => {
    const absolutePath = path.join(workRoot, "synthetic", relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content, "utf8");
  };

  writeSyntheticFile(
    "docs/architecture.md",
    [
      "# Synthetic Platform Architecture",
      "",
      "Primary auth token: AUTH_TOKEN_ALPHA",
      "Stage marker: HANDOFF_STAGE_IMPLEMENT",
      "Rate limit key: RATE_LIMIT_WINDOW_MS",
      "",
      "This benchmark simulates a medium-sized service mono-repo with noisy decoys.",
    ].join("\n"),
  );
  writeSyntheticFile(
    "docs/runbook.md",
    [
      "# Synthetic Runbook",
      "",
      "Use gateway routes for ingress and payments ledger for durable accounting.",
      "Legacy fallback routes are prefixed by LEGACY_ROUTE_.",
    ].join("\n"),
  );
  writeSyntheticFile(
    "docs/agent-notes.md",
    "mode=seed;alpha_hits=0;ts_files=0\n",
  );

  writeSyntheticFile(
    "services/gateway/src/auth.ts",
    [
      "export const AUTH_TOKEN_ALPHA = \"AUTH_TOKEN_ALPHA\";",
      "export const RATE_LIMIT_WINDOW_MS = 15000;",
      "",
      "export function validateAuthHeader(value: string): boolean {",
      "  return value.includes(AUTH_TOKEN_ALPHA);",
      "}",
    ].join("\n"),
  );
  writeSyntheticFile(
    "services/gateway/src/auth.backup.ts",
    [
      "export const AUTH_TOKEN_ALPHA = \"AUTH_TOKEN_ALPHA\";",
      "export const RATE_LIMIT_WINDOW_MS = 5000;",
      "",
      "export function validateAuthHeader(value: string): boolean {",
      "  return value.startsWith(\"legacy-\");",
      "}",
    ].join("\n"),
  );
  writeSyntheticFile(
    "services/gateway/src/router.ts",
    [
      "export const HANDOFF_STAGE_IMPLEMENT = \"implement\";",
      "export const ROUTES = [\"/healthz\", \"/v1/payments\", \"/v1/notifications\"];",
      "",
      "export function routeFor(path: string): string {",
      "  return ROUTES.includes(path) ? path : \"LEGACY_ROUTE_FALLBACK\";",
      "}",
    ].join("\n"),
  );
  writeSyntheticFile(
    "services/payments/src/ledger.ts",
    [
      "export function ledgerAnchor(): string {",
      "  return \"ledger:AUTH_TOKEN_ALPHA:stable\";",
      "}",
      "",
      "export function ledgerWindowMs(): number {",
      "  return 30000;",
      "}",
    ].join("\n"),
  );
  writeSyntheticFile(
    "services/notifications/src/dispatch.ts",
    [
      "export function dispatchTemplate(id: string): string {",
      "  return `dispatch:${id}:AUTH_TOKEN_ALPHA`;",
      "}",
    ].join("\n"),
  );
  writeSyntheticFile(
    "config/flags.json",
    JSON.stringify(
      {
        service: "synthetic-gateway",
        defaults: { RATE_LIMIT_WINDOW_MS: 15000, HANDOFF_STAGE_IMPLEMENT: true },
      },
      null,
      2,
    ),
  );
  writeSyntheticFile(
    "config/routes.yaml",
    [
      "routes:",
      "  - /v1/payments",
      "  - /v1/notifications",
      "  - LEGACY_ROUTE_PAYMENTS",
    ].join("\n"),
  );
  writeSyntheticFile(
    "tests/gateway.auth.test.ts",
    [
      "import { validateAuthHeader } from \"../services/gateway/src/auth\";",
      "",
      "describe(\"gateway auth\", () => {",
      "  it(\"accepts alpha token\", () => {",
      "    expect(validateAuthHeader(\"x-AUTH_TOKEN_ALPHA-y\")).toBe(true);",
      "  });",
      "});",
    ].join("\n"),
  );

  for (let i = 1; i <= 120; i += 1) {
    const padded = String(i).padStart(3, "0");
    writeSyntheticFile(
      `services/generated/src/module-${padded}.ts`,
      [
        `export const module${padded} = "DECOY_MODULE_${padded}";`,
        `export function marker${padded}(): string {`,
        `  return "LEGACY_ROUTE_${padded}";`,
        "}",
      ].join("\n"),
    );
  }
  for (let i = 1; i <= 80; i += 1) {
    const padded = String(i).padStart(3, "0");
    writeSyntheticFile(
      `docs/decoys/note-${padded}.md`,
      [
        `# Decoy ${padded}`,
        "",
        `DECOY_NOTE_${padded} should not influence benchmark answers.`,
      ].join("\n"),
    );
  }

  runCommandOrThrow("git init -b main", workRoot);
  runCommandOrThrow('git config user.name "RTK Harness"', workRoot);
  runCommandOrThrow('git config user.email "rtk-harness@example.invalid"', workRoot);
  runCommandOrThrow("git add .", workRoot);
  runCommandOrThrow('git commit -m "seed synthetic benchmark repo"', workRoot);
  runCommandOrThrow(`git init --bare "${remoteRoot}"`, sandboxRoot);
  runCommandOrThrow(`git remote add origin "${remoteRoot}"`, workRoot);
  runCommandOrThrow("git push -u origin main", workRoot);
  return { sandboxId, sandboxRoot, workRoot, remoteRoot };
}

/**
 * @param {string} mode
 */
function turn1BuildCandidatesScript(mode) {
  return `node -e 'const fs=require("node:fs");const path=require("node:path");const walk=(dir)=>{let files=[];for (const entry of fs.readdirSync(dir,{withFileTypes:true})){const abs=path.join(dir,entry.name);if(entry.isDirectory()) files=files.concat(walk(abs)); else if(entry.isFile()) files.push(abs.replace(/\\\\/g,\"/\"));}return files;};const ts=walk(\"synthetic\").filter((p)=>p.endsWith(\".ts\"));const hits=fs.readFileSync("${BENCH_DIR}/discovery-hits.txt","utf8").split(/\\r?\\n/).map((l)=>l.trim()).filter(Boolean);const preferred=[\"synthetic/services/gateway/src/auth.ts\",\"synthetic/services/gateway/src/router.ts\",\"synthetic/services/payments/src/ledger.ts\"];const focused=preferred.filter((p)=>fs.existsSync(p));const payload={mode:\"${mode}\",focused_paths:focused,total_ts_files:ts.length,discovery_hit_count:hits.length};fs.writeFileSync("${BENCH_ARTIFACTS.candidates}",JSON.stringify(payload,null,2)+\"\\n\");'`;
}

function turn2BuildExtractsScript() {
  return `node -e 'const fs=require("node:fs");const candidates=JSON.parse(fs.readFileSync("${BENCH_ARTIFACTS.candidates}","utf8"));const extracts=candidates.focused_paths.map((p)=>{const text=fs.readFileSync(p,"utf8");return{path:p,alpha_hits:(text.match(/AUTH_TOKEN_ALPHA/g)||[]).length,has_stage:text.includes("HANDOFF_STAGE_IMPLEMENT"),has_rate_limit:text.includes("RATE_LIMIT_WINDOW_MS"),line_count:text.split(/\\r?\\n/).length};});const payload={mode:candidates.mode,focused_paths:candidates.focused_paths,total_ts_files:candidates.total_ts_files,discovery_hit_count:candidates.discovery_hit_count,extracts};fs.writeFileSync("${BENCH_ARTIFACTS.extracts}",JSON.stringify(payload,null,2)+"\\n");'`;
}

function turn3BuildComparisonsScript() {
  return `node -e 'const fs=require("node:fs");const extracts=JSON.parse(fs.readFileSync("${BENCH_ARTIFACTS.extracts}","utf8"));const alphaHitCount=extracts.extracts.reduce((acc,item)=>acc+item.alpha_hits,0);const authPath="synthetic/services/gateway/src/auth.ts";const authBackupPath="synthetic/services/gateway/src/auth.backup.ts";const filesDiffer=fs.readFileSync(authPath,"utf8")!==fs.readFileSync(authBackupPath,"utf8");const routerRecord=extracts.extracts.find((item)=>item.path.includes("/router.ts"))||null;const ledgerRecord=extracts.extracts.find((item)=>item.path.includes("/ledger.ts"))||null;const payload={mode:extracts.mode,total_ts_files:extracts.total_ts_files,alpha_hit_count:alphaHitCount,files_differ:filesDiffer,router_has_stage:Boolean(routerRecord&&routerRecord.has_stage),ledger_has_alpha:Boolean(ledgerRecord&&ledgerRecord.alpha_hits>0)};fs.writeFileSync("${BENCH_ARTIFACTS.comparisons}",JSON.stringify(payload,null,2)+"\\n");'`;
}

/**
 * @param {"plain"|"rtk"} mode
 */
function turn4BuildMutationScript(mode) {
  return `node -e 'const fs=require("node:fs");const comparisons=JSON.parse(fs.readFileSync("${BENCH_ARTIFACTS.comparisons}","utf8"));const noteLine="mode=${mode};alpha_hits="+comparisons.alpha_hit_count+";ts_files="+comparisons.total_ts_files+";router_stage="+String(comparisons.router_has_stage);fs.appendFileSync("synthetic/docs/agent-notes.md",noteLine+"\\n");const payload={mode:comparisons.mode,total_ts_files:comparisons.total_ts_files,alpha_hit_count:comparisons.alpha_hit_count,files_differ:comparisons.files_differ,router_has_stage:comparisons.router_has_stage,ledger_has_alpha:comparisons.ledger_has_alpha,note_line:noteLine};fs.writeFileSync("${BENCH_ARTIFACTS.mutationResult}",JSON.stringify(payload,null,2)+"\\n");'`;
}

/**
 * @param {"plain"|"rtk"} mode
 */
function turn5BuildFinalReportScript(mode) {
  return `node -e 'const fs=require("node:fs");const mutation=JSON.parse(fs.readFileSync("${BENCH_ARTIFACTS.mutationResult}","utf8"));const payload={mode:"${mode}",ts_file_count:mutation.total_ts_files,alpha_hit_count:mutation.alpha_hit_count,files_differ:mutation.files_differ,stateful_chain_complete:Boolean(mutation.router_has_stage&&mutation.ledger_has_alpha),note_line:mutation.note_line};fs.writeFileSync("${BENCH_ARTIFACTS.finalReport}",JSON.stringify(payload,null,2)+"\\n");'`;
}

/**
 * @param {{ mode: "plain"|"rtk"; runIndex: number }} input
 */
function buildFixedCommandPlan(input) {
  if (input.mode === "plain") {
    return [
      `mkdir -p "${BENCH_DIR}" && ls -R synthetic/services synthetic/docs synthetic/config synthetic/tests && find synthetic -type f -name "*.ts" | sort > "${BENCH_DIR}/all-ts.txt" && rg -n "AUTH_TOKEN_ALPHA|HANDOFF_STAGE_IMPLEMENT|RATE_LIMIT_WINDOW_MS" synthetic > "${BENCH_DIR}/discovery-hits.txt" && ${turn1BuildCandidatesScript("plain")}`,
      `test -f "${BENCH_ARTIFACTS.candidates}" && paths=$(node -e 'const fs=require("node:fs");const data=JSON.parse(fs.readFileSync("${BENCH_ARTIFACTS.candidates}","utf8"));for (const p of data.focused_paths) console.log(p);') && : > "${BENCH_DIR}/reads.txt" && while IFS= read -r p; do [ -n "$p" ] || continue; sed -n "1,180p" "$p" >> "${BENCH_DIR}/reads.txt"; printf "\\n-----\\n" >> "${BENCH_DIR}/reads.txt"; done <<< "$paths" && ${turn2BuildExtractsScript()}`,
      `test -f "${BENCH_ARTIFACTS.extracts}" && ${turn3BuildComparisonsScript()} && cat "${BENCH_ARTIFACTS.comparisons}"`,
      `test -f "${BENCH_ARTIFACTS.comparisons}" && ${turn4BuildMutationScript("plain")} && git status --short && git diff -- synthetic/docs/agent-notes.md`,
      `test -f "${BENCH_ARTIFACTS.mutationResult}" && ${turn5BuildFinalReportScript("plain")} && cat "${BENCH_ARTIFACTS.finalReport}" && echo ${DONE_MARKERS.plain}`,
    ];
  }

  return [
    `mkdir -p "${BENCH_DIR}" && rtk ls synthetic && rtk find "*.ts" synthetic > "${BENCH_DIR}/all-ts.txt" && rtk grep "AUTH_TOKEN_ALPHA|HANDOFF_STAGE_IMPLEMENT|RATE_LIMIT_WINDOW_MS" synthetic --ultra-compact > "${BENCH_DIR}/discovery-hits.txt" && ${turn1BuildCandidatesScript("rtk")}`,
    `test -f "${BENCH_ARTIFACTS.candidates}" && paths=$(node -e 'const fs=require("node:fs");const data=JSON.parse(fs.readFileSync("${BENCH_ARTIFACTS.candidates}","utf8"));for (const p of data.focused_paths) console.log(p);') && : > "${BENCH_DIR}/reads.txt" && while IFS= read -r p; do [ -n "$p" ] || continue; rtk read "$p" -l aggressive >> "${BENCH_DIR}/reads.txt"; printf "\\n-----\\n" >> "${BENCH_DIR}/reads.txt"; done <<< "$paths" && rtk smart synthetic/services/notifications/src/dispatch.ts && ${turn2BuildExtractsScript()}`,
    `test -f "${BENCH_ARTIFACTS.extracts}" && (rtk diff synthetic/services/gateway/src/auth.ts synthetic/services/gateway/src/auth.backup.ts >/dev/null || true) && ${turn3BuildComparisonsScript()} && cat "${BENCH_ARTIFACTS.comparisons}"`,
    `test -f "${BENCH_ARTIFACTS.comparisons}" && ${turn4BuildMutationScript("rtk")} && rtk git status && (rtk git diff || true)`,
    `test -f "${BENCH_ARTIFACTS.mutationResult}" && ${turn5BuildFinalReportScript("rtk")} && cat "${BENCH_ARTIFACTS.finalReport}" && echo ${DONE_MARKERS.rtk}`,
  ];
}

/**
 * @param {{ mode: "plain"|"rtk"; runIndex: number }} input
 */
export function buildTurnPrompts(input) {
  const commandPlan = buildFixedCommandPlan(input);
  const common = `
RTK benchmark scenario (mode=${input.mode}, run_index=${input.runIndex}).
Use only the shell tool.
For each turn, run exactly one shell command, exactly as written.
Do not run any extra commands.
Do not use read, edit, grep, rg, glob, search, or any non-shell tool.
Do not use commands outside this sandbox repository.
Do not recompute previous-turn work from repository-wide discovery.
Consume and update the .work/rtk-bench artifact chain across turns.
`.trim();

  return commandPlan.map((command, index) => {
    const turnNumber = index + 1;
    return `${common}\n\nTurn ${turnNumber} command (copy exactly):\n\`${command}\`\n\nAfter it completes, reply with JSON like {"turn":${turnNumber},"status":"ok"}.`;
  });
}

/**
 * @param {unknown} event
 */
function extractShellCommand(event) {
  if (!event || typeof event !== "object") {
    return null;
  }
  const record = /** @type {Record<string, unknown>} */ (event);
  if (String(record.type ?? "") !== "tool_call") {
    return null;
  }
  const name = String(record.name ?? "").toLowerCase();
  if (!/shell|bash|terminal/u.test(name)) {
    return null;
  }

  const candidates = [record.args, record.input];
  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      try {
        const parsed = JSON.parse(candidate);
        if (
          parsed &&
          typeof parsed === "object" &&
          typeof /** @type {{ command?: unknown }} */ (parsed).command === "string"
        ) {
          return /** @type {{ command: string }} */ (parsed).command;
        }
      } catch {
        // ignore non-JSON string args
      }
    }
    if (candidate && typeof candidate === "object") {
      const command = /** @type {{ command?: unknown }} */ (candidate).command;
      if (typeof command === "string") {
        return command;
      }
    }
  }
  return null;
}

function normalizeCommand(command) {
  return command.replace(/\s+/gu, " ").trim();
}

function sanitizeCommandForAudit(command) {
  return normalizeCommand(command).replace(
    /\bgit\s+commit\s+--trailer\s+"[^"]+"\s+-m\b/gu,
    "git commit -m",
  );
}

/**
 * @param {string[]} expectedCommands
 * @param {string[]} observedCommands
 */
export function evaluateFixedCommandPlan(expectedCommands, observedCommands) {
  const expected = expectedCommands.map((command) => sanitizeCommandForAudit(command));
  const observedRaw = observedCommands.map((command) => sanitizeCommandForAudit(command));
  const observed = [];
  for (const command of observedRaw) {
    if (observed.length > 0 && observed[observed.length - 1] === command) {
      continue;
    }
    observed.push(command);
  }
  /** @type {Array<{ turn: number; expected: string | null; observed: string | null }>} */
  const mismatches = [];
  const maxLength = Math.max(expected.length, observed.length);
  for (let index = 0; index < maxLength; index += 1) {
    const expectedCommand = expected[index] ?? null;
    const observedCommand = observed[index] ?? null;
    if (expectedCommand !== observedCommand) {
      mismatches.push({
        turn: index + 1,
        expected: expectedCommand,
        observed: observedCommand,
      });
    }
  }
  return {
    pass: mismatches.length === 0,
    expected_count: expected.length,
    observed_count: observed.length,
    mismatches,
    expected_commands: expected,
    observed_commands: observed,
  };
}

const REQUIRED_ARTIFACT_REFERENCE_BY_TURN = [
  null,
  BENCH_ARTIFACTS.candidates,
  BENCH_ARTIFACTS.extracts,
  BENCH_ARTIFACTS.comparisons,
  BENCH_ARTIFACTS.mutationResult,
];
const REDISCOVERY_PATTERNS = [
  /(^|[;&|]\s*)find\s+/u,
  /(^|[;&|]\s*)rg\s+/u,
  /(^|[;&|]\s*)rtk\s+find\s+/u,
  /(^|[;&|]\s*)rtk\s+grep\s+/u,
];

/**
 * @param {string[]} observedCommands
 */
export function evaluateStatefulDependencyAudit(observedCommands) {
  /** @type {Array<{ turn: number; artifact: string }>} */
  const missingArtifactRefs = [];
  /** @type {Array<{ turn: number; command: string; pattern: string }>} */
  const rediscoveryViolations = [];

  for (let turnIndex = 0; turnIndex < observedCommands.length; turnIndex += 1) {
    const turnNumber = turnIndex + 1;
    const command = observedCommands[turnIndex] ?? "";
    const requiredArtifact = REQUIRED_ARTIFACT_REFERENCE_BY_TURN[turnIndex] ?? null;
    if (requiredArtifact && !command.includes(requiredArtifact)) {
      missingArtifactRefs.push({ turn: turnNumber, artifact: requiredArtifact });
    }
    if (turnNumber >= 2) {
      for (const pattern of REDISCOVERY_PATTERNS) {
        if (pattern.test(command)) {
          rediscoveryViolations.push({
            turn: turnNumber,
            command,
            pattern: pattern.source,
          });
          break;
        }
      }
    }
  }

  return {
    pass: missingArtifactRefs.length === 0 && rediscoveryViolations.length === 0,
    missing_artifact_refs: missingArtifactRefs,
    rediscovery_violations: rediscoveryViolations,
  };
}

/**
 * @param {unknown} event
 */
function extractToolCallName(event) {
  if (!event || typeof event !== "object") {
    return null;
  }
  const record = /** @type {Record<string, unknown>} */ (event);
  if (String(record.type ?? "") !== "tool_call") {
    return null;
  }
  const name = String(record.name ?? "").trim();
  return name.length > 0 ? name : null;
}

/**
 * @param {string} toolName
 */
function isShellLikeToolName(toolName) {
  return /shell|bash|terminal/iu.test(toolName);
}

/**
 * @param {string[]} toolCallNames
 */
export function evaluateToolCallFidelity(toolCallNames) {
  const disallowed = toolCallNames.filter((toolName) => !isShellLikeToolName(toolName));
  return {
    disallowed,
    pass: disallowed.length === 0,
  };
}

/**
 * @param {import("./lib/collect-usage.mjs").UsageMetrics} total
 * @param {import("./lib/collect-usage.mjs").UsageMetrics} delta
 */
function mergeUsageMetrics(total, delta) {
  total.input_tokens += delta.input_tokens;
  total.output_tokens += delta.output_tokens;
  total.cache_read_tokens += delta.cache_read_tokens;
  total.cache_write_tokens += delta.cache_write_tokens;
  total.total_tokens += delta.total_tokens;
  total.duration_ms += delta.duration_ms;
  total.turn_count += delta.turn_count;
  total.tool_read_count += delta.tool_read_count;
}

/**
 * @param {number} turnNumber
 * @param {string} toolName
 * @param {"plain"|"rtk"} mode
 */
function logTurnStatus(turnNumber, toolName, mode) {
  console.log(`turn ${turnNumber}: running ${toolName} in ${mode} mode`);
}

/**
 * @param {number} turnNumber
 * @param {"plain"|"rtk"} mode
 */
function logTurnStart(turnNumber, mode) {
  console.log(`turn ${turnNumber}: sending prompt in ${mode} mode`);
}

/**
 * @param {unknown} reportData
 * @param {"plain"|"rtk"} mode
 */
export function validateScenarioReport(reportData, mode) {
  if (!reportData || typeof reportData !== "object" || Array.isArray(reportData)) {
    return "report JSON must be an object";
  }
  const record = /** @type {Record<string, unknown>} */ (reportData);
  if (record.mode !== mode) {
    return `report mode mismatch: expected ${mode}, got ${String(record.mode ?? "")}`;
  }
  if (!Number.isInteger(record.ts_file_count) || Number(record.ts_file_count) <= 0) {
    return "report ts_file_count must be a positive integer";
  }
  if (!Number.isInteger(record.alpha_hit_count) || Number(record.alpha_hit_count) < 0) {
    return "report alpha_hit_count must be a non-negative integer";
  }
  if (typeof record.files_differ !== "boolean") {
    return "report files_differ must be a boolean";
  }
  if (typeof record.stateful_chain_complete !== "boolean") {
    return "report stateful_chain_complete must be a boolean";
  }
  if (record.stateful_chain_complete !== true) {
    return "report stateful_chain_complete must be true";
  }
  if (typeof record.note_line !== "string" || record.note_line.trim().length === 0) {
    return "report note_line must be a non-empty string";
  }
  return null;
}

/**
 * @param {{ mode: "plain"|"rtk"; model: string; debugStream: boolean; runIndex: number }} input
 */
async function runScenario(input) {
  const { Agent } = await import("@cursor/sdk");
  const turnPrompts = buildTurnPrompts({
    mode: input.mode,
    runIndex: input.runIndex,
  });
  if (turnPrompts.length !== FIXED_TURN_INVOCATIONS) {
    throw new Error(
      `[context-usage] fixed turn count mismatch: expected ${FIXED_TURN_INVOCATIONS}, got ${turnPrompts.length}`,
    );
  }
  const expectedCommandPlan = buildFixedCommandPlan({
    mode: input.mode,
    runIndex: input.runIndex,
  });
  /** @type {Array<{ attempt: number; reason: string }>} */
  const discardedAttempts = [];

  for (let attempt = 1; attempt <= MAX_SCENARIO_ATTEMPTS; attempt += 1) {
    const sandbox = createSyntheticSandbox({
      mode: input.mode,
      runIndex: input.runIndex,
      attempt,
    });
    const agent = await Agent.create({
      apiKey: process.env.CURSOR_API_KEY,
      model: { id: input.model },
      local: { cwd: sandbox.workRoot, settingSources: ["project"] },
    });

    try {
      const shellCommands = [];
      const toolCallNames = [];
      const scenarioMetrics = createEmptyMetrics();
      /** @type {Array<{ turn: number; input_tokens: number; output_tokens: number; total_tokens: number }>} */
      const scenarioTurnMetrics = [];

      for (let turnIndex = 0; turnIndex < turnPrompts.length; turnIndex += 1) {
        const turnNumber = turnIndex + 1;
        const turnMetrics = createEmptyMetrics();
        const turnToolPaths = [];
        const turnPrompt = turnPrompts[turnIndex];
        const start = Date.now();
        const streamOptions = { debugStream: input.debugStream };
        logTurnStart(turnNumber, input.mode);

        const run = await agent.send(turnPrompt, {
          model: { id: input.model },
          onDelta: ({ update }) => {
            processStreamEvent(update, turnMetrics, turnToolPaths, streamOptions);
          },
        });
        await drainRunStream(run, {
          metrics: turnMetrics,
          toolPaths: turnToolPaths,
          wallStartMs: start,
          ...streamOptions,
          onEvent: (event) => {
            const command = extractShellCommand(event);
            if (command) {
              shellCommands.push(command);
            }
            const toolName = extractToolCallName(event);
            if (toolName) {
              toolCallNames.push(toolName);
              logTurnStatus(turnNumber, toolName, input.mode);
            }
          },
        });
        await run.wait();
        assertUsageCaptured(turnMetrics);
        mergeUsageMetrics(scenarioMetrics, turnMetrics);
        scenarioTurnMetrics.push({
          turn: turnNumber,
          input_tokens: turnMetrics.input_tokens,
          output_tokens: turnMetrics.output_tokens,
          total_tokens: turnMetrics.total_tokens,
        });
      }

      const toolCallAudit = evaluateToolCallFidelity(toolCallNames);
      if (!toolCallAudit.pass) {
        throw new Error(
          `non-shell tools used: ${toolCallAudit.disallowed.join(", ")}`,
        );
      }
      const commandPlanAudit = evaluateFixedCommandPlan(expectedCommandPlan, shellCommands);
      if (!commandPlanAudit.pass) {
        throw new Error(
          `command plan mismatch: ${JSON.stringify(commandPlanAudit.mismatches)}`,
        );
      }
      const statefulDependencyAudit = evaluateStatefulDependencyAudit(
        commandPlanAudit.observed_commands ?? shellCommands,
      );
      if (!statefulDependencyAudit.pass) {
        throw new Error(
          `stateful dependency mismatch: ${JSON.stringify(statefulDependencyAudit)}`,
        );
      }

      const reportPath = path.join(sandbox.workRoot, BENCH_ARTIFACTS.finalReport);
      if (!fs.existsSync(reportPath)) {
        throw new Error(`missing final report artifact at ${reportPath}`);
      }
      const reportText = fs.readFileSync(reportPath, "utf8").trim();
      let reportData = null;
      try {
        reportData = JSON.parse(reportText);
      } catch {
        throw new Error(`final report JSON parse failed: ${reportText}`);
      }
      const reportValidationError = validateScenarioReport(reportData, input.mode);
      if (reportValidationError) {
        throw new Error(`report validation failed: ${reportValidationError}`);
      }
      const accumulationWindow = scenarioTurnMetrics
        .filter((turnMetrics) => turnMetrics.turn >= 3)
        .reduce(
          (acc, turnMetrics) => {
            acc.input_tokens += turnMetrics.input_tokens;
            acc.output_tokens += turnMetrics.output_tokens;
            acc.total_tokens += turnMetrics.total_tokens;
            return acc;
          },
          { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
        );

      return {
        mode: input.mode,
        run_index: input.runIndex,
        attempt,
        scenario_id: sandbox.sandboxId,
        discarded_attempts: discardedAttempts,
        sandbox_path: sandbox.sandboxRoot,
        report_data: reportData,
        metrics: scenarioMetrics,
        turn_metrics: scenarioTurnMetrics,
        accumulation_window: accumulationWindow,
        explicit_turn_invocations: turnPrompts.length,
        shell_commands: shellCommands,
        command_plan_expected: expectedCommandPlan,
        command_plan_audit: commandPlanAudit,
        stateful_dependency_audit: statefulDependencyAudit,
        tool_call_fidelity: toolCallAudit,
        tool_call_names: toolCallNames,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      discardedAttempts.push({ attempt, reason });
      if (attempt === MAX_SCENARIO_ATTEMPTS) {
        throw new Error(
          `[context-usage] scenario failed after ${MAX_SCENARIO_ATTEMPTS} attempts (${input.mode} run ${input.runIndex}): ${reason}; discarded=${JSON.stringify(discardedAttempts)}`,
        );
      }
    } finally {
      await agent.close();
      fs.rmSync(sandbox.sandboxRoot, { recursive: true, force: true });
    }
  }

  throw new Error("[context-usage] scenario exhausted attempts unexpectedly");
}

/**
 * @param {string[]} argv
 */
export async function runManualRtkComparison(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  ensureRtkAvailable();
  if (!ensureCursorSdkRipgrepConfigured(REPO_ROOT)) {
    throw new Error("[context-usage] ripgrep binary not found.");
  }

  const tokenTotals = {
    plain: {
      input_tokens: [],
      output_tokens: [],
      total_tokens: [],
      accumulation_input_tokens: [],
      accumulation_output_tokens: [],
      accumulation_total_tokens: [],
    },
    rtk: {
      input_tokens: [],
      output_tokens: [],
      total_tokens: [],
      accumulation_input_tokens: [],
      accumulation_output_tokens: [],
      accumulation_total_tokens: [],
    },
  };
  /** @type {Array<Record<string, unknown>>} */
  const iterations = [];
  /** @type {Array<Record<string, unknown>>} */
  const runDetails = [];

  for (let runIndex = 1; runIndex <= args.runs; runIndex += 1) {
    console.log(`[context-usage] rtk-compare run ${runIndex}/${args.runs}: plain`);
    const plain = await runScenario({
      mode: "plain",
      model: args.model,
      debugStream: args.debugStream,
      runIndex,
    });
    tokenTotals.plain.input_tokens.push(plain.metrics.input_tokens);
    tokenTotals.plain.output_tokens.push(plain.metrics.output_tokens);
    tokenTotals.plain.total_tokens.push(plain.metrics.total_tokens);
    tokenTotals.plain.accumulation_input_tokens.push(plain.accumulation_window.input_tokens);
    tokenTotals.plain.accumulation_output_tokens.push(plain.accumulation_window.output_tokens);
    tokenTotals.plain.accumulation_total_tokens.push(plain.accumulation_window.total_tokens);
    const plainDetail = {
      run_index: runIndex,
      mode: "plain",
      scenario_id: plain.scenario_id,
      attempt: plain.attempt,
      discarded_attempts: plain.discarded_attempts ?? [],
      input_tokens: plain.metrics.input_tokens,
      output_tokens: plain.metrics.output_tokens,
      total_tokens: plain.metrics.total_tokens,
      accumulation_window: plain.accumulation_window,
      turn_count: plain.metrics.turn_count,
      explicit_turn_invocations: plain.explicit_turn_invocations,
      shell_command_count: plain.shell_commands.length,
      command_plan_mismatches: plain.command_plan_audit?.mismatches ?? [],
      stateful_dependency_issues: plain.stateful_dependency_audit?.missing_artifact_refs ?? [],
      stateful_rediscovery_issues:
        plain.stateful_dependency_audit?.rediscovery_violations ?? [],
      non_shell_tool_calls: plain.tool_call_fidelity?.disallowed ?? [],
      report_data: plain.report_data ?? null,
    };
    runDetails.push(plainDetail);

    console.log(`[context-usage] rtk-compare run ${runIndex}/${args.runs}: rtk`);
    const rtk = await runScenario({
      mode: "rtk",
      model: args.model,
      debugStream: args.debugStream,
      runIndex,
    });
    tokenTotals.rtk.input_tokens.push(rtk.metrics.input_tokens);
    tokenTotals.rtk.output_tokens.push(rtk.metrics.output_tokens);
    tokenTotals.rtk.total_tokens.push(rtk.metrics.total_tokens);
    tokenTotals.rtk.accumulation_input_tokens.push(rtk.accumulation_window.input_tokens);
    tokenTotals.rtk.accumulation_output_tokens.push(rtk.accumulation_window.output_tokens);
    tokenTotals.rtk.accumulation_total_tokens.push(rtk.accumulation_window.total_tokens);
    const rtkDetail = {
      run_index: runIndex,
      mode: "rtk",
      scenario_id: rtk.scenario_id,
      attempt: rtk.attempt,
      discarded_attempts: rtk.discarded_attempts ?? [],
      input_tokens: rtk.metrics.input_tokens,
      output_tokens: rtk.metrics.output_tokens,
      total_tokens: rtk.metrics.total_tokens,
      accumulation_window: rtk.accumulation_window,
      turn_count: rtk.metrics.turn_count,
      explicit_turn_invocations: rtk.explicit_turn_invocations,
      shell_command_count: rtk.shell_commands.length,
      command_plan_mismatches: rtk.command_plan_audit?.mismatches ?? [],
      stateful_dependency_issues: rtk.stateful_dependency_audit?.missing_artifact_refs ?? [],
      stateful_rediscovery_issues:
        rtk.stateful_dependency_audit?.rediscovery_violations ?? [],
      non_shell_tool_calls: rtk.tool_call_fidelity?.disallowed ?? [],
      report_data: rtk.report_data ?? null,
    };
    runDetails.push(rtkDetail);
    iterations.push({
      run_index: runIndex,
      plain: plainDetail,
      rtk: rtkDetail,
    });
  }

  const plainSummary = {
    input_tokens: summarize(tokenTotals.plain.input_tokens),
    output_tokens: summarize(tokenTotals.plain.output_tokens),
    total_tokens: summarize(tokenTotals.plain.total_tokens),
    accumulation_window: {
      input_tokens: summarize(tokenTotals.plain.accumulation_input_tokens),
      output_tokens: summarize(tokenTotals.plain.accumulation_output_tokens),
      total_tokens: summarize(tokenTotals.plain.accumulation_total_tokens),
    },
  };
  const rtkSummary = {
    input_tokens: summarize(tokenTotals.rtk.input_tokens),
    output_tokens: summarize(tokenTotals.rtk.output_tokens),
    total_tokens: summarize(tokenTotals.rtk.total_tokens),
    accumulation_window: {
      input_tokens: summarize(tokenTotals.rtk.accumulation_input_tokens),
      output_tokens: summarize(tokenTotals.rtk.accumulation_output_tokens),
      total_tokens: summarize(tokenTotals.rtk.accumulation_total_tokens),
    },
  };
  const meanDelta = {
    input_tokens: rtkSummary.input_tokens.mean - plainSummary.input_tokens.mean,
    output_tokens: rtkSummary.output_tokens.mean - plainSummary.output_tokens.mean,
    total_tokens: rtkSummary.total_tokens.mean - plainSummary.total_tokens.mean,
    accumulation_input_tokens:
      rtkSummary.accumulation_window.input_tokens.mean -
      plainSummary.accumulation_window.input_tokens.mean,
    accumulation_output_tokens:
      rtkSummary.accumulation_window.output_tokens.mean -
      plainSummary.accumulation_window.output_tokens.mean,
    accumulation_total_tokens:
      rtkSummary.accumulation_window.total_tokens.mean -
      plainSummary.accumulation_window.total_tokens.mean,
  };
  const meanDeltaPercent = {
    input_tokens:
      plainSummary.input_tokens.mean === 0
        ? null
        : (meanDelta.input_tokens / plainSummary.input_tokens.mean) * 100,
    output_tokens:
      plainSummary.output_tokens.mean === 0
        ? null
        : (meanDelta.output_tokens / plainSummary.output_tokens.mean) * 100,
    total_tokens:
      plainSummary.total_tokens.mean === 0
        ? null
        : (meanDelta.total_tokens / plainSummary.total_tokens.mean) * 100,
    accumulation_input_tokens:
      plainSummary.accumulation_window.input_tokens.mean === 0
        ? null
        : (meanDelta.accumulation_input_tokens / plainSummary.accumulation_window.input_tokens.mean) *
          100,
    accumulation_output_tokens:
      plainSummary.accumulation_window.output_tokens.mean === 0
        ? null
        : (meanDelta.accumulation_output_tokens /
            plainSummary.accumulation_window.output_tokens.mean) *
          100,
    accumulation_total_tokens:
      plainSummary.accumulation_window.total_tokens.mean === 0
        ? null
        : (meanDelta.accumulation_total_tokens /
            plainSummary.accumulation_window.total_tokens.mean) *
          100,
  };

  const output = {
    schema_version: 3,
    generated_at: new Date().toISOString(),
    model: args.model,
    runs: args.runs,
    token_totals: tokenTotals,
    iterations,
    summary: {
      plain: plainSummary,
      rtk: rtkSummary,
      mean_delta: meanDelta,
      mean_delta_percent: meanDeltaPercent,
      interpretation:
        meanDelta.output_tokens < 0
          ? "rtk used fewer output tokens on average"
          : meanDelta.output_tokens > 0
            ? "rtk used more output tokens on average"
            : "no average output token difference observed",
    },
    run_details: runDetails,
  };

  fs.mkdirSync(RAW_DIR, { recursive: true });
  const latestPath = path.join(RAW_DIR, "rtk-vs-plain.latest.json");
  const timestamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const timestampedPath = path.join(
    RAW_DIR,
    `rtk-vs-plain.${normalizeModelForFilename(args.model)}.${timestamp}.json`,
  );
  fs.writeFileSync(latestPath, stringifyRepoJson(output, REPO_ROOT));
  fs.writeFileSync(timestampedPath, stringifyRepoJson(output, REPO_ROOT));

  console.log("\n[context-usage] === rtk comparison summary ===");
  console.log(`  model: ${args.model}`);
  console.log(`  runs per mode: ${args.runs}`);
  console.log(`  plain mean input_tokens:  ${plainSummary.input_tokens.mean.toFixed(2)}`);
  console.log(`  plain mean output_tokens: ${plainSummary.output_tokens.mean.toFixed(2)}`);
  console.log(`  rtk mean input_tokens:    ${rtkSummary.input_tokens.mean.toFixed(2)}`);
  console.log(`  rtk mean output_tokens:   ${rtkSummary.output_tokens.mean.toFixed(2)}`);
  console.log(`  mean delta input:         ${meanDelta.input_tokens.toFixed(2)}`);
  console.log(`  mean delta output:        ${meanDelta.output_tokens.toFixed(2)}`);
  console.log(
    `  mean delta input (turns 3-5):  ${meanDelta.accumulation_input_tokens.toFixed(2)}`,
  );
  console.log(
    `  mean delta output (turns 3-5): ${meanDelta.accumulation_output_tokens.toFixed(2)}`,
  );
  if (meanDeltaPercent.input_tokens !== null) {
    console.log(`  mean delta input percent:  ${meanDeltaPercent.input_tokens.toFixed(2)}%`);
  }
  if (meanDeltaPercent.output_tokens !== null) {
    console.log(`  mean delta output percent: ${meanDeltaPercent.output_tokens.toFixed(2)}%`);
  }
  if (meanDeltaPercent.accumulation_input_tokens !== null) {
    console.log(
      `  mean delta input percent (turns 3-5):  ${meanDeltaPercent.accumulation_input_tokens.toFixed(2)}%`,
    );
  }
  if (meanDeltaPercent.accumulation_output_tokens !== null) {
    console.log(
      `  mean delta output percent (turns 3-5): ${meanDeltaPercent.accumulation_output_tokens.toFixed(2)}%`,
    );
  }
  console.log(`  latest report: ${repoRelativePath(latestPath, REPO_ROOT)}`);
  console.log(`  timestamped report: ${repoRelativePath(timestampedPath, REPO_ROOT)}`);

  return output;
}

const isMain =
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (isMain) {
  requireLiveEnv();
  await runManualRtkComparison();
}
