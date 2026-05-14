import { asTaskId, type TaskId } from "@tesseract/core";
import type { InterventionState } from "@tesseract/intervention";
import { loadPipelineYaml, type PipelineDefinition, type PipelineStage } from "@tesseract/pipeline";
import {
  appendRunLogRecord,
  newSpanId,
  newTraceId,
  rfc3339UtcMs,
  type RunLogRecord,
} from "@tesseract/run-logger";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const FEATURE_DELIVERY_STATE_SCHEMA_VERSION = "1" as const;

const FDS_UTC_MS = Date.UTC(2500, 0, 1, 0, 0, 0, 0);
const FEATURE_DELIVERY_STAGES = [
  "intake",
  "plan",
  "implement",
  "review",
  "report",
  "ship",
  "index",
] as const;
const TERMINAL_STAGE = "complete" as const;

type FeatureDeliveryStageId = (typeof FEATURE_DELIVERY_STAGES)[number];
type FeatureDeliveryCurrentStage = FeatureDeliveryStageId | typeof TERMINAL_STAGE;

export type StageStatus = "ready" | "pending" | "complete" | "blocked" | "skipped";
export type PipelineStatus =
  | "ready_for_intake_delegation"
  | "ready_for_stage_delegation"
  | "waiting_for_human_gate"
  | "complete"
  | "repaired";

export interface FeatureDeliveryStageState {
  id: string;
  persona?: string;
  label?: string;
  status: StageStatus;
  humanGate?: string;
  humanAttention?: string;
}

export interface FeatureDeliveryTransition {
  from: string;
  on: string;
  to: string;
  humanAttention?: string;
}

export interface FeatureDeliveryAdvanceHistoryEntry {
  atIso: string;
  kind: "advance" | "repair";
  from: string;
  to: string;
  event: string;
  artifact: string;
  reason?: string;
}

export interface FeatureDeliveryState {
  schemaVersion: typeof FEATURE_DELIVERY_STATE_SCHEMA_VERSION;
  pipelineId: "feature-delivery";
  taskId: string;
  featureId: string;
  status: PipelineStatus;
  currentStage: FeatureDeliveryCurrentStage;
  createdAtIso: string;
  source: {
    inboxEntry: string;
    inboxPath: string;
  };
  artifacts: {
    runDir: string;
    stateFile: string;
    handoffFile: string;
    runLogFile: string;
    nextPromptFile?: string;
  };
  stages: FeatureDeliveryStageState[];
  transitions: FeatureDeliveryTransition[];
  nextHumanAction: string;
  advanceHistory?: FeatureDeliveryAdvanceHistoryEntry[];
}

export interface StartFeatureDeliveryInput {
  repoRoot: string;
  inboxEntry: string;
  featureId?: string;
  taskId?: string;
  clock?: () => Date;
}

export interface StartFeatureDeliveryResult {
  command: "run" | "feature new";
  status: "ok";
  pipelineId: "feature-delivery";
  taskId: string;
  featureId: string;
  runDir: string;
  stateFile: string;
  handoffFile: string;
  runLogFile: string;
  nextPromptFile: string;
  currentStage: "intake";
  nextHumanAction: string;
}

export interface FeatureDeliveryStatusResult {
  command: "status";
  status: "ok";
  taskId: string;
  pipelineId: string;
  featureId: string;
  currentStage: string;
  pipelineStatus: string;
  interventionState: InterventionState;
  runDir: string;
  stateFile: string;
  nextPromptFile: string | null;
  nextHumanAction: string;
}

export interface AdvanceFeatureDeliveryInput {
  repoRoot: string;
  taskId: string;
  artifact: string;
  event?: string;
  clock?: () => Date;
}

export interface AdvanceFeatureDeliveryResult {
  command: "advance";
  status: "ok";
  taskId: string;
  featureId: string;
  fromStage: string;
  event: string;
  currentStage: string;
  artifact: string;
  stateFile: string;
  handoffFile: string;
  nextPromptFile: string;
  nextPersona: string | null;
  nextHumanAction: string;
}

export interface RepairFeatureDeliveryStateInput {
  repoRoot: string;
  taskId: string;
  stage: string;
  artifact: string;
  reason: string;
  clock?: () => Date;
}

export interface RepairFeatureDeliveryStateResult {
  command: "repair-state";
  status: "ok";
  taskId: string;
  featureId: string;
  previousStage: string;
  currentStage: string;
  artifact: string;
  reason: string;
  stateFile: string;
  handoffFile: string;
  nextPromptFile: string;
  nextPersona: string | null;
  nextHumanAction: string;
}

