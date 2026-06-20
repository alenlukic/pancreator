import {
  formatCanonicalJson,
  projectRootAbs,
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
import { fileURLToPath } from "node:url";
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

const PROJECT_REBASE_PATH_PREFIXES = [
  "pancreator/",
  "lib/",
  ".pan/",
  ".docs/",
  "tests/",
] as const;

function deliveryOperatingCardPath(projectPrefix: string): string {
  if (projectPrefix === ".pancreator") {
    return ".pancreator/AGENTS.md";
  }
  return "AGENTS.md";
}

function deliveryOperationProceduresPath(projectPrefix: string): string {
  if (projectPrefix === ".pancreator") {
    return ".pancreator/OPERATION.md";
  }
  return "OPERATION.md";
}

function rebaseProjectionPaths(raw: string, projectPrefix: string): string {
  if (projectPrefix === ".") {
    return raw;
  }
  const escapedPrefix = projectPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let rewritten = raw;
  for (const token of PROJECT_REBASE_PATH_PREFIXES) {
    const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const tokenReplacement =
      token === "pancreator/" ? `${projectPrefix}/` : `${projectPrefix}/${token}`;
    const slashTokenReplacement =
      token === "pancreator/" ? `/${projectPrefix}/` : `/${projectPrefix}/${token}`;
    // token form, e.g. `lib/...`
    const tokenRegex = new RegExp(
      `(^|[\\s\\t\\r\\n\`"'([{<>=,;:])${escapedToken}`,
      "gmu",
    );
    rewritten = rewritten.replace(tokenRegex, `$1${tokenReplacement}`);
    // slash-prefixed token form, e.g. `/lib/...`
    const slashTokenRegex = new RegExp(
      `(^|[\\s\\t\\r\\n\`"'([{<>=,;:])/${escapedToken}`,
      "gmu",
    );
    rewritten = rewritten.replace(slashTokenRegex, `$1${slashTokenReplacement}`);
  }
  if (projectPrefix === ".pancreator") {
    rewritten = rewritten.replace(
      /(^|[\s`"'([{<>=,;:])(?<!\.)AGENTS\.md/gu,
      `$1${deliveryOperatingCardPath(projectPrefix)}`,
    );
    rewritten = rewritten.replace(
      /(^|[\s`"'([{<>=,;:])(?<!\.)OPERATION\.md/gu,
      `$1${deliveryOperationProceduresPath(projectPrefix)}`,
    );
  }
  // Avoid double-prefixing from overlapping replacements (e.g. pancreator/pancreator/...).
  const dedupeRegex = new RegExp(`/${escapedPrefix}/${escapedPrefix}/`, "g");
  rewritten = rewritten.replace(dedupeRegex, `/${projectPrefix}/`);
  const dedupeNoLeadingSlash = new RegExp(`${escapedPrefix}/${escapedPrefix}/`, "g");
  rewritten = rewritten.replace(dedupeNoLeadingSlash, `${projectPrefix}/`);
  return rewritten;
}

function buildGeneralPurposeRetrievalContract(projectPrefix: string): string[] {
  const agentsCard = deliveryOperatingCardPath(projectPrefix);
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
    `Re-read \`${agentsCard}\` §2 only when delegating to an owner persona or launching an ad-hoc subagent and the bounded prompt does not already state the delegation path.`,
    `Prefer compact route documents such as \`.docs/M1.index.md\`, \`.docs/PRD.index.md\`, \`.docs/PRD.summary.md\`, and \`${handbookIndex}\` before full source-of-truth documents only when the bounded prompt requires product or handbook authority the compact indexes can satisfy without full-source reads.`,
    `Do not traverse \`${workGlob}\` (except the active run paths named in step 4), \`${projectPath(projectPrefix, ".pan/archive/work/**")}\`, \`${projectPath(projectPrefix, "lib/inbox/out/**")}\`, \`${projectPath(projectPrefix, ".pan/archive/inbox/**")}\`, or \`${projectPath(projectPrefix, "lib/inbox/threads/**")}\` unless the bounded prompt or operator request explicitly requires active-run handling or archival reconstruction.`,
  ];
  if (projectPrefix !== ".") {
    steps.push(
      `Project-root paths in prompts and ledgers are relative to \`${projectPrefix}/\`; resolve them under that prefix from the harness root. Harness-root paths (\`${agentsCard}\`, \`.cursor/**\`, \`.env\`) stay at the harness root unless embedded layout places delivery cards under \`${projectPrefix}/\`.`,
    );
  }
  return steps.map((step, index) => `${index + 1}. ${step}`);
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

export function buildAgentProjection(
  _personaName: string,
  personaRaw: string,
  projectPrefix: string,
): string {
  const source = personaRaw.replace(/^\uFEFF/u, "");
  const rewritten = rebaseProjectionPaths(source, projectPrefix);
  return rewritten.endsWith("\n") ? rewritten : `${rewritten}\n`;
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
- For shell-first repository inspection, prefer RTK wrappers such as \`rtk read <path> -l aggressive\`, \`rtk grep <pattern> <path> --ultra-compact\`, and \`rtk git status|diff|log\`.
- Treat built-in \`Read\`, \`Grep\`, and raw shell output as exception paths for exact-path or full-fidelity follow-up only when RTK output omits required detail.
- When RTK output is insufficient, retry with a narrower RTK command before broad raw output.
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

const MANAGED_RTK_HOOK_COMMAND = "bash .cursor/hooks/pancreator-rtk-before-shell.sh";
const MANAGED_RTK_HOOK_REL = ".cursor/hooks/pancreator-rtk-before-shell.sh";
const MANAGED_RTK_HOOK_SOURCE_REL =
  "lib/internal/tools/cursor/pancreator-rtk-before-shell.sh";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeManagedHookJson(existingRaw: string | undefined): string {
  let base: Record<string, unknown> = {};
  if (typeof existingRaw === "string" && existingRaw.trim().length > 0) {
    try {
      const parsed = JSON.parse(existingRaw);
      if (isRecord(parsed)) {
        base = { ...parsed };
      }
    } catch {
      base = {};
    }
  }

  const hooks = isRecord(base.hooks) ? { ...base.hooks } : {};
  const beforeShell = Array.isArray(hooks.beforeShellExecution)
    ? [...hooks.beforeShellExecution]
    : [];
  const preserved = beforeShell.filter((entry) => {
    if (!isRecord(entry)) {
      return true;
    }
    return entry.command !== MANAGED_RTK_HOOK_COMMAND;
  });
  hooks.beforeShellExecution = [
    ...preserved,
    { command: MANAGED_RTK_HOOK_COMMAND, failClosed: false },
  ];

  base.version = 1;
  base.hooks = hooks;
  return `${formatCanonicalJson(base, 0)}\n`;
}

function resolveManagedRtkHookSource(projectRoot: string): string {
  const projectSource = path.join(projectRoot, MANAGED_RTK_HOOK_SOURCE_REL);
  if (existsSync(projectSource)) {
    return projectSource;
  }

  const here = path.dirname(fileURLToPath(import.meta.url));
  const packagedSource = path.resolve(
    here,
    "..",
    "..",
    "..",
    "..",
    "tools",
    "cursor",
    "pancreator-rtk-before-shell.sh",
  );
  if (existsSync(packagedSource)) {
    return packagedSource;
  }

  throw new Error(
    `Missing managed RTK hook source at ${projectSource} and ${packagedSource}`,
  );
}

function emitCursorHooks(
  harnessRoot: string,
  projectRoot: string,
  dryRun: boolean,
): CursorSyncWrittenEntry[] {
  const written: CursorSyncWrittenEntry[] = [];
  const cursorDir = path.join(harnessRoot, ".cursor");
  const hooksDir = path.join(cursorDir, "hooks");
  const hooksJsonRel = ".cursor/hooks.json";
  const hooksJsonAbs = path.join(harnessRoot, hooksJsonRel);
  const hookScriptAbs = path.join(harnessRoot, MANAGED_RTK_HOOK_REL);
  const hookSourceAbs = resolveManagedRtkHookSource(projectRoot);
  const hookScriptContent = readFileSync(hookSourceAbs, "utf8");
  const existingHooksRaw = existsSync(hooksJsonAbs)
    ? readFileSync(hooksJsonAbs, "utf8")
    : undefined;
  const mergedHooksJson = mergeManagedHookJson(existingHooksRaw);

  if (!dryRun) {
    mkdirSync(cursorDir, { recursive: true });
    mkdirSync(hooksDir, { recursive: true });
    writeFileSync(hooksJsonAbs, mergedHooksJson, "utf8");
    writeFileSync(hookScriptAbs, hookScriptContent, "utf8");
  }
  written.push({
    path: hooksJsonRel,
    action: dryRun ? "would_write" : "write",
  });
  written.push({
    path: MANAGED_RTK_HOOK_REL,
    action: dryRun ? "would_write" : "write",
  });

  const hooksGitkeep = path.join(hooksDir, ".gitkeep");
  if (existsSync(hooksGitkeep)) {
    if (!dryRun) {
      unlinkSync(hooksGitkeep);
    }
    written.push({
      path: ".cursor/hooks/.gitkeep",
      action: dryRun ? "would_remove" : "remove",
    });
  }

  return written;
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
  written.push(...emitCursorHooks(harnessRoot, projectRoot, dryRun));

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
