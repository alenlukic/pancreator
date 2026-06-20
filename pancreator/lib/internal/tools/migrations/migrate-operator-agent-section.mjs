#!/usr/bin/env node
/**
 * One-shot migration: add DOC.OPERATOR_AGENT_FORMAT prefixes to unsectioned corpus files.
 * JSON artifacts and parser-sensitive YAML backlog files are recorded as deferrals only.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  humanizeHandbookWhy,
  personaOperatorWhy,
  sliceOperatorAgentSection,
  stripFrontmatterTitle,
  stripOperatorAgentIndexFromFrontmatter,
  wrapOperatorAgentMarkdown,
  wrapOperatorAgentYaml,
} from "../../packages/@pancreator/core/dist/index.js";
import { stringifyRepoJson } from "../format/canonical-json-format.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

/** @param {string} rel */
function abs(rel) {
  return path.join(ROOT, rel);
}

/** @param {string} rel */
function read(rel) {
  return fs.readFileSync(abs(rel), "utf8");
}

/** @param {string} rel @param {string} content */
function write(rel, content) {
  fs.writeFileSync(abs(rel), content, "utf8");
}

/** @param {string} content */
function isSectioned(content) {
  const trimmed = content.replace(/^\uFEFF/, "").trimStart();
  if (trimmed.startsWith("# Operator section") || trimmed.startsWith("⚙️ no human content")) {
    return true;
  }
  if (!trimmed.startsWith("---")) {
    return false;
  }
  const closeDots = trimmed.indexOf("\n...", 4);
  const closeDashes = trimmed.indexOf("\n---", 4);
  let closeIndex = -1;
  if (closeDots >= 0 && closeDashes >= 0) {
    closeIndex = Math.min(closeDots, closeDashes);
  } else {
    closeIndex = closeDots >= 0 ? closeDots : closeDashes;
  }
  if (closeIndex < 0) {
    return false;
  }
  const after = trimmed.slice(closeIndex + 4).replace(/^\uFEFF/, "").trimStart();
  return after.startsWith("# Operator section") || after.startsWith("⚙️ no human content");
}

function stripLeadingIndexComment(text) {
  return text
    .replace(/<!--\s*pancreator-section-index[\s\S]*?-->\n?/gm, "")
    .replace(/<!--\s*agent_section_start_line:\s*\d+\s*-->\n?/gm, "");
}

function normalizeAgentBody(agentBody) {
  let body = stripLeadingIndexComment(agentBody.replace(/^\uFEFF/, "").trimStart());
  while (body.startsWith("---\n---\n")) {
    body = body.slice(4);
  }
  const fmMatch = body.match(/^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\r?\n([\s\S]*)$/);
  if (!fmMatch) {
    return body;
  }
  let frontmatter = stripOperatorAgentIndexFromFrontmatter(fmMatch[1] ?? "");
  frontmatter = stripFrontmatterTitle(frontmatter);
  if (frontmatter.length === 0) {
    return fmMatch[2].replace(/^\uFEFF/, "").trimStart();
  }
  const closeFence = /\n\.\.\.\r?\n/u.test(fmMatch[0] ?? "") ? "..." : "---";
  return `---\n${frontmatter}\n${closeFence}\n${fmMatch[2] ?? ""}`;
}

function extractCleanAgentBody(original) {
  return normalizeAgentBody(sliceOperatorAgentSection(original));
}

/** @param {{ inThisFile: string, whyItMatters: string, seeAlso: string[] }} meta @param {string} original */
function wrapMarkdown(meta, original) {
  return wrapOperatorAgentMarkdown(meta, original);
}

/** @param {{ inThisFile: string, whyItMatters: string, seeAlso: string[] }} meta @param {string} original */
function wrapYaml(meta, original) {
  return wrapOperatorAgentYaml(meta, original);
}