export async function startFeatureDelivery(
  input: StartFeatureDeliveryInput,
  command: "run" | "feature new" = "run",
): Promise<StartFeatureDeliveryResult> {
  const repoRoot = path.resolve(input.repoRoot);
  const now = input.clock?.() ?? new Date();
  const inboxRel = assertInboxInRelativePath(input.inboxEntry, "inbox entry");
  const inboxPath = path.join(repoRoot, "src", "inbox", "in", ...inboxRel.split("/"));
  const directive = await readFile(inboxPath, "utf8");
  const pipelinePath = path.join(repoRoot, "src", "pipelines", "feature-delivery.yaml");
  const pipeline = loadPipelineYaml(pipelinePath);
  if (pipeline.id !== "feature-delivery") {
    throw new Error(`Expected feature-delivery pipeline at ${pipelinePath}; found ${pipeline.id}.`);
  }

  const featureId = sanitizeSlug(
    input.featureId ?? deriveFeatureId(path.posix.basename(inboxRel), directive),
  );
  const taskId = sanitizeTaskId(input.taskId ?? makeTaskId(now, featureId));
  const dayDir = makeDayDir(now);
  const runDirRel = path.posix.join("src", "work", dayDir, taskId);
  const runDir = path.join(repoRoot, "src", "work", dayDir, taskId);
  const stateFileRel = path.posix.join(runDirRel, "state.json");
  const handoffFileRel = path.posix.join(runDirRel, "handoff.md");
  const runLogFileRel = path.posix.join(runDirRel, "run.log.jsonl");
  const nextPromptFileRel = path.posix.join(runDirRel, "next-prompt.md");
  const stateFile = path.join(runDir, "state.json");
  const handoffFile = path.join(runDir, "handoff.md");
  const runLogFile = path.join(runDir, "run.log.jsonl");
  const nextPromptFile = path.join(runDir, "next-prompt.md");

  await mkdir(runDir, { recursive: true });

  const state: FeatureDeliveryState = {
    schemaVersion: FEATURE_DELIVERY_STATE_SCHEMA_VERSION,
    pipelineId: "feature-delivery",
    taskId,
    featureId,
    status: "ready_for_intake_delegation",
    currentStage: "intake",
    createdAtIso: rfc3339UtcMs(now),
    source: {
      inboxEntry: inboxRel,
      inboxPath: path.posix.join("src", "inbox", "in", inboxRel),
    },
    artifacts: {
      runDir: runDirRel,
      stateFile: stateFileRel,
      handoffFile: handoffFileRel,
      runLogFile: runLogFileRel,
      nextPromptFile: nextPromptFileRel,
    },
    stages: buildStageStates(pipeline),
    transitions: featureDeliveryTransitions(),
    nextHumanAction:
      "Delegate next-prompt.md to intake-analyst; ratify the emitted spec before advancing to plan.",
  };

  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await writeFile(handoffFile, renderHandoff(state, pipeline, directive), "utf8");
  await writeFile(nextPromptFile, renderNextPrompt(state, pipeline), "utf8");
  await appendRunLogRecord(runLogFile, makeInvocationRecord(state, now));

  return {
    command,
    status: "ok",
    pipelineId: "feature-delivery",
    taskId,
    featureId,
    runDir: runDirRel,
    stateFile: stateFileRel,
    handoffFile: handoffFileRel,
    runLogFile: runLogFileRel,
    nextPromptFile: nextPromptFileRel,
    currentStage: "intake",
    nextHumanAction: state.nextHumanAction,
  };
}

export async function readFeatureDeliveryStatusWithInterventions(
  repoRootInput: string,
  taskIdInput: string,
  loadState: (taskId: TaskId) => Promise<InterventionState>,
): Promise<FeatureDeliveryStatusResult> {
  const repoRoot = path.resolve(repoRootInput);
  const taskId = sanitizeTaskId(taskIdInput);
  const stateFile = await findStateFile(repoRoot, taskId);
  const raw = await readFile(stateFile.abs, "utf8");
  const parsed = JSON.parse(raw) as FeatureDeliveryState;
  const interventionState = await loadState(asTaskId(taskId));
  return {
    command: "status",
    status: "ok",
    taskId,
    pipelineId: parsed.pipelineId,
    featureId: parsed.featureId,
    currentStage: parsed.currentStage,
    pipelineStatus: parsed.status,
    interventionState,
    runDir: parsed.artifacts.runDir,
    stateFile: stateFile.rel,
    nextPromptFile: parsed.artifacts.nextPromptFile ?? null,
    nextHumanAction: parsed.nextHumanAction,
  };
}

