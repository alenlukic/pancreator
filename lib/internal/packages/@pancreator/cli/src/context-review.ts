import { resolveRepoPath } from "@pancreator/core";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const CONTEXT_REVIEWER_PERSONA = "context-reviewer" as const;

export const DEFAULT_CONTEXT_REVIEW_WORKSPACE = "sandbox/context-review" as const;

export function contextReviewPromptRel(workspaceDir: string): string {
  return path.posix.join(workspaceDir, "context-review-prompt.md");
}

export function contextReviewReportRel(workspaceDir: string): string {
  return path.posix.join(workspaceDir, "context-review.md");
}

/** Resolves Cursor agent-transcript directory for the repository. */
export function resolveAgentTranscriptsDir(repoRoot: string): string {
  const override = process.env.PAN_AGENT_TRANSCRIPTS_DIR?.trim();
  if (override !== undefined && override.length > 0) {
    return override;
  }
  const slug = path.resolve(repoRoot).replace(/\//gu, "-").replace(/^-/u, "");
  return path.join(os.homedir(), ".cursor", "projects", slug, "agent-transcripts");
}

export function extractTouchSetPaths(touchSetRaw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(touchSetRaw) as unknown;
  } catch {
    return [];
  }
  if (parsed === null || typeof parsed !== "object") {
    return [];
  }
  const record = parsed as Record<string, unknown>;
  const candidates: string[] = [];
  for (const key of ["paths", "allowed_paths"] as const) {
    const value = record[key];
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === "string" && entry.trim().length > 0) {
          candidates.push(entry.replace(/\\/gu, "/").replace(/^\/+/u, ""));
        }
      }
    }
  }
  return [...new Set(candidates)];
}

function assertSafeRepoRelative(rel: string, label: string): string {
  const norm = rel.replace(/\\/gu, "/").replace(/^\/+/, "");
  if (norm === "" || norm.includes("\0") || norm.split("/").some((part) => part === "..")) {
    throw new Error(`${label} MUST be a safe repo-relative path.`);
  }
  return norm;
}

function normalizeWorkspaceDir(value: string | undefined): string {
  const workspace = assertSafeRepoRelative(
    value?.trim() ?? DEFAULT_CONTEXT_REVIEW_WORKSPACE,
    "workspace",
  );
  if (!workspace.startsWith("sandbox/")) {
    throw new Error(`workspace MUST be under sandbox/; got ${workspace}.`);
  }
  return workspace;
}

function normalizeOptionalRunDir(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  const runDir = assertSafeRepoRelative(value.trim(), "run-dir");
  const parts = runDir.split("/").filter(Boolean);
  if (parts.length !== 3 || parts[0] !== "work") {
    throw new Error(`run-dir MUST be work/<day>/<slug>; got ${runDir}.`);
  }
  return runDir;
}

function normalizeScopePaths(values: string[] | string | undefined): string[] {
  if (values === undefined) {
    return [];
  }
  const list = Array.isArray(values) ? values : [values];
  if (list.length === 0) {
    return [];
  }
  return [...new Set(list.map((entry) => assertSafeRepoRelative(entry.trim(), "scope-path")))];
}

function optionalArtifactLines(runDir: string | undefined): string {
  if (runDir === undefined) {
    return "- (none — no `--run-dir` supplied; use operator scope paths and git diff only)";
  }
  const join = (name: string): string => `\`${path.posix.join(runDir, name)}\``;
  return [
    `- ${join("plan.md")} (when present)`,
    `- ${join("handoff.md")} (when present)`,
    `- ${join("touch-set.json")} (when present)`,
    `- ${join("implementation-report.md")} (when present)`,
    `- ${join("review.md")} (when present)`,
    `- ${join("test-report.md")} (when present)`,
    `- ${join("run.log.jsonl")} (when present)`,
  ].join("\n");
}