/** @param {string} rel @param {(agent: string) => { inThisFile: string, whyItMatters: string, seeAlso: string[] }} metaFactory */
function repairSectionedMarkdown(rel, metaFactory) {
  const original = read(rel);
  if (!isSectioned(original)) {
    return { rel, status: "skipped" };
  }
  let agentBody = extractCleanAgentBody(original);
  const wrapped = wrapMarkdown(metaFactory(agentBody), agentBody);
  write(rel, wrapped.endsWith("\n") ? wrapped : `${wrapped}\n`);
  return { rel, status: "repaired" };
}

/** @param {string} rel @param {(agent: string) => { inThisFile: string, whyItMatters: string, seeAlso: string[] }} metaFactory */
function repairSectionedYaml(rel, metaFactory) {
  const original = read(rel);
  if (!isSectioned(original)) {
    return { rel, status: "skipped" };
  }
  const agentBody = extractCleanAgentBody(original);
  const wrapped = wrapYaml(metaFactory(agentBody), agentBody);
  write(rel, wrapped.endsWith("\n") ? wrapped : `${wrapped}\n`);
  return { rel, status: "repaired" };
}

/** @param {string} rel @param {string} agentBody */
function pipelineMetaFor(rel, agentBody) {
  const id = yamlScalar(agentBody, "id") || path.basename(rel, ".yaml");
  const descriptionMatch = agentBody.match(
    /description:\s*(?:>\-?\s*\n([\s\S]*?)(?=\n\S|\n\s*references:)|(.+))/,
  );
  const description = descriptionMatch
    ? (descriptionMatch[1] ?? descriptionMatch[2] ?? "")
        .split("\n")
        .map((line) => line.trim())
        .join(" ")
    : "";
  return {
    inThisFile: `Pipeline definition \`${id}\`.`,
    whyItMatters: humanizeHandbookWhy(
      id.replace(/-/g, " "),
      description || `Defines stages and gates for the ${id} pipeline.`,
    ),
    seeAlso: [
      "pancreator/lib/pipelines/README.md",
      "pancreator/lib/memory/handbook/pipeline-state-contract.md",
    ],
  };
}