export async function advanceFeatureDelivery(
  input: AdvanceFeatureDeliveryInput,
): Promise<AdvanceFeatureDeliveryResult> {
  const repoRoot = path.resolve(input.repoRoot);
  const taskId = sanitizeTaskId(input.taskId);
  const now = input.clock?.() ?? new Date();
  const stateFile = await findStateFile(repoRoot, taskId);
  const state = await readFeatureDeliveryState(stateFile.abs);
  const pipeline = loadFeatureDeliveryPipeline(repoRoot);
  const artifact = await assertRepoRelativeExistingFile(repoRoot, input.artifact, "artifact");

  if (state.currentStage === TERMINAL_STAGE) {
    throw new Error(`Task ${taskId} is already complete; refusing to advance.`);
  }

  const event = input.event ?? defaultEventForStage(state.currentStage);
  const transition = state.transitions.find(
    (candidate) => candidate.from === state.currentStage && candidate.on === event,
  );
  if (transition === undefined) {
    throw new Error(`No transition from ${state.currentStage} on ${event}.`);
  }
  assertStageArtifact(repoRoot, state, state.currentStage, artifact.rel, event);

  const fromStage = state.currentStage;
  const toStage = transition.to as FeatureDeliveryCurrentStage;
  state.currentStage = toStage;
  state.status = toStage === TERMINAL_STAGE ? "complete" : "ready_for_stage_delegation";
  state.nextHumanAction = nextHumanActionForStage(state, toStage, transition.humanAttention);
  state.stages = applyStageStatuses(state.stages, fromStage, toStage, event);
  state.advanceHistory = [
    ...(state.advanceHistory ?? []),
    {
      atIso: rfc3339UtcMs(now),
      kind: "advance",
      from: fromStage,
      to: toStage,
      event,
      artifact: artifact.rel,
    },
  ];

  await persistStateAndPrompts(repoRoot, state, pipeline, "advance");
  await appendRunLogRecord(
    path.join(repoRoot, state.artifacts.runLogFile),
    makeAdvanceRecord(state, now, fromStage, toStage, event, artifact.rel),
  );

  return {
    command: "advance",
    status: "ok",
    taskId,
    featureId: state.featureId,
    fromStage,
    event,
    currentStage: state.currentStage,
    artifact: artifact.rel,
    stateFile: stateFile.rel,
    handoffFile: state.artifacts.handoffFile,
    nextPromptFile: requireNextPromptFile(state),
    nextPersona: personaForStage(pipeline, state.currentStage),
    nextHumanAction: state.nextHumanAction,
  };
}

export async function repairFeatureDeliveryState(
  input: RepairFeatureDeliveryStateInput,
): Promise<RepairFeatureDeliveryStateResult> {
  const repoRoot = path.resolve(input.repoRoot);
  const taskId = sanitizeTaskId(input.taskId);
  const now = input.clock?.() ?? new Date();
  const targetStage = assertFeatureDeliveryStage(input.stage);
  const reason = input.reason.trim();
  if (reason.length < 12) {
    throw new Error("repair-state requires a concrete --reason with at least 12 characters.");
  }

  const stateFile = await findStateFile(repoRoot, taskId);
  const state = await readFeatureDeliveryState(stateFile.abs);
  const pipeline = loadFeatureDeliveryPipeline(repoRoot);
  const artifact = await assertRepoRelativeExistingFile(repoRoot, input.artifact, "artifact");
  const previousStage = state.currentStage;

  state.currentStage = targetStage;
  state.status = "repaired";
  state.nextHumanAction = nextHumanActionForStage(state, targetStage, `Manual state repair: ${reason}`);
  state.stages = repairStageStatuses(state.stages, targetStage);
  state.advanceHistory = [
    ...(state.advanceHistory ?? []),
    {
      atIso: rfc3339UtcMs(now),
      kind: "repair",
      from: previousStage,
      to: targetStage,
      event: "manual_repair",
      artifact: artifact.rel,
      reason,
    },
  ];

  await persistStateAndPrompts(repoRoot, state, pipeline, "repair");
  await appendRunLogRecord(
    path.join(repoRoot, state.artifacts.runLogFile),
    makeRepairRecord(state, now, previousStage, targetStage, artifact.rel, reason),
  );

  return {
    command: "repair-state",
    status: "ok",
    taskId,
    featureId: state.featureId,
    previousStage,
    currentStage: state.currentStage,
    artifact: artifact.rel,
    reason,
    stateFile: stateFile.rel,
    handoffFile: state.artifacts.handoffFile,
    nextPromptFile: requireNextPromptFile(state),
    nextPersona: personaForStage(pipeline, state.currentStage),
    nextHumanAction: state.nextHumanAction,
  };
}

/**
 * Accepts nested `src/inbox/in/`-relative POSIX paths after inbox convention migration.
 * @param {string} value
 * @param {string} label
 */
