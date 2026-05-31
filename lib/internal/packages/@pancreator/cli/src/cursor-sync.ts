import { projectRootAbs, readProjectRoot } from "@pancreator/core";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadEmbeddedInstallManifestFromRepo } from "./pan-init.js";

export interface CursorSyncWrittenEntry {
  path: string;
  action: "write" | "remove" | "would_write" | "would_remove";
}

export interface CursorSyncResult {
  command: "cursor-sync";
  status: "ok";
  dryRun: boolean;
  harnessRoot: string;
  projectRootRel: string;
  count: number;
  written: CursorSyncWrittenEntry[];
}

export interface CursorSyncOptions {
  dryRun?: boolean;
}

function posixJoin(...parts: string[]): string {
  return parts.filter(Boolean).join("/").replace(/\/+/g, "/");
}

function parseFrontmatter(raw: string): { data: Record<string, unknown>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(raw);
  if (!match) {
    throw new Error("Missing YAML frontmatter");
  }
  const body = raw.slice(match[0].length).trimStart();
  const lines = match[1]!.split(/\r?\n/u);
  const data: Record<string, unknown> = {};
  let listKey: string | null = null;

  for (const line of lines) {
    if (/^\s+-\s+/u.test(line) && listKey !== null) {
      const item = line.replace(/^\s+-\s+/u, "").replace(/^["']|["']$/gu, "");
      (data[listKey] as string[]).push(item);
      continue;
    }
    listKey = null;
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/u.exec(line);
    if (!kv) continue;
    const [, key, valueRaw] = kv;
    if (valueRaw === "") {
      data[key!] = [];
      listKey = key!;
      continue;
    }
    if (valueRaw.startsWith("[") && valueRaw.endsWith("]")) {
      data[key!] = valueRaw
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => s.replace(/^["']|["']$/gu, ""));
      continue;
    }
    data[key!] = valueRaw.replace(/^["']|["']$/gu, "");
  }
  return { data, body };
}

function yamlQuote(value: string): string {
  if (/[:#[\]{}&*!|>'"%@`\n]/u.test(value) || value.startsWith(" ") || value.endsWith(" ")) {
    return JSON.stringify(value);
  }
  return value;
}

function renderScalarBlock(key: string, value: unknown, indent = ""): string {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return `${indent}${key}: []`;
    }
    return `${indent}${key}:\n${value.map((item) => `${indent}  - ${yamlQuote(String(item))}`).join("\n")}`;
  }
  return `${indent}${key}: ${yamlQuote(String(value))}`;
}

function renderMetadata(
  metadata: Record<string, unknown> | undefined,
  personaName: string,
  canonicalPersonaRel: string,
): string {
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

export function buildAgentProjection(
  personaName: string,
  personaRaw: string,
  projectPrefix: string,
): string {
  const { data } = parseFrontmatter(personaRaw);
  const canonicalPersonaRel = posixJoin(
    projectPrefix === "." ? "" : projectPrefix,
    "lib/personas",
    `${personaName}.md`,
  );
  const personaPathForText = canonicalPersonaRel;
  const handbookPrefix = projectPrefix === "." ? "" : projectPrefix;
  const workPrefix = projectPrefix === "." ? "" : projectPrefix;

  const frontmatterKeys: Array<[string, unknown]> = [
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
  yamlLines.push(renderMetadata(data.metadata as Record<string, unknown> | undefined, personaName, canonicalPersonaRel));
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
    yamlLines[yamlLines.length - 1] = yamlLines[yamlLines.length - 1]!.replace(
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

export function buildGeneralPurposeProjection(projectPrefix: string): string {
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

function assertAgentsDirAllowed(harnessRoot: string): void {
  try {
    const manifest = loadEmbeddedInstallManifestFromRepo(harnessRoot);
    if (!manifest.harness_root_allow.includes(".cursor/agents/")) {
      throw new Error(
        "cursor-sync refused: embedded install manifest harness_root_allow does not include .cursor/agents/",
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("cursor-sync refused:")) {
      throw error;
    }
    // Greenfield harness without embedded manifest — allow sync when personas exist.
  }
}

export function runCursorSync(harnessRootInput: string, options: CursorSyncOptions = {}): CursorSyncResult {
  const dryRun = options.dryRun ?? false;
  const harnessRoot = path.resolve(harnessRootInput);
  assertAgentsDirAllowed(harnessRoot);

  const projectRootRel = readProjectRoot(harnessRoot);
  const projectRoot = projectRootAbs(harnessRoot, projectRootRel);
  const personasDir = path.join(projectRoot, "lib", "personas");
  const agentsDir = path.join(harnessRoot, ".cursor", "agents");

  if (!existsSync(personasDir)) {
    throw new Error(`Missing persona roster at ${personasDir}`);
  }

  const personaFiles = readdirSync(personasDir)
    .filter((name) => name.endsWith(".md"))
    .sort();

  if (personaFiles.length === 0) {
    throw new Error(`No persona specs found under ${personasDir}`);
  }

  if (!dryRun) {
    mkdirSync(agentsDir, { recursive: true });
  }

  const written: CursorSyncWrittenEntry[] = [];

  for (const file of personaFiles) {
    const personaName = file.replace(/\.md$/u, "");
    const personaRaw = readFileSync(path.join(personasDir, file), "utf8");
    const projection = buildAgentProjection(personaName, personaRaw, projectRootRel);
    const outRel = path.posix.join(".cursor/agents", `${personaName}.md`);
    const outAbs = path.join(harnessRoot, outRel);
    if (!dryRun) {
      writeFileSync(outAbs, projection, "utf8");
    }
    written.push({ path: outRel, action: dryRun ? "would_write" : "write" });
  }

  const gpRel = ".cursor/agents/general-purpose.md";
  const gpAbs = path.join(harnessRoot, gpRel);
  const gpProjection = buildGeneralPurposeProjection(projectRootRel);
  if (!dryRun) {
    writeFileSync(gpAbs, gpProjection, "utf8");
  }
  written.push({ path: gpRel, action: dryRun ? "would_write" : "write" });

  const gitkeep = path.join(agentsDir, ".gitkeep");
  if (existsSync(gitkeep)) {
    if (!dryRun) {
      unlinkSync(gitkeep);
    }
    written.push({ path: ".cursor/agents/.gitkeep", action: dryRun ? "would_remove" : "remove" });
  }

  return {
    command: "cursor-sync",
    status: "ok",
    dryRun,
    harnessRoot,
    projectRootRel,
    count: personaFiles.length + 1,
    written,
  };
}

/** @deprecated Prefer `runCursorSync`. */
export function syncCursorAgents(harnessRoot: string, options: CursorSyncOptions = {}): CursorSyncResult {
  return runCursorSync(harnessRoot, options);
}
