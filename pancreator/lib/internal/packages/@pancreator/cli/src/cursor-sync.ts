import {
  projectRootAbs,
  quoteJsonString,
  readProjectRoot,
  sliceOperatorAgentSection,
} from "@pancreator/core";
import {
  emitCursorMdcFromPersonaRule,
  parsePersonaRuleYaml,
} from "@pancreator/persona";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { loadEmbeddedInstallManifestFromRepo } from "./pan-init.js";
import { syncPersonaModelsFromEscalation } from "./cursor-sync-persona-models.js";

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
  activeEscalationConfig?: string;
  escalationConfigPath?: string;
  personaModelsSynced?: number;
}

export interface CursorSyncOptions {
  dryRun?: boolean;
}

function posixJoin(...parts: string[]): string {
  return parts.filter(Boolean).join("/").replace(/\/+/g, "/");
}

function parseFrontmatter(raw: string): {
  data: Record<string, unknown>;
  body: string;
} {
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
  if (
    /[:#[\]{}&*!|>'"%@`\n]/u.test(value) ||
    value.startsWith(" ") ||
    value.endsWith(" ")
  ) {
    return quoteJsonString(value);
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

function projectPath(projectPrefix: string, relPath: string): string {
  if (projectPrefix === ".") {
    return relPath;
  }
  return posixJoin(projectPrefix, relPath);
}

function readMarkdownFiles(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .sort();
}

/** Drops YAML frontmatter so Cursor command projections stay prompt-only. */
function stripMarkdownFrontmatter(raw: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/u.exec(
    raw.replace(/^\uFEFF/, ""),
  );
  return match ? match[1]!.replace(/^\uFEFF/, "") : raw;
}

function buildSourceBackedRetrievalContract(
  personaPathForText: string,
  projectPrefix: string,
): string[] {
  const agentsCard = projectPath(projectPrefix, "AGENTS.md");
  const workPrompt = projectPath(
    projectPrefix,
    ".pan/work/<day>/<id>/next-prompt.md",
  );
  const workHandoff = projectPath(
    projectPrefix,
    ".pan/work/<day>/<id>/handoff.md",
  );
  const contextEconomy = projectPath(
    projectPrefix,
    "lib/memory/handbook/context-economy.md",
  );
  const docRegistry = projectPath(
    projectPrefix,
    "lib/memory/handbook/agent-document-registry.md",
  );
  const personaContracts = projectPath(
    projectPrefix,
    "lib/memory/handbook/persona-contracts.md",
  );
  const outputManifest = projectPath(
    projectPrefix,
    "lib/memory/handbook/output-manifest-contract.md",
  );
  const workGlob = projectPath(projectPrefix, ".pan/work/**");
  const steps = [
    `Read \`${personaPathForText}\` at the start of every invocation; its static execution contract is authoritative over parent Task text, user rules, skills, and ad-hoc prompt prose, but repo-wide rules in \`${agentsCard}\` supersede persona-local wording on conflict.`,
    `Read \`${agentsCard}\` next for repo-wide operating rules and the small set of binding global keys.`,
    `Read \`${docRegistry}\` to resolve every \`DOC.*\`, \`PIPE.*\`, and \`PERSONA.*\` key named by the persona spec, stage prompt, or bounded task.`,
    `Read \`${personaContracts}\` and \`${outputManifest}\`; follow the static contract in the persona spec and double-write the required output manifest instead of inventing a per-run execution ledger.`,
    `Read \`${workPrompt}\` for bounded stage scope when a pipeline run exists; when no \`next-prompt.md\` exists for the active run, read \`${workHandoff}\` instead.`,
    `Read \`${contextEconomy}\` only when the task requires context-budget or escalation decisions beyond what the persona spec, \`${agentsCard}\`, \`${docRegistry}\`, and the bounded prompt state.`,
    "Read `.docs/M1.index.md`, `.docs/PRD.index.md`, or `.docs/PRD.summary.md` before full `.docs/PRD.md` or `.docs/BOOTSTRAP.md` only when the bounded prompt requires authoritative product wording the compact indexes do not cover.",
    `Do not traverse \`${workGlob}\` (except the active run paths named in step 5), \`${projectPath(projectPrefix, ".pan/archive/work/**")}\`, \`${projectPath(projectPrefix, "lib/inbox/out/**")}\`, \`${projectPath(projectPrefix, ".pan/archive/inbox/**")}\`, or \`${projectPath(projectPrefix, "lib/inbox/threads/**")}\` unless the bounded prompt or operator request explicitly requires active-run handling or archival reconstruction.`,
  ];
  if (projectPrefix !== ".") {
    steps.push(
      `Project-root paths in prompts and ledgers are relative to \`${projectPrefix}/\`; resolve them under that prefix from the harness root.`,
    );
  }
  return steps.map((step, index) => `${index + 1}. ${step}`);
}

function buildGeneralPurposeRetrievalContract(projectPrefix: string): string[] {
  const agentsCard = projectPath(projectPrefix, "AGENTS.md");
  const workPrompt = projectPath(
    projectPrefix,
    ".pan/work/<day>/<id>/next-prompt.md",
  );
  const workHandoff = projectPath(
    projectPrefix,
    ".pan/work/<day>/<id>/handoff.md",
  );
  const contextEconomy = projectPath(
    projectPrefix,
    "lib/memory/handbook/context-economy.md",
  );
  const docRegistry = projectPath(
    projectPrefix,
    "lib/memory/handbook/agent-document-registry.md",
  );
  const personaContracts = projectPath(
    projectPrefix,
    "lib/memory/handbook/persona-contracts.md",
  );
  const outputManifest = projectPath(
    projectPrefix,
    "lib/memory/handbook/output-manifest-contract.md",
  );
  const handbookIndex = projectPath(
    projectPrefix,
    "lib/memory/handbook/index.md",
  );
  const workGlob = projectPath(projectPrefix, ".pan/work/**");
  const steps = [
    `Read \`${agentsCard}\` first for repo-wide operating rules and the small set of binding global keys.`,
    `Read \`${docRegistry}\` to resolve \`DOC.*\`, \`PIPE.*\`, and \`PERSONA.*\` keys before loading contract docs.`,
    `Read \`${personaContracts}\` and \`${outputManifest}\`; when a persona owns the task, delegate or adopt that persona's static execution contract instead of inventing one.`,
    `Read \`${workPrompt}\` for the bounded stage scope when present; when no \`next-prompt.md\` exists for the active run, read \`${workHandoff}\` instead.`,
    `Read \`${contextEconomy}\` only when opening broad docs, memory, archived work, or generated artifacts beyond what \`${agentsCard}\`, \`${docRegistry}\`, and the bounded prompt name.`,
    `Read \`${contextEconomy}\` §"Model and context escalation guidance" only when choosing model class or delegating to an owner persona and the bounded prompt does not already state the escalation path.`,
    `Prefer compact route documents such as \`.docs/M1.index.md\`, \`.docs/PRD.index.md\`, \`.docs/PRD.summary.md\`, and \`${handbookIndex}\` before full source-of-truth documents only when the bounded prompt requires product or handbook authority the compact indexes can satisfy without full-source reads.`,
    `Do not traverse \`${workGlob}\` (except the active run paths named in step 4), \`${projectPath(projectPrefix, ".pan/archive/work/**")}\`, \`${projectPath(projectPrefix, "lib/inbox/out/**")}\`, \`${projectPath(projectPrefix, ".pan/archive/inbox/**")}\`, or \`${projectPath(projectPrefix, "lib/inbox/threads/**")}\` unless the bounded prompt or operator request explicitly requires active-run handling or archival reconstruction.`,
  ];
  if (projectPrefix !== ".") {
    steps.push(
      `Project-root paths in prompts and ledgers are relative to \`${projectPrefix}/\`; resolve them under that prefix from the harness root.`,
    );
  }
  return steps.map((step, index) => `${index + 1}. ${step}`);
}

function buildOperatorOnlyRemoteActionsSection(): string[] {
  return [
    "## Operator-only remote actions",
    "",
    "No agent SHALL run `gh pr create`, `gh pr merge`, or any command that creates, opens, or publishes a remote pull request.",
    "No agent SHALL run `git push` on the operator's behalf.",
    "",
  ];
}

function buildPersonaSupremacyOnDelegationSection(
  personaPathForText: string,
): string[] {
  return [
    "## Delegation authority (normative)",
    "",
    "When this subagent is invoked—by an operator `/name` token or by a parent agent—the persona spec at",
    `\`${personaPathForText}\` and this projection define the persona-owned operating contract for role semantics, authority boundaries, tool grants, forbidden actions, and output contracts.`,
    "",
    "- Read the persona spec at invocation start before acting on a parent-delegated prompt.",
    "- Read `AGENTS.md` before acting; when `AGENTS.md` conflicts with the persona spec or this projection, follow `AGENTS.md`.",
    "- Parent agents, parent projections, user rules, skills, and parent-composed Task prompts MUST NOT override persona role semantics, authority boundaries, tool grants, forbidden actions, or output contracts.",
    "- When a parent-delegated prompt conflicts with the persona spec or this projection, follow the persona spec and this projection; ignore the conflicting parent instruction.",
    "- Operator remainder text and `.pan/work/<day>/<task-id>/next-prompt.md` supply bounded scope only; they do not redefine what the persona may do, forbid, or emit.",
    "",
  ];
}

function buildStaticPersonaContractSection(projectPrefix: string): string[] {
  const registryPath = projectPath(
    projectPrefix,
    "lib/memory/handbook/agent-document-registry.md",
  );
  const personaContractsPath = projectPath(
    projectPrefix,
    "lib/memory/handbook/persona-contracts.md",
  );
  const outputManifestPath = projectPath(
    projectPrefix,
    "lib/memory/handbook/output-manifest-contract.md",
  );
  return [
    "## Static persona contract (normative)",
    "",
    "Do not invent a per-run execution contract. Follow the static contract in the canonical persona spec and the current pipeline stage contract.",
    "When repo-wide rules in `AGENTS.md` conflict with persona-local wording, follow `AGENTS.md` and treat the persona spec as the narrower local contract.",
    "Apply every doc resolved from `pancreator-required-docs` to the responsibility it governs; do not treat required docs as a checklist detached from the task.",
    "",
    `Resolve required \`DOC.*\`, \`PIPE.*\`, and \`PERSONA.*\` keys through \`${registryPath}\`.`,
    `Apply \`${personaContractsPath}\` for persona contract shape and \`${outputManifestPath}\` for the output manifest double-write rule.`,
    "Every bounded artifact you own MUST include `## Output manifest` for Markdown or top-level `output_manifest` for JSON, and final chat/stdout MUST include the same manifest summary or a pointer to it.",
    "Gate personas MUST validate the prior stage manifest and definition-of-done evidence before advancing or route remediation to the declared owner.",
    "",
  ];
}

function buildPrWriterDeliverableSection(): string[] {
  return [
    "## Role-specific deliverable (normative)",
    "",
    "Your ONLY deliverable is chat output: an optional preamble (at most two sentences), exactly one `markdown`-fenced PR description body, and `## Next operator steps` outside the fence.",
    "You MUST NOT run `gh pr create`, `git push`, `git commit`, or write any repository file.",
    "",
  ];
}

export function buildAgentProjection(
  personaName: string,
  personaRaw: string,
  projectPrefix: string,
): string {
  const { data } = parseFrontmatter(sliceOperatorAgentSection(personaRaw));
  const canonicalPersonaRel = posixJoin(
    projectPrefix === "." ? "" : projectPrefix,
    "lib/personas",
    `${personaName}.md`,
  );
  const personaPathForText = canonicalPersonaRel;

  const personaDescription =
    typeof data.description === "string" && data.description.trim().length > 0
      ? data.description.trim()
      : `Canonical \`${personaName}\` subagent projection for persona-owned pipeline stages.`;

  const frontmatterKeys: Array<[string, unknown]> = [
    ["name", personaName],
    ["description", personaDescription],
    ["model", data.model ?? "auto"],
    ["permissionMode", data.permissionMode ?? "default"],
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
    if (key === "model") {
      yamlLines.push(`model: ${String(value)}`);
      continue;
    }
    yamlLines.push(renderScalarBlock(key, value));
  }
  yamlLines.push("---", "", `# ${personaName}`, "");
  yamlLines.push(
    `This file is the canonical Cursor projection for \`${personaName}\` at \`${personaPathForText}\`. It intentionally avoids duplicating persona prose,`,
    "PRD citations, and handbook excerpts so Cursor subagent startup stays small.",
    "",
    ...buildOperatorOnlyRemoteActionsSection(),
    ...buildPersonaSupremacyOnDelegationSection(personaPathForText),
    ...buildStaticPersonaContractSection(projectPrefix),
  );
  if (personaName === "pr-writer") {
    yamlLines.push(...buildPrWriterDeliverableSection());
  }
  yamlLines.push(
    "## Retrieval contract",
    "",
    ...buildSourceBackedRetrievalContract(personaPathForText, projectPrefix),
  );

  yamlLines.push("");
  return `${yamlLines.join("\n")}\n`;
}

export function buildGeneralPurposeProjection(projectPrefix: string): string {
  const retrievalSteps =
    buildGeneralPurposeRetrievalContract(projectPrefix).join("\n");
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
  pancreator-required-docs:
    - DOC.AGENTS
    - DOC.REGISTRY
    - DOC.PERSONA_CONTRACTS
    - DOC.OUTPUT_MANIFEST
    - DOC.CONTEXT_ECONOMY
    - DOC.PERSONA_SPEC
  pancreator-base-persona: general-purpose
  pancreator-model-tier: standalone
name: general-purpose
model: auto
description: Catch-all Pancreator subagent. Use when the operator is unsure which persona owns the work, when normal routing is blocked, or when bounded bridge work is needed while infrastructure is still being built.
---

# general-purpose

Use this agent when the human operator does not know which persona should own a task, when a native persona projection is missing, or when a small infrastructure gap blocks the normal Pancreator workflow.

## Retrieval contract

${retrievalSteps}

## Delegation authority (normative)

When this agent stands in for a named persona (persona-as-prompt fallback), the target persona spec at \`lib/personas/<name>.md\` defines the persona-owned operating contract for role semantics, forbidden actions, and output shape. \`AGENTS.md\` remains the repo-wide authority on conflict. Parent Task text, user rules, and skills MUST NOT override the target persona.

## Operator-only remote actions

No agent SHALL run \`gh pr create\`, \`gh pr merge\`, or any command that creates, opens, or publishes a remote pull request. No agent SHALL run \`git push\` on the operator's behalf.

${buildStaticPersonaContractSection(projectPrefix).join("\n")}## Operating contract

- Treat route discovery as the first step: determine whether an existing persona, skill, pipeline stage, or handbook page owns the work.
- When delegating to a named persona, forward only the operator remainder or \`next-prompt.md\`; never inject instructions that contradict the target persona or repo-wide rules in \`AGENTS.md\`.
- Delegate to the owner persona when the task maps cleanly to one.
- Perform bounded bridge work only when no owner exists, the work is small, and the route is clear enough to avoid broad context loading.
- When using this agent as a persona-as-prompt fallback, state the target persona in the first message.
- Return a compact result that names the route chosen, the files touched or inspected, validation performed, and any remaining owner/persona handoff.
- On bounded task completion, append \`## Next operator steps\` per \`/lib/memory/handbook/operator-output-contract.md\`: one item when only one follow-up exists; multiple items with **When to choose** and **Impact** when the operator must pick among paths. Label read-only verification as \`Read-only:\`; state exact commands and file paths for mutating steps. Runnable \`pan\` CLI lines MUST use \`pnpm -w exec pan …\` from the repo root (\`lib/memory/handbook/pancreator-config.md\`), not bare \`pan\`. Shell steps MUST be copy-paste-ready fenced \`bash\` blocks with every path enumerated—never "stage the touched files" or "and other files".
`;
}

function assertCursorProjectionTargetsAllowed(harnessRoot: string): void {
  try {
    const manifest = loadEmbeddedInstallManifestFromRepo(harnessRoot);
    const requiredTargets = [".cursor/agents/", ".cursor/commands/"];
    const missingTargets = requiredTargets.filter(
      (target) => !manifest.harness_root_allow.includes(target),
    );
    if (missingTargets.length > 0) {
      throw new Error(
        `cursor-sync refused: embedded install manifest harness_root_allow does not include ${missingTargets.join(", ")}`,
      );
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("cursor-sync refused:")
    ) {
      throw error;
    }
    // Greenfield harness without embedded manifest — allow sync when personas exist.
  }
}

function emitCursorRules(
  harnessRoot: string,
  projectRoot: string,
  projectRootRel: string,
  dryRun: boolean,
): CursorSyncWrittenEntry[] {
  const written: CursorSyncWrittenEntry[] = [];
  const rulesSourceDir = path.join(projectRoot, "lib", "personas", "rules");
  const rulesTargetDir = path.join(harnessRoot, ".cursor", "rules");

  if (!existsSync(rulesSourceDir)) {
    return written;
  }

  const sourceFiles = readdirSync(rulesSourceDir)
    .filter((name) => name.endsWith(".yaml"))
    .sort();
  const sourceSet = new Set(
    sourceFiles.map((file) => file.replace(/\.yaml$/u, ".mdc")),
  );

  if (!dryRun && sourceFiles.length > 0) {
    mkdirSync(rulesTargetDir, { recursive: true });
  }

  for (const file of sourceFiles) {
    const personaName = file.replace(/\.yaml$/u, "");
    const ruleRaw = readFileSync(path.join(rulesSourceDir, file), "utf8");
    const rule = parsePersonaRuleYaml(ruleRaw, personaName);
    const mdc = emitCursorMdcFromPersonaRule(rule, projectRootRel);
    const outRel = path.posix.join(".cursor/rules", `${personaName}.mdc`);
    if (!dryRun) {
      writeFileSync(
        path.join(rulesTargetDir, `${personaName}.mdc`),
        mdc,
        "utf8",
      );
    }
    written.push({ path: outRel, action: dryRun ? "would_write" : "write" });
  }

  if (existsSync(rulesTargetDir)) {
    for (const existing of readdirSync(rulesTargetDir).filter((name) =>
      name.endsWith(".mdc"),
    )) {
      if (!sourceSet.has(existing)) {
        const outRel = path.posix.join(".cursor/rules", existing);
        if (!dryRun) {
          unlinkSync(path.join(rulesTargetDir, existing));
        }
        written.push({
          path: outRel,
          action: dryRun ? "would_remove" : "remove",
        });
      }
    }
  }

  return written;
}

function emitCursorCommands(
  harnessRoot: string,
  projectRoot: string,
  commandFiles: string[],
  dryRun: boolean,
): CursorSyncWrittenEntry[] {
  const written: CursorSyncWrittenEntry[] = [];
  const commandsSourceDir = path.join(projectRoot, "lib", "commands");
  const commandsTargetDir = path.join(harnessRoot, ".cursor", "commands");

  if (commandFiles.length === 0) {
    return written;
  }

  if (!dryRun) {
    mkdirSync(commandsTargetDir, { recursive: true });
  }

  for (const file of commandFiles) {
    const commandRaw = readFileSync(path.join(commandsSourceDir, file), "utf8");
    const commandBody = stripMarkdownFrontmatter(
      sliceOperatorAgentSection(commandRaw),
    );
    const outRel = path.posix.join(".cursor/commands", file);
    const outAbs = path.join(harnessRoot, outRel);
    if (!dryRun) {
      writeFileSync(outAbs, commandBody, "utf8");
    }
    written.push({ path: outRel, action: dryRun ? "would_write" : "write" });
  }

  const gitkeep = path.join(commandsTargetDir, ".gitkeep");
  if (existsSync(gitkeep)) {
    if (!dryRun) {
      unlinkSync(gitkeep);
    }
    written.push({
      path: ".cursor/commands/.gitkeep",
      action: dryRun ? "would_remove" : "remove",
    });
  }

  return written;
}

const DEFAULT_CURSOR_HOOKS_JSON = `{
  "version": 1,
  "hooks": {
    "beforeShellExecution": []
  }
}
`;

function emitCursorHooks(
  harnessRoot: string,
  dryRun: boolean,
): CursorSyncWrittenEntry[] {
  const hooksDir = path.join(harnessRoot, ".cursor");
  const outRel = ".cursor/hooks.json";
  const outAbs = path.join(harnessRoot, outRel);
  const content = DEFAULT_CURSOR_HOOKS_JSON;
  if (!dryRun) {
    mkdirSync(hooksDir, { recursive: true });
    writeFileSync(outAbs, content, "utf8");
  }
  return [{ path: outRel, action: dryRun ? "would_write" : "write" }];
}

export function runCursorSync(
  harnessRootInput: string,
  options: CursorSyncOptions = {},
): CursorSyncResult {
  const dryRun = options.dryRun ?? false;
  const harnessRoot = path.resolve(harnessRootInput);
  assertCursorProjectionTargetsAllowed(harnessRoot);

  const projectRootRel = readProjectRoot(harnessRoot);
  const projectRoot = projectRootAbs(harnessRoot, projectRootRel);
  const personasDir = path.join(projectRoot, "lib", "personas");
  const commandsDir = path.join(projectRoot, "lib", "commands");
  const agentsDir = path.join(harnessRoot, ".cursor", "agents");

  if (!existsSync(personasDir)) {
    throw new Error(`Missing persona roster at ${personasDir}`);
  }

  const personaFiles = readMarkdownFiles(personasDir);
  const commandFiles = readMarkdownFiles(commandsDir);

  if (personaFiles.length === 0) {
    throw new Error(`No persona specs found under ${personasDir}`);
  }

  const personaModelSync = syncPersonaModelsFromEscalation(
    harnessRoot,
    projectRootRel,
    { dryRun },
  );

  if (!dryRun) {
    mkdirSync(agentsDir, { recursive: true });
  }

  const written: CursorSyncWrittenEntry[] = [...personaModelSync.written];

  for (const file of personaFiles) {
    const personaName = file.replace(/\.md$/u, "");
    const personaRaw = readFileSync(path.join(personasDir, file), "utf8");
    const projection = buildAgentProjection(
      personaName,
      personaRaw,
      projectRootRel,
    );
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
    written.push({
      path: ".cursor/agents/.gitkeep",
      action: dryRun ? "would_remove" : "remove",
    });
  }

  written.push(...emitCursorCommands(harnessRoot, projectRoot, commandFiles, dryRun));
  written.push(
    ...emitCursorRules(harnessRoot, projectRoot, projectRootRel, dryRun),
  );
  written.push(...emitCursorHooks(harnessRoot, dryRun));

  return {
    command: "cursor-sync",
    status: "ok",
    dryRun,
    harnessRoot,
    projectRootRel,
    count: personaFiles.length + 1 + commandFiles.length,
    written,
    ...(personaModelSync.activeConfigName !== undefined
      ? { activeEscalationConfig: personaModelSync.activeConfigName }
      : {}),
    ...(personaModelSync.escalationConfigPath !== undefined
      ? { escalationConfigPath: personaModelSync.escalationConfigPath }
      : {}),
    ...(personaModelSync.written.length > 0
      ? { personaModelsSynced: personaModelSync.written.length }
      : {}),
  };
}

/** @deprecated Prefer `runCursorSync`. */
export function syncCursorAgents(
  harnessRoot: string,
  options: CursorSyncOptions = {},
): CursorSyncResult {
  return runCursorSync(harnessRoot, options);
}