function assertInboxInRelativePath(value: string, label: string): string {
  const norm = value.replace(/\\/gu, "/").replace(/^\/+/, "");
  if (norm === "" || norm.includes("\0")) {
    throw new Error(`${label} MUST be a non-empty relative path.`);
  }
  const segments = norm.split("/").filter(Boolean);
  for (const s of segments) {
    if (s === ".." || s === ".") {
      throw new Error(`${label} MUST NOT contain dot segments.`);
    }
  }
  return norm;
}

function sanitizeSlug(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/u, "")
    .replace(/^\d+_\d+_/u, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80);
  if (slug.length === 0) {
    throw new Error("feature id MUST contain at least one alphanumeric character.");
  }
  return slug;
}

function sanitizeTaskId(raw: string): string {
  const taskId = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  if (!/^\d+_\d{4}_[a-z0-9][a-z0-9_-]*$/u.test(taskId)) {
    throw new Error("task id MUST match <seconds-to-midnight>_<HHMM>_<slug>.");
  }
  return taskId;
}

function deriveFeatureId(inboxEntry: string, directive: string): string {
  const title = directive.match(/^#\s+(.+)$/mu)?.[1];
  return title ?? inboxEntry;
}

function makeDayDir(now: Date): string {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  const dayStart = Date.UTC(y, m, d, 0, 0, 0, 0);
  const daysToFds = Math.floor((FDS_UTC_MS - dayStart) / 86400000);
  const mm = String(m + 1).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  const yy = String(y % 100).padStart(2, "0");
  return `${daysToFds}_${mm}-${dd}-${yy}`;
}

function makeTaskId(now: Date, featureId: string): string {
  const dayStart = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    0,
    0,
    0,
    0,
  );
  const nextDayStart = dayStart + 86400000;
  const secondsToMidnight = Math.max(0, Math.floor((nextDayStart - now.getTime()) / 1000));
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const mm = String(now.getUTCMinutes()).padStart(2, "0");
  return `${secondsToMidnight}_${hh}${mm}_${featureId}`;
}

function buildStageStates(pipeline: PipelineDefinition): FeatureDeliveryStageState[] {
  return pipeline.stages.map((stage, index) => ({
    id: stage.id,
    ...(stage.persona !== undefined ? { persona: stage.persona } : {}),
    ...(stage.label !== undefined ? { label: stage.label } : {}),
    status: index === 0 ? "ready" : "pending",
    ...stageGate(stage),
  }));
}

function stageGate(stage: PipelineStage): Pick<FeatureDeliveryStageState, "humanGate" | "humanAttention"> {
  switch (stage.id) {
    case "intake":
      return {
        humanGate: "human_approval",
        humanAttention: "Answer intake clarifying questions and ratify the canonical spec before planning.",
      };
    case "plan":
      return {
        humanGate: "human_approval",
        humanAttention: "Ratify the plan, ADR draft, touch-set, and handoff before execution.",
      };
    case "implement":
      return {
        humanGate: "operator_intervention_available",
        humanAttention: "Use tess pause/resume/abort if implementation drifts, loops, or exceeds scope.",
      };
    case "review":
      return {
        humanGate: "review_passes_or_reenter_implement",
        humanAttention: "Inspect high findings; approve only clean review output or send the run back to implement.",
      };
    case "ship":
      return {
        humanGate: "local_stage_only",
        humanAttention: "Review the local diff and delivery report; no agent may push or open the PR unaudited.",
      };
    case "index":
      return {
        humanGate: "archive_and_index_audit",
        humanAttention: "Confirm feature index and archival moves after the run exits.",
      };
    default:
      return {};
  }
}

function featureDeliveryTransitions(): FeatureDeliveryTransition[] {
  return [
    {
      from: "created",
      on: "invoke",
      to: "intake",
      humanAttention: "Operator delegates the handoff card to intake-analyst.",
    },
    {
      from: "intake",
      on: "human_approval",
      to: "plan",
      humanAttention: "Canonical spec is ratified or clarified before plan starts.",
    },
    {
      from: "plan",
      on: "human_approval",
      to: "implement",
      humanAttention: "Plan and touch-set are ratified before coder starts.",
    },
    {
      from: "implement",
      on: "pause",
      to: "paused",
      humanAttention: "Use tess pause <task-id> to stop at the next safe boundary.",
    },
    {
      from: "paused",
      on: "resume",
      to: "implement",
      humanAttention: "Use tess resume <task-id> after resolving the blocker.",
    },
    {
      from: "implement",
      on: "abort",
      to: "aborted",
      humanAttention: "Use tess abort <task-id> --reason <text> for failed or superseded runs.",
    },
    {
      from: "implement",
      on: "implementation_complete",
      to: "review",
      humanAttention: "Reviewer receives only the handoff, touch-set, diff, and validation output.",
    },
    {
      from: "review",
      on: "must_fix",
      to: "implement",
      humanAttention: "Bounded re-entry; high findings block shipping.",
    },
    {
      from: "review",
      on: "review_passes",
      to: "report",
      humanAttention: "Human should still inspect review output before report/ship.",
    },
    {
      from: "report",
      on: "report_ready",
      to: "ship",
      humanAttention: "Delivery report must be useful to the operator, not just a changelog.",
    },
    {
      from: "ship",
      on: "human_ratifies_local_diff",
      to: "index",
      humanAttention: "No push occurs before human review.",
    },
    {
      from: "index",
      on: "artifacts_indexed",
      to: "complete",
      humanAttention: "Confirm archive/index state and outbox report.",
    },
  ];
}