/** @param {string} block @param {string} key */
function yamlScalar(block, key) {
  const inline = block.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  if (inline) {
    return inline[1].replace(/^["']|["']$/g, "").trim();
  }
  const folded = block.match(new RegExp(`^${key}:\\s*\\|\\s*\\n([\\s\\S]*?)(?=\\n\\S|$)`, "m"));
  if (folded) {
    return folded[1]
      .split("\n")
      .map((line) => line.replace(/^\s{2}/, ""))
      .join(" ")
      .trim();
  }
  return "";
}

/** @param {string} block @param {string} key */
function yamlListSection(block, key) {
  const lines = block.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (start < 0) {
    return [];
  }
  /** @type {string[]} */
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (/^[a-zA-Z0-9_.-]+:/.test(line) || line === "---" || line === "...") {
      break;
    }
    const item = line.match(/^\s*-\s*(.+)$/);
    if (!item) {
      continue;
    }
    const value = item[1].trim();
    if (value.startsWith("/") || value.startsWith("lib/") || value.startsWith("pancreator/")) {
      out.push(value);
    }
  }
  return out;
}

/** @param {string} rel @param {string} agentBody */
function handbookMetaFor(rel, agentBody) {
  const fmMatch = agentBody.match(/^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\r?\n([\s\S]*)$/);
  const fm = fmMatch?.[1] ?? agentBody;
  const body = fmMatch?.[2] ?? "";
  const slug = yamlScalar(fm, "slug") || path.basename(rel, ".md");
  const h1Match = body.match(/^#\s+(.+)$/m);
  const label = h1Match?.[1]?.trim() || slug.replace(/-/g, " ");
  const related = yamlListSection(fm, "related");
  return {
    inThisFile: label,
    whyItMatters: humanizeHandbookWhy(label),
    seeAlso:
      related.length > 0
        ? related.slice(0, 3)
        : ["pancreator/lib/memory/handbook/agent-document-registry.md"],
  };
}

/** @param {string} rel @param {string} agentBody */
function personaMetaFor(rel, agentBody) {
  const fmMatch = agentBody.match(/^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\r?\n([\s\S]*)$/);
  const fm = fmMatch?.[1] ?? agentBody;
  const name = yamlScalar(fm, "name") || path.basename(rel, ".md");
  const description = yamlScalar(fm, "description");
  return {
    inThisFile: `Persona spec for \`${name}\`.`,
    whyItMatters: personaOperatorWhy(name, description),
    seeAlso: [
      "pancreator/lib/memory/handbook/persona-spec.md",
      "pancreator/lib/memory/handbook/agent-document-registry.md",
    ],
  };
}

/** @param {string} rel @param {string} agentBody */
function panWorkMetaFor(rel, agentBody) {
  const baseName = path.basename(rel, ".md");
  const taskId = rel.split("/").slice(-2, -1)[0] ?? baseName;
  return {
    inThisFile: `Active-work artifact \`${baseName}\`.`,
    whyItMatters: `Working notes and pipeline output for task ${taskId}; read before delegating the next stage.`,
    seeAlso: [
      "lib/memory/handbook/operator-agent-artifact-format.md",
      "AGENTS.md",
    ],
  };
}

/** @param {string} rel @param {string} agentBody */
function commandMetaFor(rel, agentBody) {
  const base = path.basename(rel, ".md");
  const h1 = agentBody.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return {
    inThisFile: `Cursor command spec for \`/${base}\`.`,
    whyItMatters:
      base === "introspect"
        ? "Scans recent agent and operator activity and turns recurring misses into an intake-ready follow-up item."
        : `Defines the \`/${base}\` Cursor command contract.`,
    seeAlso: [
      "AGENTS.md",
      "pancreator/lib/memory/handbook/agent-document-registry.md",
      "pancreator/lib/memory/handbook/operator-output-contract.md",
    ],
  };
}

/** @param {string} rel */
function migrateCommand(rel) {
  const normalizeCommandBody = (agentBody) => {
    let body = normalizeAgentBody(agentBody);
    const fmMatch = body.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/);
    return fmMatch ? fmMatch[1].replace(/^\uFEFF/, "").trimStart() : body;
  };
  if (isSectioned(read(rel))) {
    return repairSectionedMarkdown(rel, (agentBody) => commandMetaFor(rel, normalizeCommandBody(agentBody)));
  }
  const original = read(rel);
  const wrapped = wrapMarkdown(commandMetaFor(rel, original), original);
  write(rel, wrapped.endsWith("\n") ? wrapped : `${wrapped}\n`);
  return { rel, status: "migrated" };
}

/** @param {string} rel */
function migrateHandbookMarkdown(rel) {
  if (isSectioned(read(rel))) {
    return repairSectionedMarkdown(rel, (agentBody) => handbookMetaFor(rel, agentBody));
  }
  const original = read(rel);
  const wrapped = wrapMarkdown(handbookMetaFor(rel, original), original);
  write(rel, wrapped.endsWith("\n") ? wrapped : `${wrapped}\n`);
  return { rel, status: "migrated" };
}

/** @param {string} rel */
function migratePersona(rel) {
  if (isSectioned(read(rel))) {
    return repairSectionedMarkdown(rel, (agentBody) => personaMetaFor(rel, agentBody));
  }
  const original = read(rel);
  const wrapped = wrapMarkdown(personaMetaFor(rel, original), original);
  write(rel, wrapped.endsWith("\n") ? wrapped : `${wrapped}\n`);
  return { rel, status: "migrated" };
}

/** @param {string} rel */
function migratePipeline(rel) {
  if (isSectioned(read(rel))) {
    return repairSectionedYaml(rel, (agentBody) => pipelineMetaFor(rel, agentBody));
  }
  const original = read(rel);
  const wrapped = wrapYaml(pipelineMetaFor(rel, original), original);
  write(rel, wrapped.endsWith("\n") ? wrapped : `${wrapped}\n`);
  return { rel, status: "migrated" };
}

/** @param {string} dir */
function walkMarkdown(dir) {
  /** @type {string[]} */
  const out = [];
  for (const entry of fs.readdirSync(abs(dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir.replace(/\\/g, "/"), entry.name);
    if (entry.isDirectory()) {
      out.push(...walkMarkdown(rel));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      out.push(rel);
    }
  }
  return out;
}

const REPO_ROOT = path.resolve(ROOT, "..");

/** @param {string} base @param {string} rel */
function absFrom(base, rel) {
  return path.join(base, rel);
}

/** @param {string} base @param {string} rel @param {string} content */
function writeFrom(base, rel, content) {
  fs.writeFileSync(absFrom(base, rel), content, "utf8");
}

/** @param {string} base @param {string} dir */
function walkPanWorkArtifacts(base, dir) {
  /** @type {string[]} */
  const out = [];
  const absDir = absFrom(base, dir);
  if (!fs.existsSync(absDir)) {
    return out;
  }
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const rel = path.posix.join(dir.replace(/\\/g, "/"), entry.name);
    if (entry.isDirectory()) {
      out.push(...walkPanWorkArtifacts(base, rel));
    } else if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".json"))) {
      out.push(rel);
    }
  }
  return out;
}

