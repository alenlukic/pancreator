#!/usr/bin/env node
/**
 * Emit .cursor/agents/*.md projections from lib/personas/*.md under project_root.
 * Embedded installs (project_root: ".pancreator") write harness-root .cursor/agents
 * with retrieval paths prefixed by the configured project root.
 */
import fs from "node:fs";
import path from "node:path";

const PROJECT_ROOT_RE = /^project_root:\s*["']?([^"'\s#]+)["']?/m;

function readProjectRoot(harnessRoot) {
  const cfgPath = path.join(harnessRoot, "pancreator.yaml");
  if (!fs.existsSync(cfgPath)) {
    return ".";
  }
  const raw = fs.readFileSync(cfgPath, "utf8");
  const match = PROJECT_ROOT_RE.exec(raw);
  const value = match?.[1]?.trim();
  return value && value.length > 0 ? value : ".";
}

function projectRootAbs(harnessRoot, projectRootRel) {
  const harness = path.resolve(harnessRoot);
  if (projectRootRel === "." || projectRootRel === "") {
    return harness;
  }
  return path.resolve(harness, projectRootRel);
}

function posixJoin(...parts) {
  return parts.filter(Boolean).join("/").replace(/\/+/g, "/");
}

function parseFrontmatter(raw) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(raw);
  if (!match) {
    throw new Error("Missing YAML frontmatter");
  }
  const body = raw.slice(match[0].length).trimStart();
  const lines = match[1].split(/\r?\n/u);
  /** @type {Record<string, unknown>} */
  const data = {};
  /** @type {string[] | null} */
  let listKey = null;

  for (const line of lines) {
    if (/^\s+-\s+/u.test(line) && listKey !== null) {
      const item = line.replace(/^\s+-\s+/u, "").replace(/^["']|["']$/gu, "");
      const arr = /** @type {string[]} */ (data[listKey]);
      arr.push(item);
      continue;
    }
    listKey = null;
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/u.exec(line);
    if (!kv) continue;
    const [, key, valueRaw] = kv;
    if (valueRaw === "") {
      data[key] = [];
      listKey = key;
      continue;
    }
    if (valueRaw.startsWith("[") && valueRaw.endsWith("]")) {
      data[key] = valueRaw
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => s.replace(/^["']|["']$/gu, ""));
      continue;
    }
    data[key] = valueRaw.replace(/^["']|["']$/gu, "");
  }
  return { data, body };
}

function yamlQuote(value) {
  if (/[:#\[\]{}&*!|>'"%@`\n]/u.test(value) || value.startsWith(" ") || value.endsWith(" ")) {
    return JSON.stringify(value);
  }
  return value;
}

function renderScalarBlock(key, value, indent = "") {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return `${indent}${key}: []`;
    }
    return `${indent}${key}:\n${value.map((item) => `${indent}  - ${yamlQuote(String(item))}`).join("\n")}`;
  }
  return `${indent}${key}: ${yamlQuote(String(value))}`;
}

function renderMetadata(metadata, personaName, canonicalPersonaRel) {
  const merged = { ...(metadata ?? {}) };
  merged["pancreator-base-persona"] = personaName;
  merged["pancreator-model-tier"] = "canonical";
  merged["pancreator-canonical-persona"] = canonicalPersonaRel;
  const lines = ["metadata:"];
  for (const [key, value] of Object.entries(merged)) {
    if (Array.isArray(value)) {
      lines.push(`  ${key}:`);
      for (const item of value) {
        lines.push(`    - ${yamlQuote(String(item))}`);
      }
    } else {
      lines.push(`  ${key}: ${yamlQuote(String(value))}`);
    }
  }
  return lines.join("\n");
}

function buildAgentProjection(personaName, personaRaw, projectPrefix) {
  const { data } = parseFrontmatter(personaRaw);
  const canonicalPersonaRel = posixJoin(projectPrefix === "." ? "" : projectPrefix, "lib/personas", `${personaName}.md`);
  const personaPathForText = projectPrefix === "." ? canonicalPersonaRel : canonicalPersonaRel;
  const handbookPrefix = projectPrefix === "." ? "" : projectPrefix;
  const workPrefix = projectPrefix === "." ? "" : projectPrefix;

  const frontmatterKeys = [
    ["name", personaName],
    ["description", `Canonical \`${personaName}\` subagent projection for persona-owned pipeline stages.`],
    ["model", data.model ?? "auto"],
    ["permissionMode", data.permissionMode ?? "default"],
    ["tools", data.tools ?? []],
    ["disallowedTools", data.disallowedTools ?? []],
    ["mcpServers", data.mcpServers ?? []],
    ["skills", data.skills ?? []],
    ["maxTurns", data.maxTurns ?? 30],
    ["isolation", data.isolation ?? "worktree"],
    ["memory", data.memory ?? "project"],
    ["effort", "medium"],
    ["color", data.color ?? "slate"],
  ];

  const yamlLines = ["---"];
  for (const [key, value] of frontmatterKeys) {
    yamlLines.push(renderScalarBlock(key, value));
  }
  yamlLines.push(renderMetadata(data.metadata ?? {}, personaName, canonicalPersonaRel));
  yamlLines.push("---", "", `# ${personaName}`, "");
  yamlLines.push(
    `This file is the Cursor projection for \`${personaName}\` at \`${personaPathForText}\`. It intentionally avoids duplicating persona prose,`,
    "PRD citations, and handbook excerpts so Cursor subagent startup stays small.",
    "",
    "## Retrieval contract",
    "",
    "1. Read `AGENTS.md` for the live operating contract.",
    `2. Read \`${personaPathForText}\` for role semantics before performing persona-owned work.`,
    `3. Read \`${posixJoin(handbookPrefix, "lib/memory/handbook/context-economy.md")}\` only when the task requires context-budget decisions.`,
    "4. Do not traverse `work/**`, `archive/work/**`, `lib/inbox/out/**`, `archive/inbox/**`, or `lib/inbox/threads/**` unless the task explicitly requires active-run handling or archival reconstruction.",
  );

  if (projectPrefix !== ".") {
    yamlLines[yamlLines.length - 1] = yamlLines[yamlLines.length - 1].replace(
      "`work/**`",
      `\`${posixJoin(workPrefix, "work/**")}\``,
    );
    yamlLines.push(
      `5. Project-root paths in prompts and ledgers are relative to \`${projectPrefix}/\`; resolve them under that prefix from the harness root.`,
    );
  }

  yamlLines.push("");
  return `${yamlLines.join("\n")}\n`;
}

function buildGeneralPurposeProjection(projectPrefix) {
  const handbookPrefix = projectPrefix === "." ? "" : projectPrefix;
  const canonicalPersona = posixJoin(handbookPrefix, "lib/memory/handbook/context-economy.md");
  return `---
permissionMode: default
tools:
  - Read
  - Grep
  - Glob
  - Write
  - Edit
  - "Bash(git diff:*)"
  - "Bash(git status:*)"
  - "Bash(node --test:*)"
  - "Bash(node --check:*)"
  - "Bash(bash -n:*)"
disallowedTools:
  - "Bash(rm:*)"
  - "Bash(git push:*)"
  - "Bash(git commit:*)"
mcpServers:
  - pancreator-memory
skills: []
maxTurns: 20
isolation: worktree
memory: project
effort: medium
color: slate
metadata:
  pancreator-risk-tier: medium
  pancreator-pipeline-stages: [triage, bridge]
  pancreator-bootstrap-only: false
  pancreator-stability: experimental
  pancreator-handbook-anchors:
    - /AGENTS.md
    - ${JSON.stringify(posixJoin(handbookPrefix, "lib/memory/handbook/context-economy.md"))}
    - ${JSON.stringify(posixJoin(handbookPrefix, "lib/memory/handbook/persona-spec.md"))}
  pancreator-checklist:
    - route-before-broad-read
    - prefer-owner-persona
    - bounded-bridge-work-only
    - cite-routing-decision
  pancreator-base-persona: general-purpose
  pancreator-model-tier: standalone
name: general-purpose
model: auto
description: Catch-all Pancreator subagent. Use when the operator is unsure which persona owns the work, when normal routing is blocked, or when bounded bridge work is needed while infrastructure is still being built.
---

# general-purpose

Use this agent when the human operator does not know which persona should own a task, when a native persona projection is missing, or when a small infrastructure gap blocks the normal Pancreator workflow.

## Retrieval contract

1. Read \`AGENTS.md\` for the live operating contract.
2. Read \`${canonicalPersona}\` before opening broad docs, memory, archived work, or generated artifacts.
3. Prefer compact handbook route documents before full source-of-truth documents.
4. Do not traverse \`${posixJoin(handbookPrefix, "work/**")}\`, \`${posixJoin(handbookPrefix, "archive/work/**")}\`, or inbox out/thread paths unless the operator request explicitly requires active-run handling or archival reconstruction.
`;
}

function syncCursorAgents(harnessRoot, options = {}) {
  const dryRun = options.dryRun ?? false;
  const harness = path.resolve(harnessRoot);
  const projectRootRel = readProjectRoot(harness);
  const projectRoot = projectRootAbs(harness, projectRootRel);
  const personasDir = path.join(projectRoot, "lib", "personas");
  const agentsDir = path.join(harness, ".cursor", "agents");

  if (!fs.existsSync(personasDir)) {
    throw new Error(`Missing persona roster at ${personasDir}`);
  }

  const personaFiles = fs
    .readdirSync(personasDir)
    .filter((name) => name.endsWith(".md"))
    .sort();

  if (personaFiles.length === 0) {
    throw new Error(`No persona specs found under ${personasDir}`);
  }

  if (!dryRun) {
    fs.mkdirSync(agentsDir, { recursive: true });
  }

  /** @type {Array<{ path: string, action: string }>} */
  const written = [];

  for (const file of personaFiles) {
    const personaName = file.replace(/\.md$/u, "");
    const personaRaw = fs.readFileSync(path.join(personasDir, file), "utf8");
    const projection = buildAgentProjection(personaName, personaRaw, projectRootRel);
    const outRel = path.posix.join(".cursor/agents", `${personaName}.md`);
    const outAbs = path.join(harness, outRel);
    if (!dryRun) {
      fs.writeFileSync(outAbs, projection, "utf8");
    }
    written.push({ path: outRel, action: dryRun ? "would_write" : "write" });
  }

  const gpRel = ".cursor/agents/general-purpose.md";
  const gpAbs = path.join(harness, gpRel);
  const gpProjection = buildGeneralPurposeProjection(projectRootRel);
  if (!dryRun) {
    fs.writeFileSync(gpAbs, gpProjection, "utf8");
  }
  written.push({ path: gpRel, action: dryRun ? "would_write" : "write" });

  const gitkeep = path.join(agentsDir, ".gitkeep");
  if (fs.existsSync(gitkeep)) {
    if (!dryRun) {
      fs.unlinkSync(gitkeep);
    }
    written.push({ path: ".cursor/agents/.gitkeep", action: dryRun ? "would_remove" : "remove" });
  }

  return {
    harnessRoot: harness,
    projectRootRel,
    personasDir,
    agentsDir,
    written,
    count: personaFiles.length + 1,
  };
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const harnessRoot = positional[0] ? path.resolve(positional[0]) : process.cwd();
  const result = syncCursorAgents(harnessRoot, { dryRun });
  console.log(
    JSON.stringify(
      {
        command: "sync-cursor-agents",
        status: "ok",
        dryRun,
        harnessRoot: result.harnessRoot,
        projectRootRel: result.projectRootRel,
        count: result.count,
        written: result.written,
      },
      null,
      2,
    ),
  );
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  main();
}

export { syncCursorAgents, buildAgentProjection, readProjectRoot };
