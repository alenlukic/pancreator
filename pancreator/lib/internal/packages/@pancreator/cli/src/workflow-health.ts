import { resolveRepoPath } from "@pancreator/core";
import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { stringifyCliJson } from "./canonical-json-io.js";
import { wrapPanWorkJson } from "./pan-work-artifact.js";
import { parsePanWorkJsonText } from "./pan-work-artifact.js";
import {
  type ArtifactContentWarning,
  requiredArtifactsAfterStageWork,
  validateStageCompletionArtifacts,
  type FeatureDeliveryArtifactState,
} from "./feature-delivery-stage-artifacts.js";

export type WorkflowHealthStatus =
  | "healthy"
  | "needs_attention"
  | "blocked"
  | "reconciled";

export type PointerResolutionStatus =
  | "Live"
  | "Archived"
  | "Missing"
  | "Needs reconciliation";

export interface PointerResolution {
  label: string;
  referencedPath: string;
  status: PointerResolutionStatus;
  resolvedPath?: string;
  action?: string;
  reason?: string;
}

export interface WorkflowHealthFinding {
  code: string;
  severity: "info" | "warning" | "blocking";
  summary: string;
  detail?: string;
  artifact?: string;
  pointer?: PointerResolution;
}

export interface CompanionArtifactStatus {
  name: string;
  present: boolean;
  blockingReason?: string;
}

export interface WorkflowHealthSummary {
  task_id: string;
  feature_id: string;
  run_dir: string;
  status: WorkflowHealthStatus;
  repair_count: number;
  auto_chain_reversal_count: number;
  last_oversight_check_at?: string;
  companion_artifacts: CompanionArtifactStatus[];
  pointers: PointerResolution[];
  gate_block_reasons: string[];
  findings: WorkflowHealthFinding[];
  updated_at: string;
  output_manifest: Record<string, unknown>;
}

const ARCHIVE_INBOX_PREFIX = ".pan/archive/inbox/in/";
const LIVE_INBOX_PREFIX = "lib/inbox/in/";
const ARCHIVE_WORK_PREFIX = ".pan/archive/work/";

export function workflowHealthRel(runDir: string): string {
  return path.posix.join(runDir, "workflow-health.json");
}

function normalizeRel(value: string): string {
  return value.replace(/\\/gu, "/").replace(/^\/+/, "");
}

interface RunLogRow {
  ts?: string;
  timestamp?: string;
  event?: string;
  name?: string;
  message?: string;
  attributes?: Record<string, unknown>;
}

function rowTimestamp(row: RunLogRow): string | undefined {
  return row.ts ?? row.timestamp;
}

function advanceTransitionEvent(row: RunLogRow): string {
  if (row.name !== "pancreator.pipeline.advance") {
    return "";
  }
  const attrs = row.attributes ?? {};
  const fromPancreator = attrs["pancreator.transition_event"];
  if (typeof fromPancreator === "string" && fromPancreator.length > 0) {
    return fromPancreator;
  }
  const legacy = attrs.event;
  if (typeof legacy === "string" && legacy.length > 0) {
    return legacy;
  }
  return row.message ?? "";
}

function readRunLogRows(repoRoot: string, runLogRel: string): RunLogRow[] {
  const abs = resolveRepoPath(repoRoot, runLogRel);
  if (!existsSync(abs)) {
    return [];
  }
  const text = readFileSync(abs, "utf8");
  const rows: RunLogRow[] = [];
  for (const line of text.split(/\r?\n/u)) {
    if (line.trim().length === 0) {
      continue;
    }
    try {
      rows.push(JSON.parse(line) as RunLogRow);
    } catch {
      /* skip malformed */
    }
  }
  return rows;
}

function countRepairs(state: Record<string, unknown>): number {
  const history = state.advanceHistory;
  if (!Array.isArray(history)) {
    return 0;
  }
  return history.filter((entry) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return false;
    }
    return (entry as Record<string, unknown>).kind === "repair";
  }).length;
}

function countAutoChainReversals(history: RunLogRow[]): number {
  let reversals = 0;
  for (const row of history) {
    const event = advanceTransitionEvent(row);
    if (
      /qa_fails|must_fix|review_core_reentry|compliance_fails|qa_fails_plan_invalidating|compliance_fails_plan_invalidating/u.test(
        event,
      )
    ) {
      reversals += 1;
    }
    if (row.message?.includes("auto-chain reversal")) {
      reversals += 1;
    }
  }
  return reversals;
}

function lastOversightCheckAt(rows: RunLogRow[]): string | undefined {
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    const timestamp = rowTimestamp(row);
    if (timestamp === undefined) {
      continue;
    }
    if (row.name === "cursor.runner" && row.message?.includes("heartbeat")) {
      return timestamp;
    }
    if (row.event === "feature_delivery_progress" || row.message?.includes("[pan fd]")) {
      return timestamp;
    }
    if (
      row.name === "pancreator.pipeline.advance" ||
      row.name?.startsWith("cursor.runner")
    ) {
      return timestamp;
    }
  }
  return undefined;
}