/** @param {string} rel @param {string} base */
function migratePanWorkMarkdown(rel, base) {
  const original = fs.readFileSync(absFrom(base, rel), "utf8");
  if (isSectioned(original)) {
    const agentBody = normalizeAgentBody(sliceOperatorAgentSection(original));
    const wrapped = wrapMarkdown(panWorkMetaFor(rel, agentBody), agentBody);
    writeFrom(base, rel, wrapped.endsWith("\n") ? wrapped : `${wrapped}\n`);
    return { rel, status: "repaired" };
  }
  const baseName = path.basename(rel, ".md");
  const taskId = rel.split("/").pop()?.replace(/\.md$/, "") ?? baseName;
  const wrapped = wrapMarkdown(panWorkMetaFor(rel, original), original);
  writeFrom(base, rel, wrapped.endsWith("\n") ? wrapped : `${wrapped}\n`);
  return { rel, status: "migrated" };
}

/** @param {Record<string, unknown>} payload */
function wrapJsonDocument(payload, meta) {
  const $operator = {
    in_this_file: meta.inThisFile,
    why_it_matters: meta.whyItMatters,
    see_also: meta.seeAlso?.length ? meta.seeAlso : ["N/A"],
  };
  const wrapped = {
    $operator,
    ...payload,
  };
  return stringifyRepoJson(wrapped, ROOT);
}

/** @param {string} rel @param {string} base */
function migratePanWorkJson(rel, base) {
  if (rel.endsWith("run.log.jsonl") || rel.endsWith(".jsonl")) {
    return { rel, status: "deferred" };
  }
  const original = fs.readFileSync(absFrom(base, rel), "utf8");
  let payload;
  try {
    payload = JSON.parse(original);
  } catch {
    return { rel, status: "skipped" };
  }
  if (payload?.$operator || payload?.$pancreator_section_index) {
    return { rel, status: "skipped" };
  }
  const taskId =
    typeof payload.taskId === "string"
      ? payload.taskId
      : path.basename(path.dirname(rel));
  const pipeline =
    typeof payload.pipelineId === "string"
      ? payload.pipelineId
      : typeof payload.pipeline === "string"
        ? payload.pipeline
        : "feature-delivery";
  const wrapped = wrapJsonDocument(payload, {
    inThisFile: `Pipeline state ledger for task \`${taskId}\`.`,
    whyItMatters: `Tracks stage progress and artifact paths for the ${pipeline} run.`,
    seeAlso: [
      "lib/memory/handbook/pipeline-state-contract.md",
      "lib/memory/handbook/operator-agent-artifact-format.md",
    ],
  });
  writeFrom(base, rel, wrapped);
  return { rel, status: "migrated" };
}

