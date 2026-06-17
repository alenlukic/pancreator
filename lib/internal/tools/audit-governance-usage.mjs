#!/usr/bin/env node
/**
 * Governance usage + friction audit reporter.
 *
 * Produces a single, reproducible Markdown report over the repo-local
 * `.pan/**` run logs (and, when available, agent transcripts) so that
 * governance compliance and friction can be MEASURED before and after each
 * hardening change — the "land the audit first, then re-measure" step from the
 * governance plan.
 *
 * Run-log audit (always available, repo-local):
 *   - feature-delivery run inventory in the window
 *   - model-escalation WARN noise by persona ("missing from escalation config")
 *   - re-entry / rework transitions (review->implement must_fix, test->implement qa_fails)
 *   - stage invocation distribution (p50/p90/max) from pancreator.stage_invocation_index
 *   - token-telemetry coverage over real agent spans (gen_ai.usage.* presence)
 *   - stage content-warning counts emitted by the artifact/manifest validators
 *
 * Transcript audit (optional; requires PAN_AGENT_TRANSCRIPTS_DIR):
 *   - handbook / governance-doc read frequencies across sessions
 *
 * Output:
 *   - Markdown report under lib/inbox/out/<day-bucket>/<timestamp>_governance-usage-audit.md
 *     (override with --out <path>; lib/inbox/out is gitignored / local-only)
 *   - "Top issues" + "Reproduce" summary printed to stdout
 *
 * Usage:
 *   node lib/internal/tools/audit-governance-usage.mjs [--window 14d] [--out PATH] [--stdout-only]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

const TOKEN_TELEMETRY_TARGET = 0.8; // 80% coverage target for agent spans

// ----- args -------------------------------------------------------------
const argv = process.argv.slice(2);
function flag(name, fallback = null) {
  const i = argv.indexOf(name);
  if (i === -1) return fallback;
  const v = argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}
const windowArg = flag("--window", "14d");
const stdoutOnly = argv.includes("--stdout-only");
const outOverride = flag("--out", null);

function parseWindowDays(s) {
  const m = /^(\d+)d$/u.exec(String(s));
  return m ? Number(m[1]) : 14;
}
const windowDays = parseWindowDays(windowArg);
const now = Date.now();
const cutoffMs = now - windowDays * 24 * 60 * 60 * 1000;

// ----- helpers ----------------------------------------------------------
function listRunLogs() {
  /** @type {string[]} */
  const out = [];
  for (const base of [".pan/work", ".pan/archive/work"]) {
    const abs = path.join(ROOT, base);
    if (!fs.existsSync(abs)) continue;
    walk(abs, out);
  }
  return out;
}
function walk(dir, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (ent.name === "run.log.jsonl") out.push(p);
  }
}

function personaSlugs() {
  const dir = path.join(ROOT, "lib/personas");
  return new Set(
    fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => e.name.replace(/\.md$/u, "")),
  );
}

function pct(n, d) {
  return d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(
    sorted.length - 1,
    Math.ceil((p / 100) * sorted.length) - 1,
  );
  return sorted[Math.max(0, idx)];
}

function inWindow(span) {
  const ts = span.ts ? Date.parse(span.ts) : NaN;
  if (Number.isNaN(ts)) return true; // keep spans without ts
  return ts >= cutoffMs;
}

// ----- run-log audit ----------------------------------------------------
const PERSONAS = personaSlugs();
const runLogs = listRunLogs();

const featureRuns = new Set();
const escalationWarnByPersona = {};
const reentry = {
  "review->implement (must_fix)": 0,
  "test->implement (qa_fails)": 0,
};
const transitionCounts = {};
const stageInvocationByStage = {};
let agentSpans = 0;
let agentWithUsage = 0;
let agentUsageUnavailable = 0;
let contentWarningSpans = 0;
let contentWarningTotal = 0;
let spansScanned = 0;