export function renderContextReviewPrompt(input: {
  reviewLabel: string;
  workspaceDir: string;
  scopePaths: string[];
  runDir?: string;
  contextPaths: string[];
  transcriptsDir: string;
}): string {
  const scopeLines =
    input.scopePaths.length > 0
      ? input.scopePaths.map((p) => `- \`${p}\``).join("\n")
      : "- (scope empty — use full working-tree diff)";
  const contextLines =
    input.contextPaths.length > 0
      ? input.contextPaths.map((p) => `- \`${p}\``).join("\n")
      : "- (none beyond git history and agent transcripts)";
  return `# Context review — ${input.reviewLabel}

You are \`${CONTEXT_REVIEWER_PERSONA}\` in operator-only out-of-band mode.

This review is **advisory**. It does not gate \`review_passes\`, \`qa_passes\`, or \`pan advance\`.
It does **not** require a feature-delivery task id or \`state.json\`.

## Read order

1. \`AGENTS.md\` §4–§5 only when this prompt omits a required operating rule.
2. \`lib/personas/context-reviewer.md\` for output shape and constraints.
3. Operator context paths (read when present; skip missing files and record the gap):
${contextLines}
4. Optional run artifacts from \`--run-dir\` (when present only):
${optionalArtifactLines(input.runDir)}
5. Git history and diff scoped to:
${scopeLines}
   - \`git log --oneline -20\` for recent commit messages on the branch
6. Agent transcripts: \`${input.transcriptsDir}\` — read recent sessions relevant to this change window.

Do **not** read \`lib/inbox/notes/\`.

Use \`${input.workspaceDir}/\` for isolated command replay when needed.

## Output

- Advisory report: \`${contextReviewReportRel(input.workspaceDir)}\`
- Required sections and verdict fields per \`lib/personas/context-reviewer.md\`

Do not run \`pan advance\` or Spec Contract runners.
`;
}

async function resolveScopePaths(input: {
  repoRoot: string;
  runDir?: string;
  scopePaths: string[];
}): Promise<string[]> {
  const merged = [...input.scopePaths];
  if (input.runDir !== undefined) {
    const touchSetAbs = resolveRepoPath(
      input.repoRoot,
      path.posix.join(input.runDir, "touch-set.json"),
    );
    if (existsSync(touchSetAbs)) {
      const raw = await readFile(touchSetAbs, "utf8");
      merged.push(...extractTouchSetPaths(raw));
    }
  }
  return [...new Set(merged)];
}

export interface ScaffoldContextReviewInput {
  repoRoot: string;
  workspace?: string;
  runDir?: string;
  scopePaths?: string[] | string;
  contextPaths?: string[] | string;
}

export interface ScaffoldContextReviewResult {
  command: "context-review scaffold";
  status: "ok";
  workspace: string;
  promptFile: string;
  expectedArtifact: string;
  agentTranscriptsDir: string;
  persona: typeof CONTEXT_REVIEWER_PERSONA;
  runDir?: string;
  scopePaths: string[];
}

export async function scaffoldContextReview(
  input: ScaffoldContextReviewInput,
): Promise<ScaffoldContextReviewResult> {
  const repoRoot = path.resolve(input.repoRoot);
  const workspace = normalizeWorkspaceDir(input.workspace);
  const runDir = normalizeOptionalRunDir(input.runDir);
  const explicitScope = normalizeScopePaths(input.scopePaths);
  const contextPaths = normalizeScopePaths(input.contextPaths);
  const scopePaths = await resolveScopePaths({ repoRoot, runDir, scopePaths: explicitScope });
  const transcriptsDir = resolveAgentTranscriptsDir(repoRoot);
  const reviewLabel = path.posix.basename(workspace);
  const promptRel = contextReviewPromptRel(workspace);
  const promptAbs = resolveRepoPath(repoRoot, promptRel);

  await mkdir(path.dirname(promptAbs), { recursive: true });
  await writeFile(
    promptAbs,
    renderContextReviewPrompt({
      reviewLabel,
      workspaceDir: workspace,
      scopePaths,
      runDir,
      contextPaths,
      transcriptsDir,
    }),
    "utf8",
  );

  return {
    command: "context-review scaffold",
    status: "ok",
    workspace,
    promptFile: promptRel,
    expectedArtifact: contextReviewReportRel(workspace),
    agentTranscriptsDir: transcriptsDir,
    persona: CONTEXT_REVIEWER_PERSONA,
    runDir,
    scopePaths,
  };
}
