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
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const FEATURE_DELIVERY_STATE_SCHEMA_VERSION = "1" as const;

const FDS_UTC_MS = Date.UTC(2500, 0, 1, 0, 0, 0, 0);

export type StageStatus = "ready" | "pending" | "complete" | "blocked" | "skipped";

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

export interface FeatureDeliveryState {
  schemaVersion: typeof FEATURE_DELIVERY_STATE_SCHEMA_VERSION;
  pipelineId: "feature-delivery";
  taskId: string;
  featureId: string;
  status: "ready_for_intake_delegation";
  currentStage: "intake";
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
  };
  stages: FeatureDeliveryStageState[];
  transitions: FeatureDeliveryTransition[];
  nextHumanAction: string;
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
  nextHumanAction: string;
}

export async function startFeatureDelivery(
  input: StartFeatureDeliveryInput,
  command: "run" | "feature new" = "run",
): Promise<StartFeatureDeliveryResult> {
  const repoRoot = path.resolve(input.repoRoot);
  const now = input.clock?.() ?? new Date();
  const inboxEntry = assertBasename(input.inboxEntry, "inbox entry");
  const inboxPath = path.join(repoRoot, "src", "inbox", "in", inboxEntry);
  const directive = await readFile(inboxPath, "utf8");
  const pipelinePath = path.join(repoRoot, "src", "pipelines", "feature-delivery.yaml");
  const pipeline = loadPipelineYaml(pipelinePath);
  if (pipeline.id !== "feature-delivery") {
    throw new Error(`Expected feature-delivery pipeline at ${pipelinePath}; found ${pipeline.id}.`);
  }

  const featureId = sanitizeSlug(input.featureId ?? deriveFeatureId(inboxEntry, directive));
  const taskId = sanitizeTaskId(input.taskId ?? makeTaskId(now, featureId));
  const dayDir = makeDayDir(now);
  const runDirRel = path.posix.join("src", "work", dayDir, taskId);
  const runDir = path.join(repoRoot, "src", "work", dayDir, taskId);
  const stateFileRel = path.posix.join(runDirRel, "state.json");
  const handoffFileRel = path.posix.join(runDirRel, "handoff.md");
  const runLogFileRel = path.posix.join(runDirRel, "run.log.jsonl");
  const stateFile = path.join(runDir, "state.json");
  const handoffFile = path.join(runDir, "handoff.md");
  const runLogFile = path.join(runDir, "run.log.jsonl");

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
      inboxEntry,
      inboxPath: path.posix.join("src", "inbox", "in", inboxEntry),
    },
    artifacts: {
      runDir: runDirRel,
      stateFile: stateFileRel,
      handoffFile: handoffFileRel,
      runLogFile: runLogFileRel,
    },
    stages: buildStageStates(pipeline),
    transitions: featureDeliveryTransitions(),
    nextHumanAction:
      "Delegate the intake stage to intake-analyst with the handoff card; answer clarifying questions or ratify the emitted spec before plan starts.",
  };

  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await writeFile(handoffFile, renderHandoff(state, pipeline, directive), "utf8");
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
    nextHumanAction: parsed.nextHumanAction,
  };
}

function assertBasename(value: string, label: string): string {
  const base = path.basename(value);
  if (base !== value || value.includes("..") || value.includes("/") || value.includes("\\")) {
    throw new Error(`${label} MUST be a single path segment.`);
  }
  return value;
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

function renderHandoff(state: FeatureDeliveryState, pipeline: PipelineDefinition, directive: string): string {
  const firstStage = pipeline.stages[0];
  const nextPersona = firstStage?.persona ?? "intake-analyst";
  const excerpt = directive.trim().split(/\r?\n/u).slice(0, 20).join("\n");
  return `# Feature delivery handoff — ${state.featureId}

- Feature id: ${state.featureId}
- Task id: ${state.taskId}
- Pipeline: ${state.pipelineId}
- Current stage: ${state.currentStage}
- Planner persona: supervisor
- Executor persona: ${nextPersona}
- Source directive: ${state.source.inboxPath}
- State file: ${state.artifacts.stateFile}
- Run log: ${state.artifacts.runLogFile}

## In-scope paths

- ${state.source.inboxPath}
- src/memory/features/${state.featureId}/spec.md
- src/work/<day>/<task-id>/plan.md
- src/work/<day>/<task-id>/adr-draft.md
- src/work/<day>/<task-id>/touch-set.json
- src/work/<day>/<task-id>/review.md
- src/memory/features/${state.featureId}/delivery-report.md
- src/inbox/out/<timestamp>-${state.featureId}-delivery-report.md

## Explicit non-goals

- Do not read or write src/inbox/notes/.
- Do not continue past a human gate without explicit ratification.
- Do not push, open a PR, or commit without the human operator.
- Do not carry planning context into implementation; pass this handoff path instead.

## Validation commands

- node --test tests/*.test.mjs
- node src/internal/tools/check-phase-0a-scaffold.mjs
- node src/internal/tools/context-budget-report.mjs
- bash -n .cursor/hooks/enforce-policy-compliance.sh

## Re-entry rule

If scope changes, validation repeatedly fails, or the touch-set is incomplete, stop and delegate back to supervisor, tech-lead, or reviewer instead of extending the executor loop.

## Directive excerpt

\`\`\`markdown
${excerpt}
\`\`\`
`;
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