for (const file of runLogs) {
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
    if (!inWindow(span)) continue;
    spansScanned++;
    const a = span.attributes || {};
    const p = span.pancreator || {};
    if (p.pipeline === "feature-delivery" && p.task_id) {
      featureRuns.add(p.task_id);
    }

    // escalation WARN noise
    if (span.name === "cursor.runner.escalation") {
      const sev = a["pancreator.escalation.severity"];
      if (sev === "WARN" || sev === "ERROR") {
        const slug = (a.escalation && a.escalation.persona_slug) || "(unknown)";
        escalationWarnByPersona[slug] =
          (escalationWarnByPersona[slug] || 0) + 1;
      }
    }

    // transitions / re-entry
    if (span.name === "pancreator.pipeline.advance") {
      const from = a["pancreator.from_stage"];
      const to = a["pancreator.to_stage"];
      const ev = a["pancreator.transition_event"];
      if (from && to && ev) {
        const key = `${from}->${to} (${ev})`;
        transitionCounts[key] = (transitionCounts[key] || 0) + 1;
        if (key === "review->implement (must_fix)") reentry[key]++;
        if (key === "test->implement (qa_fails)") reentry[key]++;
      }
      const cw = a["pancreator.content_warning_count"];
      if (typeof cw === "number" && cw > 0) {
        contentWarningSpans++;
        contentWarningTotal += cw;
      }
    }

    // agent spans (real model invocations are persona-named, provider=cursor)
    if (PERSONAS.has(span.name)) {
      agentSpans++;
      if (
        a["gen_ai.usage.input_tokens"] != null ||
        a["gen_ai.usage.output_tokens"] != null ||
        a["gen_ai.usage.total_tokens"] != null
      ) {
        agentWithUsage++;
      }
      if (p.token_usage_unavailable === true) agentUsageUnavailable++;

      const sidx = a["pancreator.stage_invocation_index"];
      const stage = p.stage_id || a["pancreator.stage_id"] || span.name;
      const task = p.task_id || a["pancreator.feature_id"] || "(unknown)";
      if (typeof sidx === "number") {
        ((stageInvocationByStage[stage] ||= {})[task] = Math.max(
          stageInvocationByStage[stage][task] ?? 0,
          sidx + 1, // 1-based invocation count
        ));
      }
    }
  }
}

const tokenCoverage = agentSpans === 0 ? 0 : agentWithUsage / agentSpans;

// ----- optional transcript audit ----------------------------------------
const transcriptsDir = process.env.PAN_AGENT_TRANSCRIPTS_DIR || null;
let transcriptSummary = null;
if (transcriptsDir && fs.existsSync(transcriptsDir)) {
  const docReads = {};
  let sessions = 0;
  const files = [];
  walkAny(transcriptsDir, files, ".jsonl");
  for (const f of files) {
    sessions++;
    let t;
    try {
      t = fs.readFileSync(f, "utf8");
    } catch {
      continue;
    }
    for (const m of t.matchAll(/lib\/memory\/handbook\/[A-Za-z0-9/_-]+\.md/gu)) {
      docReads[m[0]] = (docReads[m[0]] || 0) + 1;
    }
  }
  transcriptSummary = { sessions, docReads };
}
function walkAny(dir, out, ext) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkAny(p, out, ext);
    else if (ent.name.endsWith(ext)) out.push(p);
  }
}

// ----- top issues -------------------------------------------------------
/** @type {string[]} */
const topIssues = [];
const escalationWarnTotal = Object.values(escalationWarnByPersona).reduce(
  (a, b) => a + b,
  0,
);
if (escalationWarnTotal > 0) {
  const worst = Object.entries(escalationWarnByPersona)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, v]) => `${k} (${v})`)
    .join(", ");
  topIssues.push(
    `Escalation WARN noise: ${escalationWarnTotal} events in window; top personas: ${worst}. Guard with model-escalation-completeness test.`,
  );
}
if (agentSpans > 0 && tokenCoverage < TOKEN_TELEMETRY_TARGET) {
  topIssues.push(
    `Token-telemetry coverage ${pct(agentWithUsage, agentSpans)} of ${agentSpans} agent spans (target ${Math.round(
      TOKEN_TELEMETRY_TARGET * 100,
    )}%). token_usage_unavailable on ${pct(agentUsageUnavailable, agentSpans)}.`,
  );
}
const reentryTotal = reentry["review->implement (must_fix)"] +
  reentry["test->implement (qa_fails)"];
if (reentryTotal > 0) {
  topIssues.push(
    `Re-entry load: ${reentry["review->implement (must_fix)"]} review->implement(must_fix), ${reentry["test->implement (qa_fails)"]} test->implement(qa_fails).`,
  );
}
if (topIssues.length === 0) {
  topIssues.push("No governance friction signals exceeded thresholds in window.");
}

// ----- render report ----------------------------------------------------
function distTable() {
  const stages = Object.keys(stageInvocationByStage).sort();
  if (stages.length === 0) return "_No stage_invocation_index data in window._\n";
  let out =
    "| stage | tasks | p50 | p90 | max |\n|---|---|---|---|---|\n";
  for (const s of stages) {
    const arr = Object.values(stageInvocationByStage[s]).sort((a, b) => a - b);
    out += `| ${s} | ${arr.length} | ${percentile(arr, 50)} | ${percentile(
      arr,
      90,
    )} | ${arr[arr.length - 1]} |\n`;
  }
  return out;
}