/** @param {string} rel @param {string} base */
function migratePanWorkArtifact(rel, base) {
  if (rel.endsWith(".md")) {
    return migratePanWorkMarkdown(rel, base);
  }
  if (rel.endsWith(".json")) {
    return migratePanWorkJson(rel, base);
  }
  return { rel, status: "skipped" };
}

function migrateRepoAgents() {
  const agentsPath = path.join(REPO_ROOT, "AGENTS.md");
  if (!fs.existsSync(agentsPath)) {
    return { rel: "AGENTS.md", status: "skipped" };
  }
  const original = fs.readFileSync(agentsPath, "utf8");
  if (!isSectioned(original)) {
    return { rel: "AGENTS.md", status: "skipped" };
  }
  const agentBody = normalizeAgentBody(sliceOperatorAgentSection(original));
  const wrapped = wrapOperatorAgentMarkdown(
    {
      inThisFile:
        "Repo-wide agent operating card: where agents start, how they resolve contracts, and how they report work.",
      whyItMatters:
        "Every Pancreator agent reads this first so it knows which contracts bind the run and how to report results.",
      seeAlso: [
        "pancreator/lib/memory/handbook/agent-document-registry.md",
        "pancreator/lib/memory/handbook/operator-agent-artifact-format.md",
        "pancreator/lib/memory/handbook/operator-output-contract.md",
      ],
    },
    agentBody,
  );
  fs.writeFileSync(agentsPath, wrapped.endsWith("\n") ? wrapped : `${wrapped}\n`);
  return { rel: "AGENTS.md", status: "repaired" };
}

function main() {
  /** @type {{ migrated: string[], skipped: string[], repaired: string[], deferred: string[] }} */
  const report = { migrated: [], skipped: [], repaired: [], deferred: [] };

  for (const rel of walkMarkdown("lib/memory/handbook")) {
    const result = migrateHandbookMarkdown(rel);
    report[result.status]?.push(rel);
  }

  for (const rel of fs
    .readdirSync(abs("lib/personas"))
    .filter((name) => name.endsWith(".md"))
    .map((name) => path.posix.join("lib/personas", name))) {
    const result = migratePersona(rel);
    report[result.status]?.push(rel);
  }

  const commandsDir = abs("lib/commands");
  if (fs.existsSync(commandsDir)) {
    for (const rel of fs
      .readdirSync(commandsDir)
      .filter((name) => name.endsWith(".md"))
      .map((name) => path.posix.join("lib/commands", name))) {
      const result = migrateCommand(rel);
      report[result.status]?.push(rel);
    }
  }

  for (const rel of fs
    .readdirSync(abs("lib/pipelines"))
    .filter((name) => name.endsWith(".yaml"))
    .map((name) => path.posix.join("lib/pipelines", name))) {
    const result = migratePipeline(rel);
    report[result.status]?.push(rel);
  }

  const agentsResult = migrateRepoAgents();
  report[agentsResult.status]?.push(agentsResult.rel);

  for (const base of [ROOT, REPO_ROOT]) {
    for (const rel of walkPanWorkArtifacts(base, ".pan/work")) {
      const result = migratePanWorkArtifact(rel, base);
      report[result.status]?.push(path.relative(REPO_ROOT, absFrom(base, rel)).replace(/\\/g, "/"));
    }
  }

  const deferredJsonGlobs = [
    "lib/memory/features/**/index.json",
    "lib/memory/features/**/contracts.index.json",
    "lib/memory/features/index.json",
    "lib/memory/backlog/index.yaml",
    "lib/personas/rules/*.yaml",
    "lib/internal/packages/**/package.json",
    "lib/memory/features/**/*.schema.json",
    "lib/internal/packages/@pancreator/cli/src/fixtures/**/*.json",
    "lib/memory/features/quality-governance/compliance-tests/run-template.json",
    ".pan/work/**/run.log.jsonl",
    ".pan/work/**/touch-set.json",
    ".pan/work/**/compliance-result.json",
    ".pan/work/**/ship-ratification.json",
  ];

  for (const pattern of deferredJsonGlobs) {
    report.deferred.push(pattern);
  }

  const deferralBody = `---
title: Operator/Agent Section Migration Deferrals
slug: operator-agent-section-deferrals
stability: experimental
owners: [librarian, pancreator-engineer]
purpose: |
  Tracks JSON and YAML artifacts deferred from operator/agent prefix migration until
  their consumers whitelist or strip reserved prefix keys.
related:
  - /lib/memory/handbook/operator-agent-artifact-format.md
  - /lib/internal/packages/@pancreator/core/src/operator-agent-section.ts
---

# Operator/Agent section migration deferrals

Generated by \`lib/internal/tools/migrations/migrate-operator-agent-section.mjs\` on ${new Date().toISOString().slice(0, 10)}.

## Completed in this pass

- Handbook Markdown under \`lib/memory/handbook/**\` except files already sectioned before the pass.
- Persona specs at \`lib/personas/*.md\` (not skill subfolders).
- Pipeline YAML under \`lib/pipelines/*.yaml\`.
- Active and archived \`.pan/work/**\` Markdown artifacts and \`state.json\` ledgers (not JSONL run logs or gate JSON sidecars until consumers strip prefix keys).
- CLI scaffolds now emit sectioned \`.pan/work/**\` artifacts via \`pan-work-artifact.ts\`.

## Deferred surfaces

Each deferred pattern MUST gain one of:

1. Consumer support for \`$pancreator_section_index\` and \`$operator\` prefix keys (JSON), or multi-document operator/agent YAML; or
2. A shared strip helper (\`stripOperatorAgentJsonPrefix\`, \`sliceOperatorAgentSection\`) before schema validation.

| Pattern | Reason | Required change |
|---|---|---|
${deferredJsonGlobs.map((pattern) => `| \`${pattern}\` | Closed or compliance-validated schema expects payload at root | Whitelist/strip reserved keys before validation; then add section prefix |`).join("\n")}