export function resolvePointerResolution(
  repoRoot: string,
  referencedPath: string,
  label: string,
): PointerResolution {
  const norm = normalizeRel(referencedPath);
  const liveAbs = resolveRepoPath(repoRoot, norm);
  if (existsSync(liveAbs)) {
    return {
      label,
      referencedPath: norm,
      status: "Live",
      resolvedPath: norm,
      action: "Open live path",
    };
  }

  const archiveCandidates = new Set<string>();
  if (norm.startsWith(LIVE_INBOX_PREFIX)) {
    archiveCandidates.add(
      path.posix.join(
        ARCHIVE_INBOX_PREFIX.replace(/\/+$/u, ""),
        norm.slice(LIVE_INBOX_PREFIX.length),
      ),
    );
  }
  if (norm.startsWith(".pan/work/")) {
    archiveCandidates.add(
      norm.replace(/^\.pan\/work\//u, `${ARCHIVE_WORK_PREFIX}`),
    );
  }

  for (const candidate of archiveCandidates) {
    if (existsSync(resolveRepoPath(repoRoot, candidate))) {
      return {
        label,
        referencedPath: norm,
        status: "Archived",
        resolvedPath: candidate,
        action: "Follow archived pointer",
        reason: "Referenced artifact moved to archive.",
      };
    }
  }

  if (archiveCandidates.size > 0) {
    return {
      label,
      referencedPath: norm,
      status: "Needs reconciliation",
      action: "Run archive reconciliation or repair-state",
      reason: "Live path is missing and archived counterpart was not found.",
    };
  }

  return {
    label,
    referencedPath: norm,
    status: "Missing",
    action: "Restore artifact or update state pointer",
    reason: "Referenced path does not exist in live or archive locations.",
  };
}

function companionArtifactStatuses(
  repoRoot: string,
  state: FeatureDeliveryArtifactState,
  stageId: string,
): CompanionArtifactStatus[] {
  const required = requiredArtifactsAfterStageWork(state, stageId);
  const validation = validateStageCompletionArtifacts(repoRoot, state, stageId);
  const warningByPath = new Map<string, ArtifactContentWarning>();
  for (const warning of validation.warnings) {
    warningByPath.set(warning.path, warning);
  }
  return required.map((rel) => {
    const present = existsSync(resolveRepoPath(repoRoot, rel));
    const warning = warningByPath.get(rel);
    return {
      name: path.posix.basename(rel),
      present,
      ...(present && warning !== undefined
        ? { blockingReason: warning.message }
        : !present
          ? { blockingReason: "Required companion artifact is missing." }
          : {}),
    };
  });
}

function deriveStatus(input: {
  gateBlockReasons: string[];
  findings: WorkflowHealthFinding[];
  repairCount: number;
  reversalCount: number;
}): WorkflowHealthStatus {
  if (input.gateBlockReasons.length > 0 || input.findings.some((f) => f.severity === "blocking")) {
    return "blocked";
  }
  if (
    input.repairCount > 0 ||
    input.reversalCount > 0 ||
    input.findings.some((f) => f.severity === "warning")
  ) {
    return "needs_attention";
  }
  return "healthy";
}

export interface BuildWorkflowHealthSummaryInput {
  repoRoot: string;
  state: FeatureDeliveryArtifactState & {
    taskId: string;
    featureId: string;
    currentStage?: string;
    status?: string;
    source?: { inboxPath?: string };
    artifacts: FeatureDeliveryArtifactState["artifacts"] & {
      runLogFile?: string;
      stateFile?: string;
    };
    advanceHistory?: ReadonlyArray<{ kind?: string }>;
  };
  stageId?: string;
  gateBlockReasons?: string[];
  pointerPaths?: Array<{ label: string; path: string }>;
  now?: Date;
}

export function buildWorkflowHealthSummary(
  input: BuildWorkflowHealthSummaryInput,
): WorkflowHealthSummary {
  const runDir = input.state.artifacts.runDir;
  const stageId = input.stageId ?? input.state.currentStage ?? "plan";
  const runLogRel =
    input.state.artifacts.runLogFile ?? path.posix.join(runDir, "run.log.jsonl");
  const runLogRows = readRunLogRows(input.repoRoot, runLogRel);
  const repairCount = countRepairs(input.state as unknown as Record<string, unknown>);
  const autoChainReversalCount = countAutoChainReversals(runLogRows);
  const gateBlockReasons = [...(input.gateBlockReasons ?? [])];

  const pointers: PointerResolution[] = [];
  const inboxPath = input.state.source?.inboxPath;
  if (typeof inboxPath === "string" && inboxPath.trim().length > 0) {
    pointers.push(resolvePointerResolution(input.repoRoot, inboxPath, "Source directive"));
  }
  for (const entry of input.pointerPaths ?? []) {
    pointers.push(resolvePointerResolution(input.repoRoot, entry.path, entry.label));
  }

  const findings: WorkflowHealthFinding[] = [];
  for (const pointer of pointers) {
    if (pointer.status === "Live") {
      continue;
    }
    findings.push({
      code: "stale_pointer",
      severity: pointer.status === "Missing" ? "blocking" : "warning",
      summary: `${pointer.label} is ${pointer.status.toLowerCase()}`,
      detail: pointer.reason,
      pointer,
    });
  }

  const companions = companionArtifactStatuses(input.repoRoot, input.state, stageId);
  for (const companion of companions) {
    if (companion.present && companion.blockingReason === undefined) {
      continue;
    }
    findings.push({
      code: "companion_artifact",
      severity: companion.present ? "warning" : "blocking",
      summary: companion.present
        ? `${companion.name} has validation issues`
        : `${companion.name} is missing`,
      detail: companion.blockingReason,
      artifact: companion.name,
    });
  }

  if (repairCount > 0) {
    findings.push({
      code: "repair_count",
      severity: "warning",
      summary: `${repairCount} repair-state intervention${repairCount === 1 ? "" : "s"} recorded`,
    });
  }
  if (autoChainReversalCount > 0) {
    findings.push({
      code: "auto_chain_reversal",
      severity: "warning",
      summary: `${autoChainReversalCount} auto-chain reversal${autoChainReversalCount === 1 ? "" : "s"} detected`,
    });
  }

  const status = deriveStatus({
    gateBlockReasons,
    findings,
    repairCount,
    reversalCount: autoChainReversalCount,
  });
  const nowIso = (input.now ?? new Date()).toISOString();
  const oversightCheckAt = lastOversightCheckAt(runLogRows);

  return {
    task_id: input.state.taskId,
    feature_id: input.state.featureId,
    run_dir: runDir,
    status,
    repair_count: repairCount,
    auto_chain_reversal_count: autoChainReversalCount,
    ...(oversightCheckAt !== undefined
      ? { last_oversight_check_at: oversightCheckAt }
      : {}),
    companion_artifacts: companions,
    pointers,
    gate_block_reasons: gateBlockReasons,
    findings,
    updated_at: nowIso,
    output_manifest: {
      persona_contract: "PERSONA.PANCREATOR_ENGINEER",
      stage_contract: "PIPE.FEATURE_DELIVERY.IMPLEMENT",
      required_docs: [
        "DOC.AGENTS",
        "DOC.REGISTRY",
        "DOC.OUTPUT_MANIFEST",
        "DOC.PIPELINE_STATE",
      ],
      consulted_docs: [
        "DOC.AGENTS",
        "DOC.REGISTRY",
        "DOC.OUTPUT_MANIFEST",
        "DOC.PIPELINE_STATE",
      ],
      produced_artifacts: [workflowHealthRel(runDir)],
      scope_amendments: [],
      validation: [{ name: "workflow-health-summary", result: "pass" }],
      definition_of_done: "pass",
      gate_decision: "not_applicable",
      remediation_route: "none",
    },
  };
}

export async function writeWorkflowHealthArtifact(
  input: BuildWorkflowHealthSummaryInput,
): Promise<string> {
  const summary = buildWorkflowHealthSummary(input);
  const rel = workflowHealthRel(input.state.artifacts.runDir);
  const abs = resolveRepoPath(input.repoRoot, rel);
  const payload = wrapPanWorkJson(summary as unknown as Record<string, unknown>, {
    inThisFile: `Workflow health summary for task \`${input.state.taskId}\`.`,
    whyItMatters:
      "Records repair counts, auto-chain reversals, pointer resolution, companion-artifact status, and gate-block reasons for operator recovery.",
    seeAlso: [
      "lib/memory/handbook/pipeline-state-contract.md",
      "lib/memory/handbook/output-manifest-contract.md",
    ],
  });
  await writeFile(abs, `${stringifyCliJson(input.repoRoot, payload)}\n`, "utf8");
  return rel;
}

export function readWorkflowHealthSummary(
  repoRoot: string,
  runDir: string,
): WorkflowHealthSummary | null {
  const rel = workflowHealthRel(runDir);
  const abs = resolveRepoPath(repoRoot, rel);
  if (!existsSync(abs)) {
    return null;
  }
  try {
    const parsed = parsePanWorkJsonText(readFileSync(abs, "utf8")) as WorkflowHealthSummary;
    if (typeof parsed.task_id !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function synthesizeFallbackWorkflowHealthFinding(
  taskId: string,
  _featureId: string,
): WorkflowHealthFinding {
  return {
    code: "workflow_health_missing",
    severity: "warning",
    summary: "Workflow health artifact is missing",
    detail: `Run ${taskId} has no workflow-health.json yet; display-only fallback.`,
  };
}
