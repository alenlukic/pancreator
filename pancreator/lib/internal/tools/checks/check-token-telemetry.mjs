#!/usr/bin/env node
/**
 * Token-telemetry coverage gate.
 *
 * Governing "token economy" requires that agent (model-invocation) spans
 * actually carry usage telemetry. This gate measures the fraction of
 * persona-named agent spans in `.pan/**` run logs that include
 * `gen_ai.usage.*` fields (per the OpenTelemetry GenAI semantic conventions)
 * and enforces a coverage policy so the metric cannot silently regress.
 *
 * Policy (ratchet model):
 *   - target (default 0.80): coverage at/above this is healthy.
 *   - floor  (default 0.00): coverage BELOW this fails closed (exit 1).
 *   - between floor and target: warns (exit 0) unless --strict.
 *   - --strict: treat target as the hard floor (fail below target).
 *
 * Recommended rollout: land at warn-only, then set --floor to the current
 * measured baseline to prevent regression, then raise the floor over time
 * toward the target as instrumentation coverage improves.
 *
 * Usage:
 *   node lib/internal/tools/checks/check-token-telemetry.mjs
 *   node lib/internal/tools/checks/check-token-telemetry.mjs --floor 0.08
 *   node lib/internal/tools/checks/check-token-telemetry.mjs --strict --target 0.8
 *   node lib/internal/tools/checks/check-token-telemetry.mjs --window 14d --json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stringifyRepoJson } from "../format/canonical-json-format.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);

const argv = process.argv.slice(2);
function num(name, envName, fallback) {
  const i = argv.indexOf(name);
  if (i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--")) {
    const v = Number(argv[i + 1]);
    if (!Number.isNaN(v)) return v;
  }
  if (envName && process.env[envName] != null) {
    const v = Number(process.env[envName]);
    if (!Number.isNaN(v)) return v;
  }
  return fallback;
}
function str(name, fallback) {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--")
    ? argv[i + 1]
    : fallback;
}

const target = num("--target", "PAN_TOKEN_TELEMETRY_TARGET", 0.8);
const floor = num("--floor", "PAN_TOKEN_TELEMETRY_FLOOR", 0.0);
const strict = argv.includes("--strict");
const asJson = argv.includes("--json");
const windowDays = (() => {
  const m = /^(\d+)d$/u.exec(str("--window", "9999d"));
  return m ? Number(m[1]) : 9999;
})();
const cutoffMs = Date.now() - windowDays * 24 * 60 * 60 * 1000;

function personaSlugs() {
  const dir = path.join(ROOT, "lib/personas");
  return new Set(
    fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => e.name.replace(/\.md$/u, "")),
  );
}
function listRunLogs() {
  const out = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name === "run.log.jsonl") out.push(p);
    }
  };
  for (const base of [".pan/work", ".pan/archive/work"]) {
    const abs = path.join(ROOT, base);
    if (fs.existsSync(abs)) walk(abs);
  }
  return out;
}

const PERSONAS = personaSlugs();
let agentSpans = 0;
let withUsage = 0;
let unavailable = 0;
const byPersona = {};

for (const file of listRunLogs()) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const line of text.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    let span;
    try {
      span = JSON.parse(line);
    } catch {
      continue;
    }
    if (!PERSONAS.has(span.name)) continue;
    const ts = span.ts ? Date.parse(span.ts) : NaN;
    if (!Number.isNaN(ts) && ts < cutoffMs) continue;
    const a = span.attributes || {};
    const p = span.pancreator || {};
    agentSpans++;
    const has =
      a["gen_ai.usage.input_tokens"] != null ||
      a["gen_ai.usage.output_tokens"] != null ||
      a["gen_ai.usage.total_tokens"] != null;
    const rec = (byPersona[span.name] ||= { total: 0, withUsage: 0 });
    rec.total++;
    if (has) {
      withUsage++;
      rec.withUsage++;
    }
    if (p.token_usage_unavailable === true) unavailable++;
  }
}

const coverage = agentSpans === 0 ? 1 : withUsage / agentSpans;
const effectiveFloor = strict ? target : floor;
const fail = agentSpans > 0 && coverage < effectiveFloor;
const warn = !fail && agentSpans > 0 && coverage < target;

if (asJson) {
  process.stdout.write(
    stringifyRepoJson(
      {
        agentSpans,
        withUsage,
        coverage: Number(coverage.toFixed(4)),
        target,
        floor: effectiveFloor,
        strict,
        unavailable,
        status: fail ? "fail" : warn ? "warn" : "ok",
        byPersona,
      },
      ROOT,
    ),
  );
} else {
  const pctStr = `${(coverage * 100).toFixed(1)}%`;
  const line =
    `token-telemetry: ${pctStr} of ${agentSpans} agent spans carry gen_ai.usage.* ` +
    `(target ${(target * 100).toFixed(0)}%, floor ${(effectiveFloor * 100).toFixed(0)}%).`;
  if (fail) {
    process.stderr.write(`FAIL — ${line}\n`);
    process.stderr.write(
      "Coverage is below the enforced floor. Instrument agent spans with\n" +
        "gen_ai.usage.input_tokens / gen_ai.usage.output_tokens where the provider\n" +
        "reports them, or lower --floor only as a temporary, documented exception.\n",
    );
  } else if (warn) {
    process.stdout.write(`WARN — ${line}\n`);
    process.stdout.write(
      "Above floor but below target. Raise the floor toward the target as\n" +
        "instrumentation improves (ratchet) to prevent regression.\n",
    );
  } else {
    process.stdout.write(`OK — ${line}\n`);
  }
}

process.exit(fail ? 1 : 0);