function escTable() {
  const rows = Object.entries(escalationWarnByPersona).sort(
    (a, b) => b[1] - a[1],
  );
  if (rows.length === 0) return "_No escalation WARN/ERROR events in window._\n";
  return (
    "| persona | WARN/ERROR events |\n|---|---|\n" +
    rows.map(([k, v]) => `| ${k} | ${v} |`).join("\n") +
    "\n"
  );
}

function transTable() {
  const rows = Object.entries(transitionCounts).sort((a, b) => b[1] - a[1]);
  if (rows.length === 0) return "_No transitions in window._\n";
  return (
    "| transition | count |\n|---|---|\n" +
    rows.map(([k, v]) => `| ${k} | ${v} |`).join("\n") +
    "\n"
  );
}

const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
const report = `# Governance usage + friction audit

- Generated: ${new Date().toISOString()}
- Window: last ${windowDays} days (since ${new Date(cutoffMs).toISOString()})
- Run logs scanned: ${runLogs.length}
- Spans scanned (in window): ${spansScanned}
- Feature-delivery runs in window: ${featureRuns.size}

## Top issues

${topIssues.map((t) => `- ${t}`).join("\n")}

## Model-escalation WARN noise

${escTable()}
> Personas appearing here resolved to "Persona missing from escalation config"
> at some point. The completeness test (\`tests/model-escalation-completeness.test.mjs\`)
> fails closed when any pipeline persona is absent from every escalation config.

## Stage transitions and re-entry

${transTable()}
- Re-entry (rework) totals: review->implement(must_fix) = ${reentry["review->implement (must_fix)"]}, test->implement(qa_fails) = ${reentry["test->implement (qa_fails)"]}
- Stage content-warning spans (manifest/artifact validators): ${contentWarningSpans} span(s), ${contentWarningTotal} warning(s)

## Stage invocation distribution (invocations per task)

${distTable()}

## Token-telemetry coverage

- Agent (persona-named) spans in window: ${agentSpans}
- With \`gen_ai.usage.*\`: ${agentWithUsage} (${pct(agentWithUsage, agentSpans)})
- With \`token_usage_unavailable: true\`: ${agentUsageUnavailable} (${pct(agentUsageUnavailable, agentSpans)})
- Target: ${Math.round(TOKEN_TELEMETRY_TARGET * 100)}% — ${
  tokenCoverage >= TOKEN_TELEMETRY_TARGET ? "MET" : "BELOW TARGET"
}
> Coverage is gated by \`node lib/internal/tools/check-token-telemetry.mjs\`.

## Transcript audit

${
  transcriptSummary
    ? `- Sessions scanned: ${transcriptSummary.sessions}\n` +
      "- Top handbook/governance doc reads:\n" +
      Object.entries(transcriptSummary.docReads)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([k, v]) => `  - ${k}: ${v}`)
        .join("\n")
    : "_PAN_AGENT_TRANSCRIPTS_DIR not set or absent; transcript read-frequency audit skipped._"
}

## Reproduce

\`\`\`bash
# this report
node lib/internal/tools/audit-governance-usage.mjs --window ${windowDays}d

# structural framework gates (fail closed)
node lib/internal/tools/check-cursor-projection-drift.mjs
node lib/internal/tools/check-token-telemetry.mjs
node --test tests/agent-document-registry-integrity.test.mjs
node --test tests/model-escalation-completeness.test.mjs
\`\`\`
`;

// ----- write + stdout ---------------------------------------------------
let writtenPath = null;
if (!stdoutOnly) {
  const dayBucket = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const rel =
    outOverride ||
    `lib/inbox/out/${dayBucket}/${stamp}_governance-usage-audit.md`;
  const abs = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, report, "utf8");
  writtenPath = path.relative(ROOT, abs);
}

process.stdout.write(`Governance usage + friction audit (window ${windowDays}d)\n`);
process.stdout.write(`  run logs: ${runLogs.length}, feature runs: ${featureRuns.size}, agent spans: ${agentSpans}\n`);
process.stdout.write("Top issues:\n");
for (const t of topIssues) process.stdout.write(`  - ${t}\n`);
if (writtenPath) process.stdout.write(`\nFull report: ${writtenPath}\n`);