function renderHandoff(state: FeatureDeliveryState, pipeline: PipelineDefinition, directive?: string): string {
  const nextPersona = personaForStage(pipeline, state.currentStage) ?? "human";
  const stage = state.currentStage;
  const excerpt = directive?.trim().split(/\r?\n/u).slice(0, 20).join("\n");
  return `# Feature delivery handoff — ${state.featureId}

- Feature id: ${state.featureId}
- Task id: ${state.taskId}
- Pipeline: ${state.pipelineId}
- Current stage: ${stage}
- Executor persona: ${nextPersona}
- Source directive: ${state.source.inboxPath}
- State file: ${state.artifacts.stateFile}
- Run log: ${state.artifacts.runLogFile}
- Next prompt: ${requireNextPromptFile(state)}

## Stage contract

${stageContractMarkdown(state, stage)}

## In-scope paths

- ${state.source.inboxPath}
- src/memory/features/${state.featureId}/spec.md
- ${state.artifacts.runDir}/plan.md
- ${state.artifacts.runDir}/adr-draft.md
- ${state.artifacts.runDir}/touch-set.json
- ${state.artifacts.runDir}/implementation-report.md
- ${state.artifacts.runDir}/review.md
- src/memory/features/${state.featureId}/delivery-report.md
- src/inbox/out/<timestamp>-${state.featureId}-delivery-report.md

## Explicit non-goals

- Do not read or write src/inbox/notes/.
- Do not continue past a human gate without explicit ratification.
- Do not push, open a PR, or commit without the human operator.
- Do not carry planning context into implementation; use the stage prompt and named stage inputs.

## Validation commands

- node --test tests/*.test.mjs
- node src/internal/tools/check-phase-0a-scaffold.mjs
- node src/internal/tools/context-budget-report.mjs
- bash -n .cursor/hooks/enforce-policy-compliance.sh

## Re-entry rule

If scope changes, validation repeatedly fails, or the touch-set is incomplete, stop and delegate back to supervisor, tech-lead, or reviewer instead of extending the executor loop.
${excerpt === undefined || excerpt.length === 0 ? "" : `
## Directive excerpt

\`\`\`markdown
${excerpt}
\`\`\`
`}`;
}

function renderNextPrompt(state: FeatureDeliveryState, pipeline: PipelineDefinition): string {
  const persona = personaForStage(pipeline, state.currentStage) ?? "human";
  const stage = state.currentStage;
  return `You are executing the ${stage} stage for feature-delivery task ${state.taskId}.

Use subagent/persona: ${persona}

Read first, in this order:
1. AGENTS.md
2. ${state.artifacts.handoffFile}
3. The stage input paths listed below

