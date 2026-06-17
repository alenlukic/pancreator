#!/usr/bin/env node
/**
 * Cursor projection drift guard.
 *
 * The `.cursor/agents/*.md` and `.cursor/rules/*.mdc` files are gitignored,
 * generated projections of the canonical persona specs under `lib/personas/`.
 * Because they are local-only, a developer who edits a persona and forgets to
 * run `pan cursor-sync` will run live Cursor subagents against a STALE
 * operating contract — the exact failure mode that breaks consistent agent
 * compliance with the intended framework.
 *
 * This guard is a non-mutating, dependency-free regression check (it does not
 * regenerate anything). It fails closed (exit 1) when on-disk projections drift
 * from canonical sources, with a single remediation: run `pan cursor-sync`.
 *
 * It is complementary to tests/cursor-agents-retrieval-contract.test.mjs, which
 * regenerates-then-validates (and therefore cannot observe a stale on-disk
 * state). This guard inspects what is actually on disk right now.
 *
 * Usage:
 *   node lib/internal/tools/checks/check-cursor-projection-drift.mjs
 *   node lib/internal/tools/checks/check-cursor-projection-drift.mjs --json
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
);

const PERSONA_DIR = "lib/personas";
const RULES_SRC_DIR = "lib/personas/rules";
const AGENT_PROJECTION_DIR = ".cursor/agents";
const RULE_PROJECTION_DIR = ".cursor/rules";

// Projections that intentionally have no canonical persona spec.
const PROJECTION_ONLY_AGENTS = new Set(["general-purpose"]);

// Canonical frontmatter scalar fields that the projection mirrors verbatim
// (each with a fallback default in cursor-sync, so we only compare when the
// canonical persona actually declares the field). `effort` is intentionally
// excluded: cursor-sync hardcodes `effort: medium` rather than mirroring it.
const MIRRORED_SCALAR_FIELDS = [
  "model",
  "permissionMode",
  "maxTurns",
  "isolation",
  "memory",
  "color",
];

// Normative markers the post-hardening cursor-sync writes into every agent
// projection. Their absence means the projection predates the static-contract
// hardening (or was synced with an old generator).
const REQUIRED_AGENT_MARKERS = [
  "## Static persona contract (normative)",
  "## Retrieval contract",
  "lib/memory/handbook/agent-document-registry.md",
];

const args = new Set(process.argv.slice(2));
const asJson = args.has("--json");

/** @param {string} rel */
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/** @param {string} rel */
function listStems(rel, ext) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(ext))
    .map((e) => e.name.slice(0, -ext.length))
    .sort();
}

/**
 * Read the first scalar value for a top-level YAML key in a frontmatter block.
 * Returns null when absent. Only used for simple scalar fields.
 * @param {string} frontmatter
 * @param {string} key
 */
function scalarField(frontmatter, key) {
  const re = new RegExp(`^${key}:\\s*(.+?)\\s*$`, "mu");
  const m = re.exec(frontmatter);
  return m ? m[1].trim().replace(/^["']|["']$/gu, "") : null;
}

/** @param {string} raw */
function frontmatterOf(raw) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/u.exec(raw);
  return m ? m[1] : "";
}

/** @type {string[]} */
const problems = [];

// 1. Agent projection completeness.
const personaStems = listStems(PERSONA_DIR, ".md");
const agentProjectionStems = listStems(AGENT_PROJECTION_DIR, ".md");
const agentProjectionSet = new Set(agentProjectionStems);
const personaSet = new Set(personaStems);

for (const stem of personaStems) {
  if (!agentProjectionSet.has(stem)) {
    problems.push(
      `persona '${stem}' has no Cursor agent projection (.cursor/agents/${stem}.md)`,
    );
  }
}
for (const stem of agentProjectionStems) {
  if (!personaSet.has(stem) && !PROJECTION_ONLY_AGENTS.has(stem)) {
    problems.push(
      `agent projection '${stem}' has no canonical persona (lib/personas/${stem}.md) and is not an allow-listed special agent`,
    );
  }
}

// 2. Rule projection completeness.
const ruleSrcStems = listStems(RULES_SRC_DIR, ".yaml");
const ruleProjectionSet = new Set(listStems(RULE_PROJECTION_DIR, ".mdc"));
for (const stem of ruleSrcStems) {
  if (!ruleProjectionSet.has(stem)) {
    problems.push(
      `persona rule '${stem}' has no Cursor rule projection (.cursor/rules/${stem}.mdc)`,
    );
  }
}

// 3. Per-projection marker presence + scalar field sync.
for (const stem of personaStems) {
  const projRel = `${AGENT_PROJECTION_DIR}/${stem}.md`;
  if (!fs.existsSync(path.join(ROOT, projRel))) continue; // already reported

  const projRaw = read(projRel);
  const personaRaw = read(`${PERSONA_DIR}/${stem}.md`);

  for (const marker of REQUIRED_AGENT_MARKERS) {
    if (!projRaw.includes(marker)) {
      problems.push(
        `${projRel} is missing required marker '${marker}' (regenerate with pan cursor-sync)`,
      );
    }
  }

  // The projection must point back at its own canonical persona spec.
  if (!projRaw.includes(`${PERSONA_DIR}/${stem}.md`)) {
    problems.push(
      `${projRel} does not reference its canonical persona spec lib/personas/${stem}.md`,
    );
  }

  const projFm = frontmatterOf(projRaw);
  const personaFm = frontmatterOf(personaRaw);
  for (const field of MIRRORED_SCALAR_FIELDS) {
    const canonical = scalarField(personaFm, field);
    if (canonical === null) continue; // field not present in canonical
    const projected = scalarField(projFm, field);
    if (projected !== canonical) {
      problems.push(
        `${projRel} field '${field}' is stale: canonical='${canonical}' projection='${projected ?? "(absent)"}'`,
      );
    }
  }
}

const ok = problems.length === 0;

if (asJson) {
  process.stdout.write(
    stringifyRepoJson(
      {
        ok,
        personaCount: personaStems.length,
        agentProjectionCount: agentProjectionStems.length,
        ruleSourceCount: ruleSrcStems.length,
        problemCount: problems.length,
        problems,
      },
      ROOT,
    ),
  );
} else if (ok) {
  process.stdout.write(
    `cursor-projection-drift: OK — ${personaStems.length} personas, ` +
      `${agentProjectionStems.length} agent projections, ${ruleSrcStems.length} rule sources in sync.\n`,
  );
} else {
  process.stderr.write(
    `cursor-projection-drift: FAIL — ${problems.length} drift issue(s):\n`,
  );
  for (const p of problems) process.stderr.write(`  - ${p}\n`);
  process.stderr.write(
    "\nRemediation: regenerate projections with `pnpm -w exec pan cursor-sync`,\n" +
      "then re-run this guard. Projections are gitignored, so this drift is not\n" +
      "caught by tracked-file CI on its own.\n",
  );
}

process.exit(ok ? 0 : 1);