## Explicit non-goals

- \`.cursor/agents/**\` and \`.cursor/rules/**\` projections remain unsectioned per DOC.OPERATOR_AGENT_FORMAT §1.
- \`lib/personas/skills/**\` and \`lib/personas/rules/**\` remain unsectioned until dedicated parsers land.
- \`.pan/work/**/run.log.jsonl\` remains unsectioned because each line is an independent JSON record.
- \`.pan/work/**\` gate JSON sidecars (\`touch-set.json\`, \`compliance-result.json\`, \`ship-ratification.json\`) remain unsectioned until validators uniformly strip prefix keys on write.

## Output manifest

- persona_contract: PERSONA.LIBRARIAN
- artifacts_written:
  - lib/memory/curation/operator-agent-section-deferrals.md
- migration_counts:
  - migrated: ${report.migrated.length}
  - repaired: ${report.repaired.length}
  - skipped_already_sectioned: ${report.skipped.length}
  - deferred_patterns: ${report.deferred.length}
`;

  const deferralDoc = wrapMarkdown(
    {
      inThisFile: "Deferred operator/agent section migrations for parser-sensitive JSON and YAML artifacts.",
      whyItMatters:
        "Records which machine artifacts still need consumer or schema updates before prefix keys can ship safely.",
      seeAlso: [
        "pancreator/lib/memory/handbook/operator-agent-artifact-format.md",
        "pancreator/lib/internal/packages/@pancreator/core/src/operator-agent-section.ts",
      ],
    },
    deferralBody,
  );

  write("lib/memory/curation/operator-agent-section-deferrals.md", deferralDoc.endsWith("\n") ? deferralDoc : `${deferralDoc}\n`);

  process.stdout.write(stringifyRepoJson(report, ROOT));
}

main();