Do not read broad archives, full PRD/bootstrap docs, src/inbox/notes/**, or unrelated src/work/** paths unless the handoff explicitly requires it.

${stageContractMarkdown(state, stage)}

After the stage artifact is accepted by the human operator, run exactly one matching state command from the handoff instructions. Do not continue to the next persona in the same agent loop.
`;
}

function stageContractMarkdown(state: FeatureDeliveryState, stage: string): string {
  switch (stage) {
    case "intake":
      return `Input: ${state.source.inboxPath}\nOutput: src/memory/features/${state.featureId}/spec.md\nAdvance after human ratification: pnpm -w exec tess advance ${state.taskId} --artifact src/memory/features/${state.featureId}/spec.md`;
    case "plan":
      return `Input: src/memory/features/${state.featureId}/spec.md\nOutputs: ${state.artifacts.runDir}/plan.md, ${state.artifacts.runDir}/adr-draft.md, ${state.artifacts.runDir}/touch-set.json, ${state.artifacts.handoffFile}\nAdvance after human ratification: pnpm -w exec tess advance ${state.taskId} --artifact ${state.artifacts.runDir}/touch-set.json`;
    case "implement":
      return `Inputs: ${state.artifacts.handoffFile}, ${state.artifacts.runDir}/touch-set.json\nOutput: ${state.artifacts.runDir}/implementation-report.md\nAdvance after implementation is accepted: pnpm -w exec tess advance ${state.taskId} --artifact ${state.artifacts.runDir}/implementation-report.md`;
    case "review":
      return `Inputs: ${state.artifacts.handoffFile}, ${state.artifacts.runDir}/touch-set.json, current local diff, validation output\nOutput: ${state.artifacts.runDir}/review.md\nAdvance on pass: pnpm -w exec tess advance ${state.taskId} --artifact ${state.artifacts.runDir}/review.md\nReturn to implement on must-fix: pnpm -w exec tess advance ${state.taskId} --event must_fix --artifact ${state.artifacts.runDir}/review.md`;
    case "report":
      return `Inputs: ${state.artifacts.runDir}/implementation-report.md, ${state.artifacts.runDir}/review.md\nOutput: src/memory/features/${state.featureId}/delivery-report.md\nAdvance after report is accepted: pnpm -w exec tess advance ${state.taskId} --artifact src/memory/features/${state.featureId}/delivery-report.md`;
    case "ship":
      return `Inputs: local diff, validation output, src/memory/features/${state.featureId}/delivery-report.md\nOutput: ${state.artifacts.runDir}/policy-compliance.json\nAdvance only after human ratifies local diff: pnpm -w exec tess advance ${state.taskId} --artifact ${state.artifacts.runDir}/policy-compliance.json`;
    case "index":
      return `Inputs: delivery report and accepted ship artifacts\nOutput: src/memory/features/${state.featureId}/index.json\nAdvance after artifacts are indexed: pnpm -w exec tess advance ${state.taskId} --artifact src/memory/features/${state.featureId}/index.json`;
    case "complete":
      return "No next agent stage. Confirm archival/index state and close the task manually.";
    default:
      return `No stage contract is defined for ${stage}.`;
  }
}

function makeInvocationRecord(state: FeatureDeliveryState, now: Date): RunLogRecord {
  return {
    ts: rfc3339UtcMs(now),
    trace_id: newTraceId(),
    span_id: newSpanId(),
    name: "tesseract.pipeline.invoke",
    kind: "event",
    status: { code: "OK" },
    attributes: {
      "openinference.span.kind": "CHAIN",
      "gen_ai.operation.name": "pipeline.invoke",
      "gen_ai.provider.name": "local-cli",
      "gen_ai.request.model": "none",
      "tesseract.feature_id": state.featureId,
      "tesseract.state_file": state.artifacts.stateFile,
    },
    resource: { "service.name": "tesseract", "service.version": "0.0.0" },
    tesseract: {
      task_id: asTaskId(state.taskId),
      pipeline: state.pipelineId,
      stage_id: "invoke",
      outcome: "success",
      checkpoint_seq: 0,
      token_usage_unavailable: true,
    },
  };
}

function makeAdvanceRecord(
  state: FeatureDeliveryState,
  now: Date,
  fromStage: string,
  toStage: string,
  event: string,
  artifact: string,
): RunLogRecord {
  return makeStateRecord(state, now, "tesseract.pipeline.advance", fromStage, toStage, event, artifact);
}

function makeRepairRecord(
  state: FeatureDeliveryState,
  now: Date,
  fromStage: string,
  toStage: string,
  artifact: string,
  reason: string,
): RunLogRecord {
  const record = makeStateRecord(
    state,
    now,
    "tesseract.pipeline.repair_state",
    fromStage,
    toStage,
    "manual_repair",
    artifact,
  );
  return {
    ...record,
    attributes: {
      ...record.attributes,
      "tesseract.repair.reason": reason,
    },
  };
}

function makeStateRecord(
  state: FeatureDeliveryState,
  now: Date,
  name: string,
  fromStage: string,
  toStage: string,
  event: string,
  artifact: string,
): RunLogRecord {
  return {
    ts: rfc3339UtcMs(now),
    trace_id: newTraceId(),
    span_id: newSpanId(),
    name,
    kind: "event",
    status: { code: "OK" },
    attributes: {
      "openinference.span.kind": "CHAIN",
      "gen_ai.operation.name": name,
      "gen_ai.provider.name": "local-cli",
      "gen_ai.request.model": "none",
      "tesseract.feature_id": state.featureId,
      "tesseract.state_file": state.artifacts.stateFile,
      "tesseract.from_stage": fromStage,
      "tesseract.to_stage": toStage,
      "tesseract.transition_event": event,
      "tesseract.artifact": artifact,
    },
    resource: { "service.name": "tesseract", "service.version": "0.0.0" },
    tesseract: {
      task_id: asTaskId(state.taskId),
      pipeline: state.pipelineId,
      stage_id: fromStage,
      outcome: "success",
      checkpoint_seq: state.advanceHistory?.length ?? 0,
      token_usage_unavailable: true,
    },
  };
}

async function findStateFile(repoRoot: string, taskId: string): Promise<{ abs: string; rel: string }> {
  const workRoot = path.join(repoRoot, "src", "work");
  const dayDirs = await safeReaddir(workRoot);
  for (const day of dayDirs) {
    const candidate = path.join(workRoot, day, taskId, "state.json");
    try {
      await readFile(candidate, "utf8");
      return {
        abs: candidate,
        rel: path.posix.join("src", "work", day, taskId, "state.json"),
      };
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== "ENOENT" && err.code !== "ENOTDIR") {
        throw error;
      }
    }
  }
  throw new Error(`No feature-delivery state.json found for task ${taskId}.`);
}

async function readFeatureDeliveryState(stateFile: string): Promise<FeatureDeliveryState> {
  const parsed = JSON.parse(await readFile(stateFile, "utf8")) as FeatureDeliveryState;
  if (parsed.pipelineId !== "feature-delivery") {
    throw new Error(`Expected feature-delivery state file; found ${parsed.pipelineId}.`);
  }
  if (parsed.artifacts.nextPromptFile === undefined) {
    parsed.artifacts.nextPromptFile = path.posix.join(parsed.artifacts.runDir, "next-prompt.md");
  }
  return parsed;
}

function loadFeatureDeliveryPipeline(repoRoot: string): PipelineDefinition {
  const pipeline = loadPipelineYaml(path.join(repoRoot, "src", "pipelines", "feature-delivery.yaml"));
  if (pipeline.id !== "feature-delivery") {
    throw new Error(`Expected feature-delivery pipeline; found ${pipeline.id}.`);
  }
  return pipeline;
}

async function persistStateAndPrompts(
  repoRoot: string,
  state: FeatureDeliveryState,
  pipeline: PipelineDefinition,
  mode: "advance" | "repair",
): Promise<void> {
  await writeFile(path.join(repoRoot, state.artifacts.stateFile), `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await writeFile(path.join(repoRoot, state.artifacts.handoffFile), renderHandoff(state, pipeline), "utf8");
  await writeFile(
    path.join(repoRoot, requireNextPromptFile(state)),
    `# Generated by tess ${mode}\n\n${renderNextPrompt(state, pipeline)}`,
    "utf8",
  );
}

function defaultEventForStage(stage: string): string {
  switch (stage) {
    case "intake":
    case "plan":
      return "human_approval";
    case "implement":
      return "implementation_complete";
    case "review":
      return "review_passes";
    case "report":
      return "report_ready";
    case "ship":
      return "human_ratifies_local_diff";
    case "index":
      return "artifacts_indexed";
    default:
      throw new Error(`No default advance event for stage ${stage}.`);
  }
}

function assertStageArtifact(
  repoRoot: string,
  state: FeatureDeliveryState,
  stage: string,
  artifact: string,
  event: string,
): void {
  const expected = expectedArtifactsForStage(state, stage, event);
  if (!expected.acceptedArtifacts.includes(artifact)) {
    throw new Error(
      `Artifact ${artifact} is not valid for ${stage} on ${event}; expected one of: ${expected.acceptedArtifacts.join(", ")}.`,
    );
  }
  for (const required of expected.requiredArtifacts) {
    if (!existsSync(path.join(repoRoot, required))) {
      throw new Error(`Cannot advance ${stage}; required artifact is missing: ${required}.`);
    }
  }
}

function expectedArtifactsForStage(
  state: FeatureDeliveryState,
  stage: string,
  event: string,
): { acceptedArtifacts: string[]; requiredArtifacts: string[] } {
  const run = state.artifacts.runDir;
  switch (stage) {
    case "intake": {
      const spec = path.posix.join("src", "memory", "features", state.featureId, "spec.md");
      return { acceptedArtifacts: [spec], requiredArtifacts: [spec] };
    }
    case "plan": {
      const required = [
        path.posix.join(run, "plan.md"),
        path.posix.join(run, "touch-set.json"),
        state.artifacts.handoffFile,
      ];
      return { acceptedArtifacts: required, requiredArtifacts: required };
    }
    case "implement": {
      const implementationReport = path.posix.join(run, "implementation-report.md");
      return { acceptedArtifacts: [implementationReport], requiredArtifacts: [implementationReport] };
    }
    case "review": {
      const review = path.posix.join(run, "review.md");
      if (event !== "review_passes" && event !== "must_fix") {
        throw new Error(`Review stage only supports review_passes or must_fix, got ${event}.`);
      }
      return { acceptedArtifacts: [review], requiredArtifacts: [review] };
    }
    case "report": {
      const report = path.posix.join("src", "memory", "features", state.featureId, "delivery-report.md");
      return { acceptedArtifacts: [report], requiredArtifacts: [report] };
    }
    case "ship": {
      const policy = path.posix.join(run, "policy-compliance.json");
      return { acceptedArtifacts: [policy], requiredArtifacts: [policy] };
    }
    case "index": {
      const index = path.posix.join("src", "memory", "features", state.featureId, "index.json");
      return { acceptedArtifacts: [index], requiredArtifacts: [index] };
    }
    default:
      throw new Error(`No artifact contract for stage ${stage}.`);
  }
}

function applyStageStatuses(
  stages: FeatureDeliveryStageState[],
  fromStage: string,
  toStage: string,
  event: string,
): FeatureDeliveryStageState[] {
  if (event === "must_fix") {
    return stages.map((stage) => {
      if (stage.id === "review") return { ...stage, status: "blocked" };
      if (stage.id === "implement") return { ...stage, status: "ready" };
      return stage;
    });
  }
  return stages.map((stage) => {
    if (stage.id === fromStage) return { ...stage, status: "complete" };
    if (stage.id === toStage) return { ...stage, status: "ready" };
    return stage;
  });
}

function repairStageStatuses(
  stages: FeatureDeliveryStageState[],
  targetStage: FeatureDeliveryStageId,
): FeatureDeliveryStageState[] {
  const targetIndex = FEATURE_DELIVERY_STAGES.indexOf(targetStage);
  return stages.map((stage) => {
    const index = FEATURE_DELIVERY_STAGES.indexOf(stage.id as FeatureDeliveryStageId);
    if (index < 0) return stage;
    if (index < targetIndex) return { ...stage, status: "complete" };
    if (index === targetIndex) return { ...stage, status: "ready" };
    return { ...stage, status: "pending" };
  });
}

function nextHumanActionForStage(
  state: FeatureDeliveryState,
  stage: string,
  extra?: string,
): string {
  const prefix = extra === undefined ? "" : `${extra} `;
  switch (stage) {
    case "intake":
      return `${prefix}Delegate next-prompt.md to intake-analyst; ratify the emitted spec before advancing.`;
    case "plan":
      return `${prefix}Delegate next-prompt.md to tech-lead; ratify plan.md, touch-set.json, and handoff.md before advancing.`;
    case "implement":
      return `${prefix}Delegate next-prompt.md to coder; monitor drift and require ${state.artifacts.runDir}/implementation-report.md before review.`;
    case "review":
      return `${prefix}Delegate next-prompt.md to reviewer; inspect ${state.artifacts.runDir}/review.md and choose pass or must-fix.`;
    case "report":
      return `${prefix}Delegate next-prompt.md to tech-writer; ratify delivery-report.md before ship.`;
    case "ship":
      return `${prefix}Delegate next-prompt.md to supervisor; human must ratify the local diff before index.`;
    case "index":
      return `${prefix}Delegate next-prompt.md to librarian; verify feature index and outbox/archive state before complete.`;
    case "complete":
      return `${prefix}Run is complete; verify archival/index state and external traceability.`;
    default:
      return `${prefix}No human action defined for ${stage}.`;
  }
}

function personaForStage(pipeline: PipelineDefinition, stage: string): string | null {
  if (stage === TERMINAL_STAGE) return null;
  return pipeline.stages.find((candidate) => candidate.id === stage)?.persona ?? null;
}

function assertFeatureDeliveryStage(value: string): FeatureDeliveryStageId {
  const stage = value as FeatureDeliveryStageId;
  if (!FEATURE_DELIVERY_STAGES.includes(stage)) {
    throw new Error(`stage MUST be one of: ${FEATURE_DELIVERY_STAGES.join(", ")}.`);
  }
  return stage;
}

async function assertRepoRelativeExistingFile(
  repoRoot: string,
  value: string,
  label: string,
): Promise<{ abs: string; rel: string }> {
  const rel = value.replace(/\\/gu, "/").replace(/^\/+/, "");
  if (rel === "" || rel.includes("\0") || rel.split("/").some((part) => part === ".." || part === ".")) {
    throw new Error(`${label} MUST be a safe repo-relative path.`);
  }
  const abs = path.join(repoRoot, ...rel.split("/"));
  const relativeBack = path.relative(repoRoot, abs);
  if (relativeBack.startsWith("..") || path.isAbsolute(relativeBack)) {
    throw new Error(`${label} MUST stay inside the repository.`);
  }
  const info = await stat(abs);
  if (!info.isFile()) {
    throw new Error(`${label} MUST point to a file: ${rel}.`);
  }
  return { abs, rel };
}

function requireNextPromptFile(state: FeatureDeliveryState): string {
  const nextPromptFile = state.artifacts.nextPromptFile ?? path.posix.join(state.artifacts.runDir, "next-prompt.md");
  state.artifacts.nextPromptFile = nextPromptFile;
  return nextPromptFile;
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}
