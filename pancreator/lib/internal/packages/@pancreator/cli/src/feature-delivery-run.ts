import {
  asTaskId,
  resolveProjectPath,
  resolveRepoPath,
  type TaskId,
} from "@pancreator/core";
import type { InterventionState } from "@pancreator/intervention";
import {
  loadPipelineYaml,
  type PipelineDefinition,
  type PipelineStage,
} from "@pancreator/pipeline";
import {
  appendRunLogRecord,
  newSpanId,
  newTraceId,
  rfc3339UtcMs,
  type RunLogRecord,
} from "@pancreator/run-logger";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { panWorkMarkdownMeta, panWorkStateMeta, parsePanWorkJsonText, wrapPanWorkMarkdown } from "./pan-work-artifact.js";
import { stringifyCliJson, stringifyPanWorkJson } from "./canonical-json-io.js";
import {
  applyActiveMemoryRefreshOnArtifactClosure,
  applyActiveMemoryRefreshOnReopen,
  patchFeatureIndexArchivedInbox,
  patchFeatureIndexReopenedInbox,
  SHIPPED_LEDGER_ROW_CAP,
} from "./active-memory-refresh.js";
import {
  COMPLIANCE_AUDIT_HISTORY_MAX,
  COMPLIANCE_AUDIT_HISTORY_REL,
  complianceAuditPromptContext,
  normalizeComplianceAuditHistoryForArchivedRun,
  persistComplianceAuditHistoryForResult,
} from "./compliance-audit-history.js";
import { readCursorInvocationMode } from "./pan-init.js";
import {
  designAcceptanceCriteriaRel,
  designPlanPromptRel,
  designPlanRel,
  designQaReportRel,
  designQaPromptRel,
  designStepsEnabled,
  manualQaTestCasesRel,
  productAcceptanceCriteriaRel,
  productPlanPromptRel,
  productPlanRel,
  renderDesignPlanPrompt,
  renderDesignQaPrompt,
  renderProductPlanPrompt,
  techAcceptanceCriteriaRel,
  techPlanRel,
  uxSpecRel,
  resolveDesignStepsConfig,
  type FeatureDeliveryDesignOptions,
} from "./design-steps.js";
import {
  applySdkRetrySideEffects,
  compileFeatureDeliveryPipeline,
  ensureAutomationState,
  invokeFeatureDeliveryEnteringStage,
  parseReportApprovalArtifact,
  prepareStageInvocationIndexForSdkEntry,
  readCursorInvocationForState,
  resetStageInvocationIndex,
  resolveComplianceStageAdvanceEvent,
  resolveTestStageAdvanceEvent,
  trySdkAutoChainAfterStageWork,
  type FeatureDeliveryAutomationState,
  type FeatureDeliveryTestHooks,
} from "./feature-delivery-runner.js";
import {
  emitFeatureDeliveryStageTransition,
  type FeatureDeliverySdkProgressReporter,
} from "./feature-delivery-sdk-progress.js";
import { assertDeliveryReportCitationFormat } from "./delivery-report-citation-lint.js";
import {
  archiveExperiencePlanningForClosedFeatureDelivery,
} from "./experience-planning-archival.js";
import {
  ensurePipelineCloseDoc,
  PIPELINE_CLOSE_FILENAME,
  pipelineCloseRel,
} from "./feature-delivery-pipeline-close.js";
import {
  ensureOperatorVerificationDoc,
  OPERATOR_VERIFICATION_FILENAME,
  operatorVerificationRel,
} from "./operator-verification.js";
import {
  assertAdvanceArtifacts,
  deliveryReportRel,
  durableFeatureIndexRel,
  parseReviewPassesVerdict,
  stageArtifactContract,
  validateStageCompletionArtifacts,
  type ArtifactContentWarning,
} from "./feature-delivery-stage-artifacts.js";
import {
  readWorkflowHealthSummary,
  type WorkflowHealthSummary,
  workflowHealthRel,
  writeWorkflowHealthArtifact,
} from "./workflow-health.js";
import {
  decodeCountdownTimestamp,
  parseRunDirParts,
} from "./timestamp-decode.js";
import {
  archiveInboxPathForSource,
  collectFeatureIndexInboxCandidates,
  findExistingArchivedInboxPath,
  inboxEntryFromPath,
  pruneEmptyQueueParents,
  resolveLiveInboxSourcePath,
} from "./inbox-archive.js";
import {
  parseTouchSetPaths,
  type ScopeAmendmentEntry,
  touchSetAllowsPath,
  validateImplementationScopeAmendments,
  validateScopeAmendments,
} from "./feature-delivery-gate-validation.js";
import {
  formatWorkArchiveHygieneRemediation,
  listCanonicalWorkDayDirs,
  listTaskDirNames,
  scanWorkArchiveHygiene,
} from "./work-archive-hygiene.js";

export const FEATURE_DELIVERY_STATE_SCHEMA_VERSION = "1" as const;

const FDS_UTC_MS = Date.UTC(2500, 0, 1, 0, 0, 0, 0);
const FEATURE_DELIVERY_STAGES = [
  "plan",
  "implement",
  "review",
  "test",
  "bookkeeping",
  // Legacy post-test stages retained for backward-compatible state repair flows.
  "report",
  "compliance",
  "ship",
  "index",
] as const;
const TERMINAL_STAGE = "complete" as const;
const TASK_ID_PATTERN = /^\d+_\d{4}_[a-z0-9][a-z0-9_-]*$/u;

function resolveFeatureDeliveryProgress(input: {
  progress?: FeatureDeliverySdkProgressReporter;
  testHooks?: FeatureDeliveryTestHooks;
}): FeatureDeliverySdkProgressReporter | undefined {
  return input.progress ?? input.testHooks?.progress;
}

function listGitPaths(repoRoot: string, args: readonly string[]): string[] {
  const result = spawnSync("git", ["-C", repoRoot, ...args], { encoding: "utf8" });
  if (result.status !== 0) {
    const stderr = result.stderr.trim();
    throw new Error(
      `Unable to inspect local diff for touch-set validation: git ${args.join(" ")} failed${stderr.length > 0 ? ` (${stderr})` : "."}`,
    );
  }
  return result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function currentLocalDiffPaths(repoRoot: string): string[] {
  if (!existsSync(path.join(repoRoot, ".git"))) {
    return [];
  }
  const combined = new Set<string>();
  for (const rel of listGitPaths(repoRoot, ["diff", "--name-only", "--relative"])) {
    combined.add(rel);
  }
  for (const rel of listGitPaths(repoRoot, ["diff", "--cached", "--name-only", "--relative", "HEAD"])) {
    combined.add(rel);
  }
  for (const rel of listGitPaths(repoRoot, ["ls-files", "--others", "--exclude-standard"])) {
    combined.add(rel);
  }
  return [...combined].sort((a, b) => a.localeCompare(b));
}

function dirname(rel: string): string {
  return rel.split("/").slice(0, -1).join("/");
}

function isChangeControlledPath(rel: string): boolean {
  return [
    ".github/",
    "lib/memory/",
    "lib/personas/",
    "lib/pipelines/",
    ".cursor/rules/",
    "pancreator.yaml",
  ].some((prefix) => rel === prefix.replace(/\/$/u, "") || rel.startsWith(prefix));
}

function findDeclaredSourceForSibling(
  changedPath: string,
  declaredPaths: readonly string[],
): string | null {
  const changedDir = dirname(changedPath);
  const parentDir = changedDir.split("/").slice(0, -1).join("/");
  for (const declared of declaredPaths) {
    const declaredDir = dirname(declared);
    if (declaredDir === changedDir || declaredDir === parentDir) {
      return declared;
    }
  }
  return null;
}

function inferAutoAmendment(
  changedPath: string,
  declaredPaths: readonly string[],
): ScopeAmendmentEntry | null {
  if (isChangeControlledPath(changedPath)) {
    return null;
  }
  const sourcePath = findDeclaredSourceForSibling(changedPath, declaredPaths);
  if (sourcePath === null) {
    return null;
  }
  if (/(?:^|\/)__tests__\/|(?:^|\/)[^/]+\.(?:test|spec)\.[^/]+$/u.test(changedPath)) {
    return {
      path: changedPath,
      kind: "paired-test",
      reason: `Required regression test for declared source ${sourcePath}`,
    };
  }
  if (/(?:^|\/)__fixtures__\/|(?:^|\/)[^/]+\.fixture\.[^/]+$/u.test(changedPath)) {
    return {
      path: changedPath,
      kind: "paired-fixture",
      reason: `Required fixture for declared source ${sourcePath}`,
    };
  }
  if (dirname(changedPath) === dirname(sourcePath)) {
    return {
      path: changedPath,
      kind: "declared-dir-sibling",
      reason: `Required sibling file for declared source ${sourcePath}`,
    };
  }
  return null;
}

function serializeScopeAmendments(entries: readonly ScopeAmendmentEntry[]): string {
  if (entries.length === 0) {
    return "none";
  }
  return entries.map((entry) => `${entry.path}(${entry.kind}:${entry.reason})`).join(", ");
}

function maybeAutoRecordImplementationAmendments(
  repoRoot: string,
  touchSetRel: string,
  implementationReportRel: string,
  changedPaths: readonly string[],
): void {
  const touchSetAbs = resolveRepoPath(repoRoot, touchSetRel);
  const implementationReportAbs = resolveRepoPath(repoRoot, implementationReportRel);
  const touchSetRaw = readFileSync(touchSetAbs, "utf8");
  const parsedTouchSetJson = JSON.parse(touchSetRaw) as Record<string, unknown>;
  const parsedTouchSet = parseTouchSetPaths(touchSetRaw);
  const undeclaredPaths = changedPaths.filter((changedPath) => !touchSetAllowsPath(touchSetRaw, changedPath).allowed);
  if (undeclaredPaths.length === 0) {
    return;
  }
  const declaredPaths = [...parsedTouchSet.paths, ...parsedTouchSet.sharedPaths];
  const inferred = undeclaredPaths
    .map((changedPath) => inferAutoAmendment(changedPath, declaredPaths))
    .filter((entry): entry is ScopeAmendmentEntry => entry !== null);
  if (inferred.length !== undeclaredPaths.length) {
    return;
  }
  const existingEntries = parsedTouchSet.amendments.map((entry) => `${entry.path}|${entry.kind}|${entry.reason}`);
  const nextAmendments = [...parsedTouchSet.amendments];
  let changed = false;
  for (const entry of inferred) {
    const key = `${entry.path}|${entry.kind}|${entry.reason}`;
    if (existingEntries.includes(key)) {
      continue;
    }
    nextAmendments.push({
      ...entry,
      status: existsSync(resolveRepoPath(repoRoot, entry.path)) ? "existing" : "new",
    });
    changed = true;
  }
  if (!changed) {
    return;
  }
  parsedTouchSetJson.amendments = nextAmendments;
  writeFileSync(touchSetAbs, `${stringifyCliJson(repoRoot, parsedTouchSetJson)}\n`, "utf8");

  const implementationReport = readFileSync(implementationReportAbs, "utf8");
  const nextScopeLine = `scope_amendments: ${serializeScopeAmendments(nextAmendments)}`;
  const updatedReport = implementationReport.match(/^scope_amendments:\s*.+$/mu)
    ? implementationReport.replace(/^scope_amendments:\s*.+$/mu, nextScopeLine)
    : implementationReport.replace(/^implement_gate_passes:\s*(true|false)\s*$/mu, (match) => `${match}\n${nextScopeLine}`);
  writeFileSync(implementationReportAbs, updatedReport, "utf8");
}

function assertImplementStageTouchSetScope(
  repoRoot: string,
  state: FeatureDeliveryState,
): void {
  const runDir = state.artifacts.runDir;
  const touchSetRel = path.posix.join(runDir, "touch-set.json");
  const reportRel = path.posix.join(runDir, "implementation-report.md");
  const allowedRunArtifacts = new Set([touchSetRel, reportRel]);
  const featureDiffPaths: string[] = [];
  for (const rel of currentLocalDiffPaths(repoRoot)) {
    if (rel.startsWith(`${runDir}/`)) {
      if (!allowedRunArtifacts.has(rel)) {
        throw new Error(
          `Cannot advance implement; ${rel} is not a stage-owned implement artifact. Only ${touchSetRel} and ${reportRel} may change under ${runDir} during implement.`,
        );
      }
      continue;
    }
    featureDiffPaths.push(rel);
  }
  maybeAutoRecordImplementationAmendments(
    repoRoot,
    touchSetRel,
    reportRel,
    featureDiffPaths,
  );
  const refreshedTouchSetContent = readFileSync(resolveRepoPath(repoRoot, touchSetRel), "utf8");
  const refreshedImplementationReportContent = readFileSync(
    resolveRepoPath(repoRoot, reportRel),
    "utf8",
  );
  const error = validateImplementationScopeAmendments(
    refreshedTouchSetContent,
    refreshedImplementationReportContent,
    featureDiffPaths,
  );
  if (error !== null) {
    throw new Error(`Cannot advance implement; ${error}`);
  }
}

function touchSetScopePaths(repoRoot: string, runDir: string): string[] {
  const touchSetRel = path.posix.join(runDir, "touch-set.json");
  const touchSetAbs = resolveRepoPath(repoRoot, touchSetRel);
  if (!existsSync(touchSetAbs)) {
    return [];
  }
  const parsed = parseTouchSetPaths(readFileSync(touchSetAbs, "utf8"));
  return [...parsed.paths, ...parsed.sharedPaths, ...parsed.amendments.map((entry) => entry.path)];
}

function featureDiffPathsWithinTouchSet(
  repoRoot: string,
  runDir: string,
): { touchSetContent: string; changedPaths: string[] } {
  const touchSetRel = path.posix.join(runDir, "touch-set.json");
  const touchSetContent = readFileSync(resolveRepoPath(repoRoot, touchSetRel), "utf8");
  const changedPaths = currentLocalDiffPaths(repoRoot).filter(
    (rel) =>
      !rel.startsWith(`${runDir}/`) &&
      touchSetAllowsPath(touchSetContent, rel).allowed,
  );
  return { touchSetContent, changedPaths };
}

function classifyCurrentDiffPaths(
  repoRoot: string,
  runDir: string,
): { pipelineOwnedDiffPaths: string[]; adjacentDiffPaths: string[] } {
  const touchSetRel = path.posix.join(runDir, "touch-set.json");
  const touchSetAbs = resolveRepoPath(repoRoot, touchSetRel);
  const touchSetContent = existsSync(touchSetAbs)
    ? readFileSync(touchSetAbs, "utf8")
    : null;
  const pipelineOwnedDiffPaths: string[] = [];
  const adjacentDiffPaths: string[] = [];
  for (const rel of currentLocalDiffPaths(repoRoot)) {
    if (rel.startsWith(`${runDir}/`)) {
      pipelineOwnedDiffPaths.push(rel);
      continue;
    }
    if (touchSetContent === null) {
      adjacentDiffPaths.push(rel);
      continue;
    }
    const allowed = touchSetAllowsPath(touchSetContent, rel);
    if (allowed.allowed) {
      pipelineOwnedDiffPaths.push(rel);
      continue;
    }
    adjacentDiffPaths.push(rel);
  }
  return { pipelineOwnedDiffPaths, adjacentDiffPaths };
}

function assertReviewStageTouchSetScope(
  repoRoot: string,
  state: FeatureDeliveryState,
): void {
  const runDir = state.artifacts.runDir;
  const { touchSetContent } = featureDiffPathsWithinTouchSet(repoRoot, runDir);
  const reviewDiffPaths: string[] = [];
  for (const rel of currentLocalDiffPaths(repoRoot)) {
    if (rel.startsWith(`${runDir}/`)) {
      continue;
    }
    reviewDiffPaths.push(rel);
  }
  const error = validateScopeAmendments(touchSetContent, reviewDiffPaths);
  if (error !== null) {
    throw new Error(`Cannot advance review; ${error}`);
  }
}

function assertIndexImplementationSurfaces(
  repoRoot: string,
  state: FeatureDeliveryState,
): void {
  const indexRel = durableFeatureIndexRel(state.featureId);
  const raw = readFileSync(resolveRepoPath(repoRoot, indexRel), "utf8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const implementationSurfaces = Array.isArray(parsed.implementation_surfaces)
    ? parsed.implementation_surfaces.filter(
        (value): value is string => typeof value === "string" && value.trim().length > 0,
      )
    : [];
  const expected = featureDiffPathsWithinTouchSet(repoRoot, state.artifacts.runDir).changedPaths.sort((a, b) =>
    a.localeCompare(b),
  );
  const recorded = [...new Set(implementationSurfaces)].sort((a, b) => a.localeCompare(b));
  const missing = expected.filter((rel) => !recorded.includes(rel));
  const extra = recorded.filter((rel) => !expected.includes(rel));
  if (missing.length > 0 || extra.length > 0) {
    const details = [
      missing.length > 0 ? `missing from implementation_surfaces: ${missing.join(", ")}` : null,
      extra.length > 0 ? `not present in current feature diff: ${extra.join(", ")}` : null,
    ]
      .filter((value): value is string => value !== null)
      .join("; ");
    throw new Error(`Cannot advance index; ${indexRel} implementation_surfaces must enumerate the current feature diff (${details}).`);
  }
}

type FeatureDeliveryStageId = (typeof FEATURE_DELIVERY_STAGES)[number];
type FeatureDeliveryCurrentStage =
  | FeatureDeliveryStageId
  | typeof TERMINAL_STAGE
  | "aborted"
  | "paused";

export type StageStatus =
  | "ready"
  | "pending"
  | "complete"
  | "blocked"
  | "skipped";
export type PipelineStatus =
  | "ready_for_stage_delegation"
  | "waiting_for_human_gate"
  | "complete"
  | "complete_with_attention"
  | "closed"
  | "reopened"
  | "repaired"
  | "halted";

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
  kind: "advance" | "repair" | "close" | "reopen";
  from: string;
  to: string;
  event: string;
  artifact: string;
  reason?: string;
}

export interface FeatureDeliveryState {
  schemaVersion: typeof FEATURE_DELIVERY_STATE_SCHEMA_VERSION;
  pipelineId: "feature-delivery" | "out-of-band";
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
    operatorVerificationFile?: string;
  };
  stages: FeatureDeliveryStageState[];
  transitions: FeatureDeliveryTransition[];
  nextHumanAction: string;
  advanceHistory?: FeatureDeliveryAdvanceHistoryEntry[];
  automation?: FeatureDeliveryAutomationState;
  /** Runtime-generated exact resume command (report approval gate, etc.). */
  nextCommand?: string;
  /** Optional feature-delivery toggles resolved at run start and refreshed at plan/test entry. */
  options?: FeatureDeliveryDesignOptions;
}

export type NextStep = {
  event: string | null;
  artifact: string | null;
  nextCommand: string | null;
  source: "derived" | "persisted";
  reason?: string;
};

export interface FeatureDeliveryNextResult {
  command: "next";
  status: "ok";
  taskId: string;
  featureId: string;
  runDir: string;
  currentStage: string;
  pipelineStatus: string;
  nextHumanAction: string;
  event: string | null;
  artifact: string | null;
  nextCommand: string | null;
  source: "derived" | "persisted";
  reason?: string;
  decodedTimestamp?: string;
  decodedTimestampDiagnostic?: string;
}

export interface ValidateArtifactsResult {
  command: "artifacts validate" | "artifacts lint";
  status: "ok" | "invalid";
  taskId: string;
  stage: string;
  warningCount: number;
  warnings: ArtifactContentWarning[];
  missing: string[];
  present: string[];
}

export type {
  FeatureDeliveryAutomationState,
  FeatureDeliveryTestHooks,
  FeatureDeliverySdkProgressReporter,
};

export interface StartFeatureDeliveryInput {
  repoRoot: string;
  inboxEntry: string;
  featureId?: string;
  taskId?: string;
  clock?: () => Date;
  testHooks?: FeatureDeliveryTestHooks;
  progress?: FeatureDeliverySdkProgressReporter;
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
  currentStage: "plan";
  nextHumanAction: string;
  nextCommand?: string | null;
  event?: string | null;
  artifact?: string | null;
  contentWarnings?: ArtifactContentWarning[];
  warningCount?: number;
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
  nextCommand?: string | null;
  event?: string | null;
  artifact?: string | null;
  decodedTimestamp?: string;
  decodedTimestampDiagnostic?: string;
  pipelineOwnedDiffPaths?: string[];
  adjacentDiffPaths?: string[];
}

export interface AdvanceFeatureDeliveryInput {
  repoRoot: string;
  taskId: string;
  artifact: string;
  event?: string;
  clock?: () => Date;
  testHooks?: FeatureDeliveryTestHooks;
  progress?: FeatureDeliverySdkProgressReporter;
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
  /** True when implement-stage advance with review.md chained implementation_complete and review_passes, landing at test. */
  reviewReentry?: boolean;
  nextCommand?: string | null;
  contentWarnings?: ArtifactContentWarning[];
  warningCount?: number;
  pipelineOwnedDiffPaths?: string[];
  adjacentDiffPaths?: string[];
}

export interface RepairFeatureDeliveryStateInput {
  repoRoot: string;
  taskId: string;
  stage: string;
  artifact: string;
  reason: string;
  clock?: () => Date;
  progress?: FeatureDeliverySdkProgressReporter;
  testHooks?: FeatureDeliveryTestHooks;
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

export interface RefreshFeatureDeliveryPromptInput {
  repoRoot: string;
  taskId: string;
}

export interface RefreshFeatureDeliveryPromptResult {
  command: "refresh-prompt";
  status: "ok";
  taskId: string;
  featureId: string;
  currentStage: string;
  stateFile: string;
  handoffFile: string;
  nextPromptFile: string;
  nextPersona: string | null;
  nextHumanAction: string;
}

export interface CloseFeatureDeliveryArtifactsInput {
  repoRoot: string;
  taskId: string;
  clock?: () => Date;
}

export interface CloseFeatureDeliveryArtifactsResult {
  command: "close-artifacts";
  status: "ok";
  taskId: string;
  featureId: string;
  currentStage: "complete";
  pipelineStatus: "closed";
  archivedRunDir: string;
  archivedInboxPath: string;
  activeMemoryPath: string;
  activeFeatureCleared: boolean;
  stateFile: string;
  runLogFile: string;
  nextPromptFile: string;
  nextHumanAction: string;
  operatorVerificationFile: string;
  /** Experience-planning work directories archived because this run originated from one. */
  archivedExperiencePlanningRuns?: string[];
  /** True when the run was already under .pan/archive/work/ and closure finalized state only. */
  alreadyArchived?: boolean;
}

export async function startFeatureDelivery(
  input: StartFeatureDeliveryInput,
  command: "run" | "feature new" = "run",
): Promise<StartFeatureDeliveryResult> {
  const repoRoot = path.resolve(input.repoRoot);
  const now = input.clock?.() ?? new Date();
  const inboxRel = assertInboxInRelativePath(input.inboxEntry, "inbox entry");
  const inboxPath = resolveProjectPath(
    repoRoot,
    "lib",
    "inbox",
    "in",
    ...inboxRel.split("/"),
  );
  const directive = await readFile(inboxPath, "utf8");
  const pipelinePath = resolveProjectPath(
    repoRoot,
    "lib",
    "pipelines",
    "feature-delivery.yaml",
  );
  const pipeline = loadPipelineYaml(pipelinePath);
  if (pipeline.id !== "feature-delivery") {
    throw new Error(
      `Expected feature-delivery pipeline at ${pipelinePath}; found ${pipeline.id}.`,
    );
  }

  const featureId = sanitizeSlug(
    input.featureId ??
      deriveFeatureId(path.posix.basename(inboxRel), directive),
  );
  const taskId = sanitizeTaskId(input.taskId ?? makeTaskId(now, featureId));
  const dayDir = makeDayDir(now);
  const compiled = await compileFeatureDeliveryPipeline(repoRoot, pipeline);

  const runDirRel = path.posix.join(".pan/work", dayDir, taskId);
  const runDir = resolveProjectPath(repoRoot, ".pan/work", dayDir, taskId);
  const stateFileRel = path.posix.join(runDirRel, "state.json");
  const handoffFileRel = path.posix.join(runDirRel, "handoff.md");
  const runLogFileRel = path.posix.join(runDirRel, "run.log.jsonl");
  const nextPromptFileRel = path.posix.join(runDirRel, "next-prompt.md");
  const stateFile = path.join(runDir, "state.json");
  const handoffFile = path.join(runDir, "handoff.md");
  const runLogFile = path.join(runDir, "run.log.jsonl");
  const nextPromptFile = path.join(runDir, "next-prompt.md");
  const invocation = await readCursorInvocationMode(repoRoot);
  const designConfig = await resolveDesignStepsConfig(repoRoot, featureId);

  const state: FeatureDeliveryState = {
    schemaVersion: FEATURE_DELIVERY_STATE_SCHEMA_VERSION,
    pipelineId: "feature-delivery",
    taskId,
    featureId,
    status: "ready_for_stage_delegation",
    currentStage: "plan",
    createdAtIso: rfc3339UtcMs(now),
    source: {
      inboxEntry: inboxRel,
      inboxPath: path.posix.join("lib", "inbox", "in", inboxRel),
    },
    artifacts: {
      runDir: runDirRel,
      stateFile: stateFileRel,
      handoffFile: handoffFileRel,
      runLogFile: runLogFileRel,
      nextPromptFile: nextPromptFileRel,
    },
    stages: buildStageStates(pipeline, invocation),
    transitions: featureDeliveryTransitions(pipeline),
    nextHumanAction:
      "Delegate product/plan-prompt.md to product-engineer and design/plan-prompt.md to design-engineer, then delegate next-prompt.md to tech-lead for consolidated planning.",
    options: {
      designSteps: true,
      designStepsSource: designConfig.designStepsSource,
    },
  };

  ensureAutomationState(state, invocation);
  state.nextHumanAction = nextHumanActionForStage(
    state,
    "plan",
    undefined,
    invocation,
  );

  await mkdir(runDir, { recursive: true });
  await mkdir(path.join(runDir, "product"), { recursive: true });
  await mkdir(path.join(runDir, "design"), { recursive: true });
  await mkdir(path.join(runDir, "tech"), { recursive: true });
  await writeFile(
    handoffFile,
    wrapPanWorkMarkdown(
      renderHandoff(repoRoot, state, pipeline, directive),
      panWorkMarkdownMeta({
        artifact: "Handoff card",
        featureId: state.featureId,
        taskId: state.taskId,
        whyItMatters: "Bounds stage scope, validation commands, and in-scope paths for the active executor.",
      }),
    ),
    "utf8",
  );
  await writeFile(
    nextPromptFile,
    wrapPanWorkMarkdown(
      renderNextPrompt(repoRoot, state, pipeline),
      panWorkMarkdownMeta({
        artifact: "Stage delegation prompt",
        featureId: state.featureId,
        taskId: state.taskId,
        whyItMatters: "Copy-paste prompt for delegating the current feature-delivery stage to the owning persona.",
      }),
    ),
    "utf8",
  );
  await writeFile(
    stateFile,
    stringifyPanWorkJson(
      repoRoot,
      state as unknown as Record<string, unknown>,
      panWorkStateMeta(state.featureId, state.taskId, state.pipelineId),
    ),
    "utf8",
  );
  await persistDesignCompanionPrompts(repoRoot, state);

  if (invocation === "sdk") {
    prepareStageInvocationIndexForSdkEntry(state, "plan", invocation);
    await invokeFeatureDeliveryEnteringStage({
      repoRoot,
      state,
      pipeline,
      stageId: "plan",
      compiled,
      now,
      testHooks: input.testHooks,
      progress: resolveFeatureDeliveryProgress(input),
    });
  }

  await writeFile(
    stateFile,
    stringifyPanWorkJson(
      repoRoot,
      state as unknown as Record<string, unknown>,
      panWorkStateMeta(state.featureId, state.taskId, state.pipelineId),
    ),
    "utf8",
  );
  await appendRunLogRecord(runLogFile, makeInvocationRecord(state, now));

  if (invocation === "sdk") {
    const compiledForChain =
      compiled ?? (await compileFeatureDeliveryPipeline(repoRoot, pipeline));
    await ensureSdkAutoChainProgress({
      repoRoot,
      taskId,
      state,
      pipeline,
      completedStageId: "plan",
      compiled: compiledForChain,
      now,
      clock: input.clock,
      testHooks: input.testHooks,
      progress: resolveFeatureDeliveryProgress(input),
    });
    Object.assign(state, await readFeatureDeliveryState(stateFile));
  }

  return enrichFeatureDeliveryEnvelope(repoRoot, state, {
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
    currentStage: state.currentStage,
    nextHumanAction: state.nextHumanAction,
  }) as StartFeatureDeliveryResult;
}

/** Appends a run-log row for pan pause/resume/abort when a feature-delivery ledger exists. Returns false when no state file matches the task id. */
export async function appendFeatureDeliveryInterventionRunLog(input: {
  repoRoot: string;
  taskId: string;
  command: "pause" | "resume" | "abort";
  abortReason?: string;
  clock?: () => Date;
}): Promise<boolean> {
  try {
    const repoRoot = path.resolve(input.repoRoot);
    const taskId = sanitizeTaskId(input.taskId);
    const now = input.clock?.() ?? new Date();
    let stateFile: { abs: string };
    try {
      stateFile = await findStateFile(repoRoot, taskId);
    } catch {
      return false;
    }
    const state = await readFeatureDeliveryState(stateFile.abs);
    const runLogAbs = resolveRepoPath(repoRoot, state.artifacts.runLogFile);
    await appendRunLogRecord(
      runLogAbs,
      makeInterventionRecord(state, now, input.command, input.abortReason),
    );
    return true;
  } catch {
    return false;
  }
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
  const statusBase = {
    command: "status" as const,
    status: "ok" as const,
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
    ...classifyCurrentDiffPaths(repoRoot, parsed.artifacts.runDir),
    ...decodedTimestampFields(parsed.artifacts.runDir, taskId),
  };
  return enrichFeatureDeliveryEnvelope(repoRoot, parsed, statusBase);
}

export async function resolveFeatureDeliveryTaskId(
  repoRoot: string,
  rawTaskId: string,
): Promise<string> {
  try {
    return sanitizeTaskId(rawTaskId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      !message.includes(
        "task id MUST match <seconds-to-midnight>_<HHMM>_<slug>.",
      )
    ) {
      throw error;
    }
    const suggestion = await suggestTaskIdFromSlug(repoRoot, rawTaskId);
    throw new Error(
      suggestion === null ? message : `${message} Did you mean ${suggestion}?`,
    );
  }
}

export async function advanceFeatureDelivery(
  input: AdvanceFeatureDeliveryInput,
): Promise<AdvanceFeatureDeliveryResult> {
  const repoRoot = path.resolve(input.repoRoot);
  const taskId = await resolveFeatureDeliveryTaskId(repoRoot, input.taskId);
  const now = input.clock?.() ?? new Date();
  const stateFile = await findStateFile(repoRoot, taskId);
  const state = await readFeatureDeliveryState(stateFile.abs);
  const pipeline = loadFeatureDeliveryPipeline(repoRoot);
  const artifact = await assertRepoRelativeExistingFile(
    repoRoot,
    input.artifact,
    "artifact",
  );

  if (state.currentStage === TERMINAL_STAGE) {
    throw new Error(`Task ${taskId} is already complete; refusing to advance.`);
  }

  const reentry = await tryResolveReviewReentryAdvance(
    repoRoot,
    state,
    artifact.rel,
    input.event,
  );
  if (reentry !== null) {
    return advanceReviewReentryFromImplement({
      repoRoot,
      taskId,
      state,
      pipeline,
      stateFileRel: stateFile.rel,
      reentry,
      now,
      testHooks: input.testHooks,
      progress: resolveFeatureDeliveryProgress(input),
    });
  }

  const reportApproval = await tryAdvanceFromReportApproval({
    repoRoot,
    taskId,
    state,
    pipeline,
    stateFileRel: stateFile.rel,
    artifactRel: artifact.rel,
    now,
    testHooks: input.testHooks,
    progress: resolveFeatureDeliveryProgress(input),
  });
  if (reportApproval !== null) {
    return reportApproval;
  }

  const requestedEvent =
    input.event ?? defaultEventForStage(state.currentStage);
  const testResolvedEvent = await resolveTestStageAdvanceEvent(
    repoRoot,
    state,
    requestedEvent,
    artifact.rel,
  );
  const event = await resolveComplianceStageAdvanceEvent(
    repoRoot,
    state,
    testResolvedEvent,
    artifact.rel,
  );
  const invocation = await readCursorInvocationForState(repoRoot, state);
  ensureAutomationState(state, invocation);
  const transition = state.transitions.find(
    (candidate) =>
      candidate.from === state.currentStage && candidate.on === event,
  );
  if (transition === undefined) {
    throw new Error(`No transition from ${state.currentStage} on ${event}.`);
  }
  if (
    ((state.currentStage === "report" && event === "report_ready") ||
      (state.currentStage === "bookkeeping" && event === "bookkeeping_complete")) &&
    artifact.rel === deliveryReportRel(state.artifacts.runDir)
  ) {
    await assertDeliveryReportCitationFormat(repoRoot, artifact.rel);
  }
  try {
    assertStageArtifact(repoRoot, state, state.currentStage, artifact.rel, event);
  } catch (error) {
    const resumed = await tryResumeInterruptedSdkStageAdvance({
      repoRoot,
      taskId,
      state,
      pipeline,
      stateFileRel: stateFile.rel,
      invocation,
      providedArtifactRel: artifact.rel,
      event,
      now,
      testHooks: input.testHooks,
      progress: resolveFeatureDeliveryProgress(input),
    });
    if (resumed !== null) {
      return resumed;
    }
    throw error;
  }
  if (state.currentStage === "implement" && event === "implementation_complete") {
    assertImplementStageTouchSetScope(repoRoot, state);
  }
  if (state.currentStage === "review" && event === "review_passes") {
    assertReviewStageTouchSetScope(repoRoot, state);
  }
  if (
    (state.currentStage === "index" && event === "artifacts_indexed") ||
    (state.currentStage === "bookkeeping" && event === "bookkeeping_complete")
  ) {
    assertIndexImplementationSurfaces(repoRoot, state);
  }

  if (state.currentStage === "compliance") {
    await persistComplianceAuditHistoryForResult({
      repoRoot,
      taskId: state.taskId,
      featureId: state.featureId,
      runDir: state.artifacts.runDir,
      complianceResultRel: artifact.rel,
      defaultScopePaths: complianceScopePathsForFeatureState(repoRoot, state),
      now,
    });
  }

  const contentWarnings = collectStageContentWarnings(
    repoRoot,
    state,
    state.currentStage,
  );
  if (
    (state.currentStage === "ship" ||
      state.currentStage === "compliance" ||
      state.currentStage === "bookkeeping") &&
    contentWarnings.length > 0
  ) {
    const details = contentWarnings
      .map((warning) => `${warning.path}: ${warning.code} (${warning.message})`)
      .join("; ");
    throw new Error(
      `Cannot advance ${state.currentStage}; blocking content warnings remain: ${details}`,
    );
  }

  delete state.nextCommand;
  const applied = applyFeatureDeliveryTransition(
    state,
    transition,
    event,
    artifact.rel,
    now,
  );
  if (applied.toStage === TERMINAL_STAGE) {
    await ensurePipelineCloseDoc(repoRoot, state, now);
    const verificationRel = await ensureOperatorVerificationDoc(
      repoRoot,
      state,
      now,
    );
    state.artifacts.operatorVerificationFile = verificationRel;
  }
  if (invocation === "sdk") {
    const haltSummary = await applySdkRetrySideEffects({
      repoRoot,
      state,
      event: applied.event,
      fromStage: applied.fromStage,
      now,
    });
    if (haltSummary !== null) {
      await persistStateAndPrompts(repoRoot, state, pipeline, "advance");
      await appendRunLogRecord(
        resolveRepoPath(repoRoot, state.artifacts.runLogFile),
        makeAdvanceRecord(
          state,
          now,
          applied.fromStage,
          applied.toStage,
          applied.event,
          applied.artifact,
          { contentWarnings },
        ),
      );
      const haltError = new Error(
        `Feature-delivery retry limit halt: ${haltSummary}`,
      ) as Error & {
        haltSummary: string;
      };
      haltError.haltSummary = haltSummary;
      throw haltError;
    }

    const compiled = await compileFeatureDeliveryPipeline(repoRoot, pipeline);
    if (applied.toStage !== TERMINAL_STAGE) {
      prepareStageInvocationIndexForSdkEntry(
        state,
        applied.toStage,
        invocation,
      );
      await persistStateAndPrompts(repoRoot, state, pipeline, "advance");
      emitFeatureDeliveryStageTransition(
        resolveFeatureDeliveryProgress(input),
        {
          taskId,
          featureId: state.featureId,
          fromStage: applied.fromStage,
          toStage: applied.toStage,
          event: applied.event,
          persona: personaForStage(pipeline, applied.toStage) ?? undefined,
          now,
        },
      );
      await invokeFeatureDeliveryEnteringStage({
        repoRoot,
        state,
        pipeline,
        stageId: applied.toStage,
        compiled,
        now,
        testHooks: input.testHooks,
        progress: resolveFeatureDeliveryProgress(input),
      });
    }

    await persistStateAndPrompts(repoRoot, state, pipeline, "advance");

    const chained = await ensureSdkAutoChainProgress({
      repoRoot,
      taskId,
      state,
      pipeline,
      completedStageId: state.currentStage,
      compiled,
      now,
      clock: input.clock,
      testHooks: input.testHooks,
      progress: resolveFeatureDeliveryProgress(input),
    });

    if (chained) {
      const refreshed = await readFeatureDeliveryState(stateFile.abs);
      Object.assign(state, refreshed);
    }
  }

  await persistStateAndPrompts(repoRoot, state, pipeline, "advance");
  await appendRunLogRecord(
    resolveRepoPath(repoRoot, state.artifacts.runLogFile),
    makeAdvanceRecord(
      state,
      now,
      applied.fromStage,
      applied.toStage,
      applied.event,
      applied.artifact,
      { contentWarnings },
    ),
  );

  await writeWorkflowHealthArtifact({
    repoRoot,
    state,
    stageId: state.currentStage,
    gateBlockReasons: contentWarnings.map((warning) => warning.message),
    now,
  });
  const workflowHealth = readWorkflowHealthSummary(
    repoRoot,
    state.artifacts.runDir,
  );
  if (applied.toStage === TERMINAL_STAGE) {
    applyTerminalWorkflowHealthOutcome(state, workflowHealth);
    await persistStateAndPrompts(repoRoot, state, pipeline, "advance");
  }
  appendTransitionSummary({
    repoRoot,
    state,
    applied,
    now,
    contentWarnings,
  });

  return enrichFeatureDeliveryEnvelope(repoRoot, state, {
    command: "advance",
    status: "ok",
    taskId,
    featureId: state.featureId,
    fromStage: applied.fromStage,
    event: applied.event,
    currentStage: state.currentStage,
    artifact: applied.artifact,
    stateFile: stateFile.rel,
    handoffFile: state.artifacts.handoffFile,
    nextPromptFile: requireNextPromptFile(state),
    nextPersona: personaForStage(pipeline, state.currentStage),
    nextHumanAction: state.nextHumanAction,
    ...classifyCurrentDiffPaths(repoRoot, state.artifacts.runDir),
    contentWarnings,
    warningCount: contentWarnings.length,
  }) as AdvanceFeatureDeliveryResult;
}

interface EnsureSdkAutoChainProgressInput {
  repoRoot: string;
  taskId: string;
  state: FeatureDeliveryState;
  pipeline: PipelineDefinition;
  completedStageId: FeatureDeliveryCurrentStage;
  now: Date;
  clock?: () => Date;
  testHooks?: FeatureDeliveryTestHooks;
  progress?: FeatureDeliverySdkProgressReporter;
  compiled?: Awaited<ReturnType<typeof compileFeatureDeliveryPipeline>>;
}

async function ensureSdkAutoChainProgress(
  input: EnsureSdkAutoChainProgressInput,
): Promise<boolean> {
  const invocation = await readCursorInvocationForState(input.repoRoot, input.state);
  if (invocation !== "sdk") {
    return false;
  }

  let compiled = input.compiled;
  for (;;) {
    const chained = await trySdkAutoChainAfterStageWork({
      repoRoot: input.repoRoot,
      state: input.state,
      pipeline: input.pipeline,
      completedStageId: input.completedStageId,
      compiled,
      now: input.now,
      testHooks: input.testHooks,
      advanceFn: async (chainEvent, chainArtifact) =>
        advanceFeatureDelivery({
          repoRoot: input.repoRoot,
          taskId: input.taskId,
          artifact: chainArtifact,
          event: chainEvent,
          clock: input.clock,
          testHooks: input.testHooks,
          progress: input.progress,
        }),
    });
    if (chained) {
      return true;
    }
    if (input.testHooks?.disableAutoChainContinuationRetry === true) {
      return false;
    }
    if (
      !isNonTerminalFeatureDeliveryState(input.state) ||
      input.state.currentStage !== input.completedStageId
    ) {
      return false;
    }

    const stallReason =
      `SDK auto-chain stalled at ${input.completedStageId}; no valid automatic transition was derived from current stage artifacts.`;
    input.state.status = "halted";
    input.state.nextHumanAction =
      `${stallReason} Fix stage outputs or transition logic, then run pan repair-state/pan resume.`;
    await persistStateAndPrompts(input.repoRoot, input.state, input.pipeline, "advance");
    await writeWorkflowHealthArtifact({
      repoRoot: input.repoRoot,
      state: input.state,
      stageId: input.completedStageId,
      gateBlockReasons: [stallReason],
      now: input.now,
    });
    throw new Error(stallReason);
  }
}

interface ResumeInterruptedSdkStageAdvanceInput {
  repoRoot: string;
  taskId: string;
  state: FeatureDeliveryState;
  pipeline: PipelineDefinition;
  stateFileRel: string;
  invocation: "manual" | "sdk";
  providedArtifactRel: string;
  event: string;
  now: Date;
  testHooks?: FeatureDeliveryTestHooks;
  progress?: FeatureDeliverySdkProgressReporter;
}

async function tryResumeInterruptedSdkStageAdvance(
  input: ResumeInterruptedSdkStageAdvanceInput,
): Promise<AdvanceFeatureDeliveryResult | null> {
  if (input.invocation !== "sdk") {
    return null;
  }
  if (input.state.status !== "ready_for_stage_delegation") {
    return null;
  }
  if (!isNonTerminalFeatureDeliveryState(input.state)) {
    return null;
  }
  if (input.event !== defaultEventForStage(input.state.currentStage)) {
    return null;
  }

  const lastAdvance = lastAdvanceEntry(input.state);
  if (
    lastAdvance?.to !== input.state.currentStage ||
    lastAdvance.artifact !== input.providedArtifactRel
  ) {
    return null;
  }

  const resumeStageId = input.state.currentStage;
  const compiled = await compileFeatureDeliveryPipeline(input.repoRoot, input.pipeline);
  prepareStageInvocationIndexForSdkEntry(input.state, resumeStageId, input.invocation);
  await persistStateAndPrompts(input.repoRoot, input.state, input.pipeline, "advance");
  await invokeFeatureDeliveryEnteringStage({
    repoRoot: input.repoRoot,
    state: input.state,
    pipeline: input.pipeline,
    stageId: resumeStageId,
    compiled,
    now: input.now,
    testHooks: input.testHooks,
    progress: input.progress,
  });
  await persistStateAndPrompts(input.repoRoot, input.state, input.pipeline, "advance");

  const chained = await ensureSdkAutoChainProgress({
    repoRoot: input.repoRoot,
    taskId: input.taskId,
    state: input.state,
    pipeline: input.pipeline,
    completedStageId: resumeStageId,
    compiled,
    now: input.now,
    clock: () => input.now,
    testHooks: input.testHooks,
    progress: input.progress,
  });

  if (chained) {
    const refreshed = await readFeatureDeliveryState(
      resolveRepoPath(input.repoRoot, input.state.artifacts.stateFile),
    );
    Object.assign(input.state, refreshed);
  }

  await writeWorkflowHealthArtifact({
    repoRoot: input.repoRoot,
    state: input.state,
    stageId: input.state.currentStage,
    gateBlockReasons: [],
    now: input.now,
  });

  return enrichFeatureDeliveryEnvelope(input.repoRoot, input.state, {
    command: "advance",
    status: "ok",
    taskId: input.taskId,
    featureId: input.state.featureId,
    fromStage: resumeStageId,
    event: `resume_${resumeStageId}`,
    currentStage: input.state.currentStage,
    artifact: input.providedArtifactRel,
    stateFile: input.stateFileRel,
    handoffFile: input.state.artifacts.handoffFile,
    nextPromptFile: requireNextPromptFile(input.state),
    nextPersona: personaForStage(input.pipeline, input.state.currentStage),
    nextHumanAction: input.state.nextHumanAction,
    ...classifyCurrentDiffPaths(input.repoRoot, input.state.artifacts.runDir),
  }) as AdvanceFeatureDeliveryResult;
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
    throw new Error(
      "repair-state requires a concrete --reason with at least 12 characters.",
    );
  }

  const stateFile = await findStateFile(repoRoot, taskId);
  const state = await readFeatureDeliveryState(stateFile.abs);
  const pipeline = loadFeatureDeliveryPipeline(repoRoot);
  const artifact = await assertRepoRelativeExistingFile(
    repoRoot,
    input.artifact,
    "artifact",
  );
  const previousStage = state.currentStage;

  state.currentStage = targetStage;
  state.status = "repaired";
  state.nextHumanAction = nextHumanActionForStage(
    state,
    targetStage,
    `Manual state repair: ${reason}.`,
    state.automation?.runnerInvocation ??
      (await readCursorInvocationMode(repoRoot)),
  );
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

  const invocation = await readCursorInvocationMode(repoRoot);
  ensureAutomationState(state, invocation);
  if (state.automation !== undefined) {
    state.automation.cumulativeRetryCount = 0;
  }
  if (invocation === "sdk") {
    state.status = "ready_for_stage_delegation";
    const compiled = await compileFeatureDeliveryPipeline(repoRoot, pipeline);
    prepareStageInvocationIndexForSdkEntry(state, targetStage, invocation);
    await persistStateAndPrompts(repoRoot, state, pipeline, "repair");
    emitFeatureDeliveryStageTransition(resolveFeatureDeliveryProgress(input), {
      taskId,
      featureId: state.featureId,
      fromStage: previousStage,
      toStage: targetStage,
      event: "manual_repair",
      persona: personaForStage(pipeline, targetStage) ?? undefined,
      now,
    });
    await invokeFeatureDeliveryEnteringStage({
      repoRoot,
      state,
      pipeline,
      stageId: targetStage,
      compiled,
      now,
      testHooks: input.testHooks,
      progress: resolveFeatureDeliveryProgress(input),
    });
    await persistStateAndPrompts(repoRoot, state, pipeline, "repair");
    const chained = await ensureSdkAutoChainProgress({
      repoRoot,
      taskId,
      state,
      pipeline,
      completedStageId: targetStage,
      compiled,
      now,
      clock: input.clock,
      testHooks: input.testHooks,
      progress: resolveFeatureDeliveryProgress(input),
    });
    if (chained) {
      const refreshed = await readFeatureDeliveryState(stateFile.abs);
      Object.assign(state, refreshed);
    }
  }

  await persistStateAndPrompts(repoRoot, state, pipeline, "repair");
  await appendRunLogRecord(
    resolveRepoPath(repoRoot, state.artifacts.runLogFile),
    makeRepairRecord(
      state,
      now,
      previousStage,
      targetStage,
      artifact.rel,
      reason,
    ),
  );
  const gateBlockReasons = isNonTerminalFeatureDeliveryState(state)
    ? validateStageCompletionArtifacts(repoRoot, state, state.currentStage).warnings.map(
        (warning) => warning.message,
      )
    : [];
  await writeWorkflowHealthArtifact({
    repoRoot,
    state,
    stageId: state.currentStage,
    gateBlockReasons,
    now,
  });

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

export async function refreshFeatureDeliveryPrompt(
  input: RefreshFeatureDeliveryPromptInput,
): Promise<RefreshFeatureDeliveryPromptResult> {
  const repoRoot = path.resolve(input.repoRoot);
  const taskId = sanitizeTaskId(input.taskId);
  const stateFile = await findStateFile(repoRoot, taskId);
  const state = await readFeatureDeliveryState(stateFile.abs);
  const pipeline = loadFeatureDeliveryPipeline(repoRoot);

  await persistStateAndPrompts(repoRoot, state, pipeline, "refresh-prompt");

  return {
    command: "refresh-prompt",
    status: "ok",
    taskId,
    featureId: state.featureId,
    currentStage: state.currentStage,
    stateFile: stateFile.rel,
    handoffFile: state.artifacts.handoffFile,
    nextPromptFile: requireNextPromptFile(state),
    nextPersona: personaForStage(pipeline, state.currentStage),
    nextHumanAction: state.nextHumanAction,
  };
}

export async function loadFeatureDeliveryStateForTask(
  repoRoot: string,
  taskId: string,
): Promise<{
  state: FeatureDeliveryState;
  stateFile: { abs: string; rel: string };
}> {
  const stateFile = await findStateFile(repoRoot, sanitizeTaskId(taskId));
  const state = await readFeatureDeliveryState(stateFile.abs);
  return { state, stateFile };
}

export async function closeFeatureDeliveryArtifacts(
  input: CloseFeatureDeliveryArtifactsInput,
): Promise<CloseFeatureDeliveryArtifactsResult> {
  const repoRoot = path.resolve(input.repoRoot);
  const taskId = sanitizeTaskId(input.taskId);
  const now = input.clock?.() ?? new Date();
  const stateFile = await findStateFile(repoRoot, taskId);
  const state = await readFeatureDeliveryState(stateFile.abs);
  const pipeline = loadFeatureDeliveryPipeline(repoRoot);

  if (
    state.currentStage !== TERMINAL_STAGE ||
    (state.status !== "complete" && state.status !== "complete_with_attention")
  ) {
    if (state.currentStage === TERMINAL_STAGE && state.status === "closed") {
      throw new Error(`Task ${taskId} is already closed.`);
    }
    throw new Error(
      `Task ${taskId} must be complete before artifact closure; got ${state.currentStage}/${state.status}.`,
    );
  }

  const closure = finalClosurePaths(state);
  const activeRunDirAbs = resolveRepoPath(repoRoot, closure.runDirRel);
  const archiveRunDirAbs = resolveRepoPath(repoRoot, closure.workArchiveRel);
  const indexRel = durableFeatureIndexRel(state.featureId);
  const indexAbs = resolveRepoPath(repoRoot, indexRel);
  let inboxSourceRel = closure.inboxSourceRel;
  if (!existsSync(resolveRepoPath(repoRoot, inboxSourceRel))) {
    const indexCandidates =
      existsSync(indexAbs)
        ? collectFeatureIndexInboxCandidates(
            JSON.parse(await readFile(indexAbs, "utf8")) as Record<string, unknown>,
          )
        : [];
    const resolvedInboxSourceRel = await resolveLiveInboxSourcePath(
      repoRoot,
      inboxSourceRel,
      indexCandidates,
    );
    if (resolvedInboxSourceRel === null) {
      throw new Error(`Required file is missing: ${inboxSourceRel}.`);
    }
    if (resolvedInboxSourceRel !== inboxSourceRel) {
      state.source.inboxPath = resolvedInboxSourceRel;
      state.source.inboxEntry = inboxEntryFromPath(resolvedInboxSourceRel);
      inboxSourceRel = resolvedInboxSourceRel;
      await writeFile(
        stateFile.abs,
        stringifyPanWorkJson(
          repoRoot,
          state as unknown as Record<string, unknown>,
          panWorkStateMeta(state.featureId, state.taskId, state.pipelineId),
        ),
        "utf8",
      );
    }
  }
  let inboxSourceAbs = resolveRepoPath(repoRoot, inboxSourceRel);
  let inboxArchiveRel = archiveInboxPathForSource(
    inboxSourceRel,
    parseWorkRunDir(closure.runDirRel, taskId).dayDir,
  );
  let inboxArchiveAbs = resolveRepoPath(repoRoot, inboxArchiveRel);
  const activeMemoryRel = path.posix.join(
    "lib",
    "memory",
    "active",
    "current.md",
  );

  const activeRunExists = existsSync(activeRunDirAbs);
  let archiveRunExists = existsSync(archiveRunDirAbs);
  const inboxSourceExists = existsSync(inboxSourceAbs);
  let inboxArchiveExists = existsSync(inboxArchiveAbs);
  if (!inboxSourceExists && !inboxArchiveExists) {
    const run = parseWorkRunDir(closure.runDirRel, taskId);
    const siblingArchive = await findExistingArchivedInboxPath(
      repoRoot,
      inboxSourceRel,
      run.dayDir,
    );
    if (siblingArchive !== null) {
      inboxArchiveRel = siblingArchive.rel;
      inboxArchiveAbs = siblingArchive.abs;
      inboxArchiveExists = true;
    }
  }

  if (activeRunExists && archiveRunExists) {
    const activeStateAbs = path.join(activeRunDirAbs, "state.json");
    const archiveStateAbs = path.join(archiveRunDirAbs, "state.json");
    const loadedFromActive = path.resolve(stateFile.abs) === path.resolve(activeStateAbs);
    const loadedFromArchive = path.resolve(stateFile.abs) === path.resolve(archiveStateAbs);
    if (loadedFromActive) {
      await rm(archiveRunDirAbs, { recursive: true, force: true });
      archiveRunExists = false;
    } else if (loadedFromArchive) {
      await rm(activeRunDirAbs, { recursive: true, force: true });
    } else {
      throw new Error(
        `Duplicate run directories for task ${taskId}: both ${closure.runDirRel} and ${closure.workArchiveRel} exist. Roll back the premature archive move before close-artifacts.`,
      );
    }
  }

  const alreadyArchived = !activeRunExists && archiveRunExists;
  const runDirRel = alreadyArchived
    ? closure.workArchiveRel
    : closure.runDirRel;
  if (!alreadyArchived) {
    await assertExistingDirectory(activeRunDirAbs, closure.runDirRel);
    await assertPathMissing(archiveRunDirAbs, closure.workArchiveRel);
  } else {
    await assertExistingDirectory(archiveRunDirAbs, closure.workArchiveRel);
  }

  await assertExistingFile(resolveRepoPath(repoRoot, indexRel), indexRel);
  await assertExistingFile(
    resolveRepoPath(
      repoRoot,
      path.posix.join(runDirRel, PIPELINE_CLOSE_FILENAME),
    ),
    path.posix.join(runDirRel, PIPELINE_CLOSE_FILENAME),
  );
  await assertExistingFile(
    resolveRepoPath(
      repoRoot,
      path.posix.join(runDirRel, OPERATOR_VERIFICATION_FILENAME),
    ),
    path.posix.join(runDirRel, OPERATOR_VERIFICATION_FILENAME),
  );

  const inboxAlreadyArchivedForRun = !inboxSourceExists && inboxArchiveExists;
  if (!alreadyArchived) {
    if (inboxAlreadyArchivedForRun) {
      await assertExistingFile(inboxArchiveAbs, inboxArchiveRel);
    } else {
      await assertExistingFile(inboxSourceAbs, inboxSourceRel);
      await assertPathMissing(inboxArchiveAbs, inboxArchiveRel);
    }
  } else if (!inboxArchiveExists && inboxSourceExists) {
    await assertPathMissing(inboxArchiveAbs, inboxArchiveRel);
  } else if (inboxArchiveExists && inboxSourceExists) {
    throw new Error(
      `Duplicate inbox paths for task ${taskId}: both ${inboxSourceRel} and ${inboxArchiveRel} exist.`,
    );
  }

  const stateSnapshot = await readFile(
    resolveRepoPath(repoRoot, path.posix.join(runDirRel, "state.json")),
    "utf8",
  );
  const handoffSnapshot = await readFile(
    resolveRepoPath(repoRoot, path.posix.join(runDirRel, "handoff.md")),
    "utf8",
  );
  const nextPromptSnapshot = await readFile(
    resolveRepoPath(repoRoot, path.posix.join(runDirRel, "next-prompt.md")),
    "utf8",
  );
  const runLogSnapshot = await readFile(
    resolveRepoPath(repoRoot, path.posix.join(runDirRel, "run.log.jsonl")),
    "utf8",
  );
  const indexSnapshot = await readFile(
    resolveRepoPath(repoRoot, indexRel),
    "utf8",
  );
  const activeMemoryAbs = resolveRepoPath(repoRoot, activeMemoryRel);
  const activeMemorySnapshot = existsSync(activeMemoryAbs)
    ? await readFile(activeMemoryAbs, "utf8")
    : null;
  const complianceAuditHistoryAbs = resolveRepoPath(
    repoRoot,
    COMPLIANCE_AUDIT_HISTORY_REL,
  );
  const complianceAuditHistorySnapshot = existsSync(complianceAuditHistoryAbs)
    ? await readFile(complianceAuditHistoryAbs, "utf8")
    : null;

  if (!alreadyArchived) {
    await mkdir(path.dirname(archiveRunDirAbs), { recursive: true });
    if (!inboxAlreadyArchivedForRun) {
      await mkdir(path.dirname(inboxArchiveAbs), { recursive: true });
    }
  } else if (inboxSourceExists && !inboxArchiveExists) {
    await mkdir(path.dirname(inboxArchiveAbs), { recursive: true });
  }

  let inboxArchived = alreadyArchived && inboxArchiveExists;
  let runArchived = alreadyArchived;
  try {
    if (!alreadyArchived) {
      if (!inboxAlreadyArchivedForRun) {
        await rename(inboxSourceAbs, inboxArchiveAbs);
        inboxArchived = true;
        await pruneEmptyQueueParents(
          repoRoot,
          path.posix.dirname(inboxSourceRel),
          "lib/inbox/in",
        );
      } else {
        inboxArchived = true;
      }
      await rename(activeRunDirAbs, archiveRunDirAbs);
      runArchived = true;
      await assertExistingDirectory(archiveRunDirAbs, closure.workArchiveRel);
      await pruneEmptyQueueParents(
        repoRoot,
        path.posix.dirname(closure.runDirRel),
        ".pan/work",
      );
    } else if (inboxSourceExists && !inboxArchiveExists) {
      await rename(inboxSourceAbs, inboxArchiveAbs);
      inboxArchived = true;
      await pruneEmptyQueueParents(
        repoRoot,
        path.posix.dirname(closure.inboxSourceRel),
        "lib/inbox/in",
      );
    }

    const previousRunDir = state.artifacts.runDir;
    state.artifacts = {
      runDir: closure.workArchiveRel,
      stateFile: path.posix.join(closure.workArchiveRel, "state.json"),
      handoffFile: path.posix.join(closure.workArchiveRel, "handoff.md"),
      runLogFile: path.posix.join(closure.workArchiveRel, "run.log.jsonl"),
      nextPromptFile: path.posix.join(closure.workArchiveRel, "next-prompt.md"),
      operatorVerificationFile: path.posix.join(
        closure.workArchiveRel,
        OPERATOR_VERIFICATION_FILENAME,
      ),
    };
    state.status = "closed";
    state.nextHumanAction =
      "Artifact closure complete; active work and source inbox directive are archived. No further feature-delivery action is required.";
    state.advanceHistory = [
      ...(state.advanceHistory ?? []),
      {
        atIso: rfc3339UtcMs(now),
        kind: "close",
        from: TERMINAL_STAGE,
        to: TERMINAL_STAGE,
        event: "artifacts_closed",
        artifact: closure.workArchiveRel,
        reason: alreadyArchived
          ? `Finalized closure for run already archived at ${closure.workArchiveRel}.`
          : `Archived active run from ${previousRunDir} and source inbox directive from ${inboxSourceRel}.`,
      },
    ];

    const persistedRunDirRel = closure.workArchiveRel;
    await writeFile(
      resolveRepoPath(
        repoRoot,
        path.posix.join(persistedRunDirRel, "state.json"),
      ),
      stringifyPanWorkJson(
        repoRoot,
        state as unknown as Record<string, unknown>,
        panWorkStateMeta(state.featureId, state.taskId, state.pipelineId),
      ),
      "utf8",
    );
    await writeFile(
      resolveRepoPath(
        repoRoot,
        path.posix.join(persistedRunDirRel, "handoff.md"),
      ),
      wrapPanWorkMarkdown(
        renderHandoff(repoRoot, state, pipeline),
        panWorkMarkdownMeta({
          artifact: "Handoff card",
          featureId: state.featureId,
          taskId: state.taskId,
          whyItMatters: "Bounds stage scope, validation commands, and in-scope paths for the active executor.",
        }),
      ),
      "utf8",
    );
    await writeFile(
      resolveRepoPath(
        repoRoot,
        path.posix.join(persistedRunDirRel, "next-prompt.md"),
      ),
      wrapPanWorkMarkdown(
        `# Generated by pan close-artifacts\n\n${renderNextPrompt(repoRoot, state, pipeline)}`,
        panWorkMarkdownMeta({
          artifact: "Stage delegation prompt",
          featureId: state.featureId,
          taskId: state.taskId,
          whyItMatters: "Copy-paste prompt for delegating the current feature-delivery stage to the owning persona.",
        }),
      ),
      "utf8",
    );
    await appendRunLogRecord(
      resolveRepoPath(
        repoRoot,
        path.posix.join(persistedRunDirRel, "run.log.jsonl"),
      ),
      makeCloseRecord(
        state,
        now,
        previousRunDir,
        closure.workArchiveRel,
        inboxSourceRel,
        inboxArchiveRel,
      ),
    );

    await patchFeatureIndexArchivedInbox(
      repoRoot,
      state.featureId,
      inboxArchiveRel,
      inboxSourceRel,
    );
    await normalizeComplianceAuditHistoryForArchivedRun({
      repoRoot,
      taskId: state.taskId,
      fromRunDir: previousRunDir,
      toRunDir: closure.workArchiveRel,
    });

    const activeMemoryRefresh = await applyActiveMemoryRefreshOnArtifactClosure(
      repoRoot,
      {
        archivedInboxSourceRel: inboxSourceRel,
        clock: input.clock,
      },
    );

    const archivedExperiencePlanningRuns =
      await archiveExperiencePlanningForClosedFeatureDelivery(
        repoRoot,
        inboxArchiveRel,
        now,
      );

    return {
      command: "close-artifacts",
      status: "ok",
      taskId,
      featureId: state.featureId,
      currentStage: TERMINAL_STAGE,
      pipelineStatus: "closed",
      archivedRunDir: closure.workArchiveRel,
      archivedInboxPath: inboxArchiveRel,
      activeMemoryPath: activeMemoryRefresh.path,
      activeFeatureCleared: activeMemoryRefresh.activeFeatureCleared,
      stateFile: state.artifacts.stateFile,
      runLogFile: state.artifacts.runLogFile,
      nextPromptFile: requireNextPromptFile(state),
      nextHumanAction: state.nextHumanAction,
      operatorVerificationFile:
        state.artifacts.operatorVerificationFile ??
        path.posix.join(closure.workArchiveRel, OPERATOR_VERIFICATION_FILENAME),
      archivedExperiencePlanningRuns,
      ...(alreadyArchived ? { alreadyArchived: true } : {}),
    };
  } catch (error) {
    const rollbackFailures: string[] = [];
    const activeRunStateAbs = resolveRepoPath(repoRoot, closure.runDirRel);
    const archiveRunStateAbs = resolveRepoPath(
      repoRoot,
      closure.workArchiveRel,
    );
    const activeInboxStateAbs = resolveRepoPath(
      repoRoot,
      inboxSourceRel,
    );
    const archiveInboxStateAbs = resolveRepoPath(
      repoRoot,
      inboxArchiveRel,
    );

    if (
      runArchived &&
      existsSync(archiveRunStateAbs) &&
      !existsSync(activeRunStateAbs)
    ) {
      try {
        await mkdir(path.dirname(activeRunStateAbs), { recursive: true });
        await rename(archiveRunStateAbs, activeRunStateAbs);
      } catch (rollbackError) {
        rollbackFailures.push(
          `restore run directory (${formatError(rollbackError)})`,
        );
      }
    }
    if (
      inboxArchived &&
      existsSync(archiveInboxStateAbs) &&
      !existsSync(activeInboxStateAbs)
    ) {
      try {
        await mkdir(path.dirname(activeInboxStateAbs), { recursive: true });
        await rename(archiveInboxStateAbs, activeInboxStateAbs);
      } catch (rollbackError) {
        rollbackFailures.push(
          `restore inbox directive (${formatError(rollbackError)})`,
        );
      }
    }

    if (existsSync(activeRunStateAbs)) {
      try {
        await writeFile(
          path.join(activeRunStateAbs, "state.json"),
          stateSnapshot,
          "utf8",
        );
        await writeFile(
          path.join(activeRunStateAbs, "handoff.md"),
          handoffSnapshot,
          "utf8",
        );
        await writeFile(
          path.join(activeRunStateAbs, "next-prompt.md"),
          nextPromptSnapshot,
          "utf8",
        );
        await writeFile(
          path.join(activeRunStateAbs, "run.log.jsonl"),
          runLogSnapshot,
          "utf8",
        );
      } catch (rollbackError) {
        rollbackFailures.push(
          `restore active run files (${formatError(rollbackError)})`,
        );
      }
    }

    try {
      await writeFile(
        resolveRepoPath(repoRoot, indexRel),
        indexSnapshot,
        "utf8",
      );
    } catch (rollbackError) {
      rollbackFailures.push(
        `restore feature index (${formatError(rollbackError)})`,
      );
    }
    if (activeMemorySnapshot !== null) {
      try {
        await writeFile(activeMemoryAbs, activeMemorySnapshot, "utf8");
      } catch (rollbackError) {
        rollbackFailures.push(
          `restore active memory (${formatError(rollbackError)})`,
        );
      }
    }
    if (complianceAuditHistorySnapshot !== null) {
      try {
        await writeFile(
          complianceAuditHistoryAbs,
          complianceAuditHistorySnapshot,
          "utf8",
        );
      } catch (rollbackError) {
        rollbackFailures.push(
          `restore compliance audit history (${formatError(rollbackError)})`,
        );
      }
    }

    if (rollbackFailures.length > 0) {
      throw new Error(
        `close-artifacts failed (${formatError(error)}); rollback incomplete: ${rollbackFailures.join("; ")}.`,
      );
    }
    throw error;
  }
}

export interface ReopenFeatureDeliveryInput {
  repoRoot: string;
  taskId: string;
  stage?: string;
  reason: string;
  clock?: () => Date;
  testHooks?: FeatureDeliveryTestHooks;
  progress?: FeatureDeliverySdkProgressReporter;
}

export interface ReopenFeatureDeliveryResult {
  command: "reopen";
  status: "ok";
  taskId: string;
  featureId: string;
  previousStage: string;
  currentStage: string;
  pipelineStatus: "reopened";
  runDir: string;
  stateFile: string;
  handoffFile: string;
  nextPromptFile: string;
  nextPersona: string | null;
  nextHumanAction: string;
  reason: string;
}

export async function reopenFeatureDelivery(
  input: ReopenFeatureDeliveryInput,
): Promise<ReopenFeatureDeliveryResult> {
  const repoRoot = path.resolve(input.repoRoot);
  const taskId = sanitizeTaskId(input.taskId);
  const now = input.clock?.() ?? new Date();
  const reason = input.reason.trim();
  if (reason.length < 12) {
    throw new Error(
      "reopen requires a concrete --reason with at least 12 characters.",
    );
  }

  const stateFile = await findStateFile(repoRoot, taskId);
  const state = await readFeatureDeliveryState(stateFile.abs);

  if (state.status !== "closed") {
    throw new Error(
      `Task ${taskId} must be closed before reopen; got status ${state.status}.`,
    );
  }

  const targetStageInput = input.stage?.trim();
  let targetStage: FeatureDeliveryStageId | typeof TERMINAL_STAGE;
  if (targetStageInput === undefined || targetStageInput.length === 0) {
    targetStage = "plan";
  } else {
    if (targetStageInput === TERMINAL_STAGE || targetStageInput === "closed") {
      throw new Error(
        `reopen MUST NOT target terminal stage ${targetStageInput}.`,
      );
    }
    targetStage = assertFeatureDeliveryStage(targetStageInput);
  }

  const closure = finalClosurePaths(state);
  const activeRunDirAbs = resolveRepoPath(repoRoot, closure.runDirRel);
  const archiveRunDirAbs = resolveRepoPath(repoRoot, closure.workArchiveRel);

  if (existsSync(activeRunDirAbs)) {
    throw new Error(
      `Active run directory already exists at ${closure.runDirRel}; resolve the duplicate before reopen.`,
    );
  }
  if (!existsSync(archiveRunDirAbs)) {
    throw new Error(
      `Archived run directory is missing: ${closure.workArchiveRel}.`,
    );
  }

  const inboxSourceAbs = resolveRepoPath(repoRoot, closure.inboxSourceRel);
  const inboxArchiveAbs = resolveRepoPath(repoRoot, closure.inboxArchiveRel);
  let inboxRestored = false;

  await mkdir(path.dirname(activeRunDirAbs), { recursive: true });
  await rename(archiveRunDirAbs, activeRunDirAbs);
  await pruneEmptyQueueParents(
    repoRoot,
    path.posix.dirname(closure.workArchiveRel),
    ".pan/archive/work",
  );

  if (existsSync(inboxArchiveAbs) && !existsSync(inboxSourceAbs)) {
    await mkdir(path.dirname(inboxSourceAbs), { recursive: true });
    await rename(inboxArchiveAbs, inboxSourceAbs);
    inboxRestored = true;
  }

  const previousStage = state.currentStage;
  rewriteActiveWorkArtifactPaths(state, closure.runDirRel);

  if (state.pipelineId === "feature-delivery") {
    const pipeline = loadFeatureDeliveryPipeline(repoRoot);
    state.stages = repairStageStatuses(state.stages, targetStage);
    state.currentStage = targetStage;
    state.nextHumanAction = nextHumanActionForStage(
      state,
      targetStage,
      `Operator reopen: ${reason}`,
      state.automation?.runnerInvocation ??
        (await readCursorInvocationMode(repoRoot)),
    );
    state.advanceHistory = [
      ...(state.advanceHistory ?? []),
      {
        atIso: rfc3339UtcMs(now),
        kind: "reopen",
        from: previousStage,
        to: targetStage,
        event: "operator_reopen",
        artifact: closure.runDirRel,
        reason,
      },
    ];
    state.status = "reopened";
    ensureAutomationState(
      state,
      state.automation?.runnerInvocation ??
        (await readCursorInvocationMode(repoRoot)),
    );
    if (state.automation !== undefined) {
      state.automation.cumulativeRetryCount = 0;
    }
    await persistStateAndPrompts(repoRoot, state, pipeline, "repair");
    await appendRunLogRecord(
      resolveRepoPath(repoRoot, state.artifacts.runLogFile),
      makeReopenRecord(state, now, previousStage, targetStage, reason),
    );
    await patchFeatureIndexReopenedInbox(
      repoRoot,
      state.featureId,
      closure.inboxSourceRel,
    );
    await applyActiveMemoryRefreshOnReopen(repoRoot, {
      activeInboxSourceRel: closure.inboxSourceRel,
      clock: input.clock,
    });
    await normalizeComplianceAuditHistoryForArchivedRun({
      repoRoot,
      taskId: state.taskId,
      fromRunDir: closure.workArchiveRel,
      toRunDir: closure.runDirRel,
    });

    const invocation =
      state.automation?.runnerInvocation ??
      (await readCursorInvocationMode(repoRoot));
    if (invocation === "sdk") {
      state.status = "ready_for_stage_delegation";
      const compiled = await compileFeatureDeliveryPipeline(repoRoot, pipeline);
      prepareStageInvocationIndexForSdkEntry(state, targetStage, invocation);
      await persistStateAndPrompts(repoRoot, state, pipeline, "repair");
      emitFeatureDeliveryStageTransition(
        resolveFeatureDeliveryProgress(input),
        {
          taskId,
          featureId: state.featureId,
          fromStage: previousStage,
          toStage: targetStage,
          event: "operator_reopen",
          persona: personaForStage(pipeline, targetStage) ?? undefined,
          now,
        },
      );
      await invokeFeatureDeliveryEnteringStage({
        repoRoot,
        state,
        pipeline,
        stageId: targetStage,
        compiled,
        now,
        testHooks: input.testHooks,
        progress: resolveFeatureDeliveryProgress(input),
      });
      await persistStateAndPrompts(repoRoot, state, pipeline, "repair");
    }

    return {
      command: "reopen",
      status: "ok",
      taskId,
      featureId: state.featureId,
      previousStage,
      currentStage: state.currentStage,
      pipelineStatus: "reopened",
      runDir: state.artifacts.runDir,
      stateFile: state.artifacts.stateFile,
      handoffFile: state.artifacts.handoffFile,
      nextPromptFile: requireNextPromptFile(state),
      nextPersona: personaForStage(pipeline, state.currentStage),
      nextHumanAction: state.nextHumanAction,
      reason,
    };
  }

  state.currentStage = targetStage;
  state.status = "reopened";
  state.pipelineId = "feature-delivery";
  const pipeline = loadFeatureDeliveryPipeline(repoRoot);
  state.stages = buildStageStates(
    pipeline,
    state.automation?.runnerInvocation ?? "manual",
  );
  state.transitions = featureDeliveryTransitions(pipeline);
  state.stages = repairStageStatuses(state.stages, targetStage);
  state.nextHumanAction = nextHumanActionForStage(
    state,
    targetStage,
    `Out-of-band reopen promoted to feature-delivery: ${reason}`,
    state.automation?.runnerInvocation ?? "manual",
  );
  state.advanceHistory = [
    ...(state.advanceHistory ?? []),
    {
      atIso: rfc3339UtcMs(now),
      kind: "reopen",
      from: previousStage,
      to: targetStage,
      event: "operator_reopen",
      artifact: closure.runDirRel,
      reason,
    },
  ];
  await persistStateAndPrompts(repoRoot, state, pipeline, "repair");
  if (inboxRestored) {
    await patchFeatureIndexReopenedInbox(
      repoRoot,
      state.featureId,
      closure.inboxSourceRel,
    );
    await applyActiveMemoryRefreshOnReopen(repoRoot, {
      activeInboxSourceRel: closure.inboxSourceRel,
      clock: input.clock,
    });
  }

  return {
    command: "reopen",
    status: "ok",
    taskId,
    featureId: state.featureId,
    previousStage,
    currentStage: state.currentStage,
    pipelineStatus: "reopened",
    runDir: state.artifacts.runDir,
    stateFile: state.artifacts.stateFile,
    handoffFile: state.artifacts.handoffFile,
    nextPromptFile: requireNextPromptFile(state),
    nextPersona: personaForStage(pipeline, state.currentStage),
    nextHumanAction: state.nextHumanAction,
    reason,
  };
}

function rewriteActiveWorkArtifactPaths(
  state: FeatureDeliveryState,
  activeRunDirRel: string,
): void {
  state.artifacts = {
    runDir: activeRunDirRel,
    stateFile: path.posix.join(activeRunDirRel, "state.json"),
    handoffFile: path.posix.join(activeRunDirRel, "handoff.md"),
    runLogFile: path.posix.join(activeRunDirRel, "run.log.jsonl"),
    nextPromptFile: path.posix.join(activeRunDirRel, "next-prompt.md"),
    operatorVerificationFile: path.posix.join(
      activeRunDirRel,
      OPERATOR_VERIFICATION_FILENAME,
    ),
  };
}

/**
 * Accepts nested `lib/inbox/in/`-relative POSIX paths after inbox convention migration.
 * @param {string} value
 * @param {string} label
 */
function assertInboxInRelativePath(value: string, label: string): string {
  let norm = value.replace(/\\/gu, "/").replace(/^\/+/, "");
  if (norm === "" || norm.includes("\0")) {
    throw new Error(`${label} MUST be a non-empty relative path.`);
  }
  const inboxPrefix = "lib/inbox/in/";
  if (norm.startsWith(inboxPrefix)) {
    norm = norm.slice(inboxPrefix.length);
  }
  const segments = norm.split("/").filter(Boolean);
  for (const s of segments) {
    if (s === ".." || s === ".") {
      throw new Error(`${label} MUST NOT contain dot segments.`);
    }
  }
  if (segments.length === 0) {
    throw new Error(`${label} MUST resolve to a path under lib/inbox/in/.`);
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
    throw new Error(
      "feature id MUST contain at least one alphanumeric character.",
    );
  }
  return slug;
}

function sanitizeTaskId(raw: string): string {
  const taskId = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  if (!TASK_ID_PATTERN.test(taskId)) {
    throw new Error("task id MUST match <seconds-to-midnight>_<HHMM>_<slug>.");
  }
  return taskId;
}

async function suggestTaskIdFromSlug(
  repoRoot: string,
  rawTaskId: string,
): Promise<string | null> {
  const slug = taskIdSlugCandidate(rawTaskId);
  if (slug === null) {
    return null;
  }
  const roots = [
    resolveProjectPath(repoRoot, ".pan/work"),
    resolveProjectPath(repoRoot, ".pan/archive", "work"),
  ];
  const suffix = `_${slug}`;
  const matches: Array<{ taskId: string; mtimeMs: number }> = [];
  for (const root of roots) {
    const dayDirs = await safeReaddir(root);
    for (const dayDir of dayDirs) {
      const dayAbs = path.join(root, dayDir);
      let dayInfo;
      try {
        dayInfo = await stat(dayAbs);
      } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (err.code === "ENOENT" || err.code === "ENOTDIR") {
          continue;
        }
        throw error;
      }
      if (!dayInfo.isDirectory()) {
        continue;
      }
      const taskDirs = await safeReaddir(dayAbs);
      for (const taskDir of taskDirs) {
        if (!TASK_ID_PATTERN.test(taskDir) || !taskDir.endsWith(suffix)) {
          continue;
        }
        const stateAbs = path.join(dayAbs, taskDir, "state.json");
        try {
          const stateInfo = await stat(stateAbs);
          if (!stateInfo.isFile()) {
            continue;
          }
          matches.push({ taskId: taskDir, mtimeMs: stateInfo.mtimeMs });
        } catch (error) {
          const err = error as NodeJS.ErrnoException;
          if (err.code === "ENOENT" || err.code === "ENOTDIR") {
            continue;
          }
          throw error;
        }
      }
    }
  }
  if (matches.length === 0) {
    return null;
  }
  matches.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return matches[0]?.taskId ?? null;
}

function taskIdSlugCandidate(rawTaskId: string): string | null {
  const normalized = rawTaskId
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  if (normalized.length === 0) {
    return null;
  }
  const segments = normalized.split("_").filter((part) => part.length > 0);
  if (segments.length < 2) {
    return null;
  }
  const slug =
    segments.length >= 3
      ? segments.slice(2).join("_")
      : segments.slice(1).join("_");
  if (!/^[a-z0-9][a-z0-9_-]*$/u.test(slug)) {
    return null;
  }
  return slug;
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
  const secondsToMidnight = Math.max(
    0,
    Math.floor((nextDayStart - now.getTime()) / 1000),
  );
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const mm = String(now.getUTCMinutes()).padStart(2, "0");
  return `${secondsToMidnight}_${hh}${mm}_${featureId}`;
}

function pipelineIncludesStage(
  pipeline: PipelineDefinition | undefined,
  stageId: string,
): boolean {
  return pipeline?.stages.some((stage) => stage.id === stageId) ?? true;
}

function stateIncludesStage(
  state: FeatureDeliveryState,
  stageId: string,
): boolean {
  return state.stages.some((stage) => stage.id === stageId);
}

function buildStageStates(
  pipeline: PipelineDefinition,
  invocation: "manual" | "sdk" = "manual",
): FeatureDeliveryStageState[] {
  return pipeline.stages.map((stage, index) => ({
    id: stage.id,
    ...(stage.persona !== undefined ? { persona: stage.persona } : {}),
    ...(stage.label !== undefined ? { label: stage.label } : {}),
    status: index === 0 ? "ready" : "pending",
    ...stageGate(stage, invocation),
  }));
}

const SPOT_FIX_COMPLEXITY_BAR_SUMMARY =
  "Spot-fix bar: already diagnosable, intended behavior clear, bounded to one module or tightly coupled area, no more than 3 core implementation files plus directly related tests/artifacts, and no redesign or re-planning.";
const SPOT_FIX_JUSTIFICATION_FIELDS =
  "Spot-fix justification (required for *_spot_fix): spot_fixable: true, spot_fix_scope: artifact-only|code-bounded, spot_fix_owner, spot_fix_paths (comma-separated, max 3), spot_fix_rationale.";

function stageGate(
  stage: PipelineStage,
  invocation: "manual" | "sdk",
): Pick<FeatureDeliveryStageState, "humanGate" | "humanAttention"> {
  if (invocation === "sdk") {
    switch (stage.id) {
      case "plan":
      case "bookkeeping":
      case "report":
      case "ship":
      case "index":
        return {
          humanGate: "agent_ratification",
          humanAttention:
            "The handing-off persona validates stage artifacts before the runtime advances.",
        };
      case "implement":
        return {
          humanGate: "operator_intervention_available",
          humanAttention:
            "Use pan pause/resume/abort if implementation drifts; SDK auto-advances when artifacts pass validation.",
        };
      case "review":
        return {
          humanGate: "agent_ratifies_review_outcome",
          humanAttention:
            "Reviewer validates review.md; qualifying bounded issues may stay in review via spot-fix, otherwise the run returns to implement.",
        };
      case "test":
        return {
          humanGate: "agent_ratifies_qa_outcome",
          humanAttention:
            "QA validates test-report.md; only qualifying bounded issues may stay in test via spot-fix, otherwise route to implement or plan.",
        };
      case "compliance":
        return {
          humanGate: "agent_ratifies_compliance_outcome",
          humanAttention:
            "Compliance-auditor validates compliance-result.json; only qualifying bounded drift may stay in compliance via spot-fix, otherwise route to implement or plan.",
        };
      default:
        return {};
    }
  }
  switch (stage.id) {
    case "plan":
      return {
        humanGate: "human_approval",
        humanAttention:
          "Ratify product, design, and technical plans, acceptance criteria, manual QA cases, ADR draft, touch-set, and handoff before execution.",
      };
    case "implement":
      return {
        humanGate: "operator_intervention_available",
        humanAttention:
          "Use pan pause/resume/abort if implementation drifts, loops, or exceeds scope.",
      };
    case "review":
      return {
        humanGate: "review_passes_or_reenter_implement",
        humanAttention:
          "Inspect review.md; only qualifying bounded issues may stay in review via spot-fix, otherwise send the run back to implement.",
      };
    case "test":
      return {
        humanGate: "qa_passes_or_reenter_implement",
        humanAttention:
          "Inspect test-report.md; only qualifying bounded issues may stay in test via spot-fix, otherwise send the run back to implement or plan.",
      };
    case "bookkeeping":
      return {
        humanGate: "bookkeeping_complete",
        humanAttention:
          "Inspect closeout artifacts; when delivery report and feature index are ready, advance to complete.",
      };
    case "compliance":
      return {
        humanGate: "compliance_passes_or_reenter_implement",
        humanAttention:
          "Inspect compliance-result.json and the final validation bundle; route only qualifying bounded drift to spot-fix and send all broader findings to implement or plan.",
      };
    case "ship":
      return {
        humanGate: "local_stage_only",
        humanAttention:
          "Review the local diff and delivery report; no agent may push or open the PR unaudited.",
      };
    case "index":
      return {
        humanGate: "archive_and_index_audit",
        humanAttention:
          "Verify feature index artifacts; after index is accepted, the generated complete-stage prompt gives the human operator exact archival closure commands.",
      };
    default:
      return {};
  }
}

function featureDeliveryTransitions(
  pipeline?: PipelineDefinition,
): FeatureDeliveryTransition[] {
  const includeBookkeeping = pipelineIncludesStage(pipeline, "bookkeeping");
  if (includeBookkeeping) {
    return [
      {
        from: "created",
        on: "invoke",
        to: "plan",
        humanAttention:
          "Operator delegates product, design, and technical planning prompts.",
      },
      {
        from: "plan",
        on: "sdk_artifact_validation",
        to: "implement",
        humanAttention: "Plan and touch-set are validated before coder starts.",
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
        humanAttention:
          "Use pan pause <task-id> to stop at the next safe boundary.",
      },
      {
        from: "paused",
        on: "resume",
        to: "implement",
        humanAttention: "Use pan resume <task-id> after resolving the blocker.",
      },
      {
        from: "implement",
        on: "abort",
        to: "aborted",
        humanAttention:
          "Use pan abort <task-id> --reason <text> for failed or superseded runs.",
      },
      {
        from: "implement",
        on: "implementation_complete",
        to: "review",
        humanAttention:
          "Reviewer receives only the handoff, touch-set, diff, and validation output.",
      },
      {
        from: "review",
        on: "must_fix",
        to: "implement",
        humanAttention: "Bounded re-entry; high findings block shipping.",
      },
      {
        from: "review",
        on: "review_core_reentry",
        to: "plan",
        humanAttention:
          "Touch-set or plan invalidation routes back to tech-lead before implementation continues.",
      },
      {
        from: "review",
        on: "review_spot_fix",
        to: "review",
        humanAttention:
          "Only issues that satisfy the spot-fix complexity bar may stay in review; rerun review after the bounded remediation.",
      },
      {
        from: "review",
        on: "review_passes",
        to: "test",
        humanAttention:
          "Human should still inspect review output before qa-tester runs.",
      },
      {
        from: "review",
        on: "repo_wide_blocker",
        to: "review",
        humanAttention:
          "Repo-wide blocker outside touch-set recorded for visibility; stage remains active.",
      },
      {
        from: "test",
        on: "qa_passes",
        to: "bookkeeping",
        humanAttention:
          "Human should inspect test-report.md before bookkeeping.",
      },
      {
        from: "test",
        on: "qa_design_followup",
        to: "bookkeeping",
        humanAttention:
          "Design follow-up recorded without implement re-entry; continue to bookkeeping.",
      },
      {
        from: "test",
        on: "repo_wide_blocker",
        to: "test",
        humanAttention:
          "Repo-wide blocker outside touch-set recorded for visibility; stage remains active.",
      },
      {
        from: "test",
        on: "qa_fails",
        to: "implement",
        humanAttention: "Bounded re-entry; qa failures block shipping.",
      },
      {
        from: "test",
        on: "qa_spot_fix",
        to: "test",
        humanAttention:
          "Only issues that satisfy the spot-fix complexity bar may stay in test; rerun QA after the bounded remediation.",
      },
      {
        from: "test",
        on: "qa_fails_plan_invalidating",
        to: "plan",
        humanAttention:
          "Plan-invalidating QA failure; re-plan before re-implementing.",
      },
      {
        from: "bookkeeping",
        on: "repo_wide_blocker",
        to: "bookkeeping",
        humanAttention:
          "Repo-wide blocker outside active delta recorded for visibility; stage remains active.",
      },
      {
        from: "bookkeeping",
        on: "bookkeeping_complete",
        to: "complete",
        humanAttention: "Confirm closeout artifacts and final operator steps.",
      },
    ];
  }

  const includeCompliance = pipelineIncludesStage(pipeline, "compliance");
  const transitions: FeatureDeliveryTransition[] = [
    {
      from: "created",
      on: "invoke",
      to: "plan",
      humanAttention:
        "Operator delegates product, design, and technical planning prompts.",
    },
    {
      from: "plan",
      on: "human_approval",
      to: "implement",
      humanAttention: "Plan and touch-set are ratified before coder starts.",
    },
    {
      from: "plan",
      on: "sdk_artifact_validation",
      to: "implement",
      humanAttention: "Plan and touch-set are validated before coder starts.",
    },
    {
      from: "implement",
      on: "pause",
      to: "paused",
      humanAttention:
        "Use pan pause <task-id> to stop at the next safe boundary.",
    },
    {
      from: "paused",
      on: "resume",
      to: "implement",
      humanAttention: "Use pan resume <task-id> after resolving the blocker.",
    },
    {
      from: "implement",
      on: "abort",
      to: "aborted",
      humanAttention:
        "Use pan abort <task-id> --reason <text> for failed or superseded runs.",
    },
    {
      from: "implement",
      on: "implementation_complete",
      to: "review",
      humanAttention:
        "Reviewer receives only the handoff, touch-set, diff, and validation output.",
    },
    {
      from: "review",
      on: "must_fix",
      to: "implement",
      humanAttention: "Bounded re-entry; high findings block shipping.",
    },
    {
      from: "review",
      on: "review_core_reentry",
      to: "plan",
      humanAttention:
        "Touch-set or plan invalidation routes back to tech-lead before implementation continues.",
    },
    {
      from: "review",
      on: "review_spot_fix",
      to: "review",
      humanAttention:
        "Only issues that satisfy the spot-fix complexity bar may stay in review; rerun review after the bounded remediation.",
    },
    {
      from: "review",
      on: "review_passes",
      to: "test",
      humanAttention:
        "Human should still inspect review output before qa-tester runs.",
    },
    {
      from: "test",
      on: "qa_passes",
      to: "report",
      humanAttention:
        "Human should inspect test-report.md before report/compliance.",
    },
    {
      from: "test",
      on: "qa_design_followup",
      to: "report",
      humanAttention:
        "Design follow-up recorded without implement re-entry; continue to report.",
    },
    {
      from: "test",
      on: "repo_wide_blocker",
      to: "test",
      humanAttention:
        "Repo-wide blocker outside touch-set recorded; resolve before advancing.",
    },
    {
      from: "review",
      on: "repo_wide_blocker",
      to: "review",
      humanAttention:
        "Repo-wide blocker outside touch-set recorded; resolve before advancing.",
    },
    {
      from: "report",
      on: "repo_wide_blocker",
      to: "report",
      humanAttention:
        "Repo-wide blocker outside touch-set recorded; resolve before advancing.",
    },
    {
      from: "compliance",
      on: "repo_wide_blocker",
      to: "compliance",
      humanAttention:
        "Repo-wide blocker outside touch-set recorded; resolve before advancing.",
    },
    {
      from: "test",
      on: "qa_fails",
      to: "implement",
      humanAttention: "Bounded re-entry; qa failures block shipping.",
    },
    {
      from: "test",
      on: "qa_spot_fix",
      to: "test",
      humanAttention:
        "Only issues that satisfy the spot-fix complexity bar may stay in test; rerun QA after the bounded remediation.",
    },
    {
      from: "test",
      on: "qa_fails_plan_invalidating",
      to: "plan",
      humanAttention:
        "Plan-invalidating QA failure; re-plan before re-implementing.",
    },
    {
      from: "report",
      on: "report_ready",
      to: "compliance",
      humanAttention:
        "Delivery report must be useful to the operator, not just a changelog.",
    },
    {
      from: "compliance",
      on: "compliance_passes",
      to: "ship",
      humanAttention:
        "Compliance gate is green; continue to ship ratification.",
    },
    {
      from: "compliance",
      on: "compliance_spot_fix",
      to: "compliance",
      humanAttention:
        "Only issues that satisfy the spot-fix complexity bar may stay in compliance; rerun the gate after the bounded remediation.",
    },
    {
      from: "compliance",
      on: "compliance_fails",
      to: "implement",
      humanAttention: "Major compliance failure routes back to implementation.",
    },
    {
      from: "compliance",
      on: "compliance_fails_plan_invalidating",
      to: "plan",
      humanAttention:
        "Plan-invalidating compliance issue routes back to planning.",
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
      humanAttention: "Confirm .pan/archive/index state and outbox report.",
    },
  ];
  if (includeCompliance) {
    return transitions;
  }
  return transitions
    .filter(
      (transition) =>
        transition.from !== "compliance" && transition.to !== "compliance",
    )
    .map((transition) => {
      if (transition.from === "report" && transition.on === "report_ready") {
        return {
          ...transition,
          to: "ship",
          humanAttention:
            "Delivery report ratified; continue to ship ratification.",
        };
      }
      if (transition.from === "test" && transition.on === "qa_passes") {
        return {
          ...transition,
          humanAttention:
            "Human should inspect test-report.md before report and ship.",
        };
      }
      return transition;
    });
}

export const renderTransitions = featureDeliveryTransitions;

export function normalizeClientWorkspaceTestCommand(
  command: string,
  workingDirectory?: string,
): string {
  const wd = (workingDirectory ?? "").replace(/\\/gu, "/").replace(/^\.\//u, "");
  const isClientWorkspace = wd === "pancreator/client" || wd === "client";
  if (!isClientWorkspace) {
    return command;
  }
  return command.replace(/\bclient\/src\//gu, "src/");
}

export function normalizeTouchSetTestCommands(
  tests: ReadonlyArray<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return tests.map((entry) => {
    const command = typeof entry.command === "string" ? entry.command : "";
    const workingDirectory =
      typeof entry.working_directory === "string" ? entry.working_directory : undefined;
    return {
      ...entry,
      command: normalizeClientWorkspaceTestCommand(command, workingDirectory),
    };
  });
}

function renderHandoffValidationCommands(repoRoot: string, runDir: string): string {
  const touchSetRel = path.posix.join(runDir, "touch-set.json");
  const touchSetAbs = resolveRepoPath(repoRoot, touchSetRel);
  if (!existsSync(touchSetAbs)) {
    return `- node --test tests/*.test.mjs
- node lib/internal/tools/checks/check-workspace-contracts.mjs
- node lib/internal/tools/context/context-budget-report.mjs`;
  }
  try {
    const parsed = JSON.parse(readFileSync(touchSetAbs, "utf8")) as {
      tests?: Array<Record<string, unknown>>;
    };
    const tests = Array.isArray(parsed.tests) ? normalizeTouchSetTestCommands(parsed.tests) : [];
    if (tests.length === 0) {
      return `- node --test tests/*.test.mjs
- node lib/internal/tools/checks/check-workspace-contracts.mjs
- node lib/internal/tools/context/context-budget-report.mjs`;
    }
    return tests
      .map((entry) => {
        const command = typeof entry.command === "string" ? entry.command : "";
        const wd =
          typeof entry.working_directory === "string"
            ? ` (cwd: ${entry.working_directory})`
            : "";
        return `- ${command}${wd}`;
      })
      .join("\n");
  } catch {
    return `- node --test tests/*.test.mjs
- node lib/internal/tools/checks/check-workspace-contracts.mjs
- node lib/internal/tools/context/context-budget-report.mjs`;
  }
}

function renderHandoff(
  repoRoot: string,
  state: FeatureDeliveryState,
  pipeline: PipelineDefinition,
  directive?: string,
): string {
  const nextPersona = personaForStage(pipeline, state.currentStage) ?? "human";
  const stage = state.currentStage;
  const sdkMode = state.automation?.runnerInvocation === "sdk";
  const excerpt = directive?.trim().split(/\r?\n/u).slice(0, 20).join("\n");
  const handoffOutputManifest = [
    "## Output manifest",
    "",
    "- persona_contract: PERSONA.SUPERVISOR",
    "- stage_contract: PIPE.FEATURE_DELIVERY",
    "- required_docs: DOC.OUTPUT_MANIFEST",
    "- consulted_docs: DOC.OUTPUT_MANIFEST",
    `- produced_artifacts: ${state.artifacts.handoffFile}, ${requireNextPromptFile(state)}`,
    "- scope_amendments: none",
    "- validation: handoff_sections_present",
    "- definition_of_done: pass",
    "- gate_decision: advance",
    "- remediation_route: supervisor",
  ].join("\n");
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

${stageContractMarkdown(repoRoot, state, stage)}

## In-scope paths

- ${state.source.inboxPath}
- ${state.artifacts.runDir}/spec.md (when present)
- ${productPlanRel(state.artifacts.runDir)}
- ${productAcceptanceCriteriaRel(state.artifacts.runDir)}
- ${designPlanRel(state.artifacts.runDir)}
- ${designAcceptanceCriteriaRel(state.artifacts.runDir)}
- ${uxSpecRel(state.artifacts.runDir)}
- ${techPlanRel(state.artifacts.runDir)}
- ${techAcceptanceCriteriaRel(state.artifacts.runDir)}
- ${manualQaTestCasesRel(state.artifacts.runDir)}
- ${state.artifacts.runDir}/plan.md
- ${state.artifacts.runDir}/adr-draft.md
- ${state.artifacts.runDir}/touch-set.json
- ${state.artifacts.runDir}/implementation-report.md
- ${state.artifacts.runDir}/review.md
- ${state.artifacts.runDir}/test-report.md
- ${deliveryReportRel(state.artifacts.runDir)}
- ${state.artifacts.runDir}/compliance-result.json
- ${state.artifacts.runDir}/ship-ratification.json
- ${state.artifacts.runDir}/${PIPELINE_CLOSE_FILENAME}
- ${state.artifacts.runDir}/${OPERATOR_VERIFICATION_FILENAME}
- lib/inbox/out/<timestamp>-${state.featureId}-delivery-report.md

## Explicit non-goals

- Do not read or write lib/inbox/notes/.
- ${
    sdkMode
      ? "Validate stage artifacts before handoff; SDK mode auto-advances when validation passes."
      : "Do not continue past a human gate without explicit ratification."
  }
- Do not push, open a PR, or commit without the human operator.
- Do not carry planning context into implementation; use the stage prompt and named stage inputs.

## Validation commands

${renderHandoffValidationCommands(repoRoot, state.artifacts.runDir)}

${handoffOutputManifest}
## Re-entry rule

If scope changes, validation repeatedly fails, or the touch-set is incomplete, stop and delegate back to supervisor, tech-lead, or reviewer instead of extending the executor loop.
${
  excerpt === undefined || excerpt.length === 0
    ? ""
    : `
## Directive excerpt

\`\`\`markdown
${excerpt}
\`\`\`
`
}`;
}

function stageGovernancePaths(stage: string): string[] {
  const core = [
    "lib/memory/handbook/agent-document-registry.md",
    "lib/memory/handbook/persona-contracts.md",
    "lib/memory/handbook/output-manifest-contract.md",
    "lib/memory/handbook/pipeline-state-contract.md",
    "lib/pipelines/feature-delivery.yaml",
  ];
  switch (stage) {
    case "plan":
      return [
        ...core,
        "lib/memory/handbook/engineering/software-engineering.md",
        "lib/memory/handbook/engineering/typescript.md",
      ];
    case "implement":
    case "review":
      return [
        ...core,
        "lib/memory/handbook/engineering/software-engineering.md",
        "lib/memory/handbook/engineering/typescript.md",
        "lib/memory/handbook/compliance-runs.md",
      ];
    case "test":
      return [
        ...core,
        "lib/memory/handbook/engineering/software-engineering.md",
        "lib/memory/handbook/engineering/typescript.md",
        "lib/memory/handbook/engineering/design-craft.md",
        "lib/memory/handbook/compliance-runs.md",
      ];
    case "report":
      return [
        ...core,
        "lib/memory/handbook/operator-output-contract.md",
        "lib/memory/handbook/run-log-schema.md",
      ];
    case "compliance":
      return [
        ...core,
        "lib/memory/handbook/compliance-runs.md",
        "lib/memory/handbook/run-log-schema.md",
      ];
    case "ship":
      return [...core, "lib/memory/handbook/operator-output-contract.md"];
    case "index":
    case "complete":
      return [
        ...core,
        "lib/memory/handbook/operator-output-contract.md",
        "lib/memory/handbook/run-log-schema.md",
        "lib/memory/handbook/memory-tiers.md",
      ];
    default:
      return [...core, "lib/memory/handbook/index.md"];
  }
}

function renderGovernancePathList(stage: string): string {
  return stageGovernancePaths(stage)
    .map((p) => `- ${p}`)
    .join("\n");
}

function renderStaticContractStagePrompt(stage: string): string {
  const manifestEvidence =
    stage === "compliance" || stage === "ship"
      ? "JSON artifacts MUST include top-level `output_manifest` per DOC.OUTPUT_MANIFEST."
      : "Markdown artifacts MUST include `## Output manifest` per DOC.OUTPUT_MANIFEST.";
  return `Static contract requirement:
- Follow the owning persona spec's \`## Static execution contract\` and the ${stage} stage contract in \`lib/pipelines/feature-delivery.yaml\`, but treat repo-wide rules in \`AGENTS.md\` as authoritative when they conflict with persona-local wording.
- Resolve required \`DOC.*\`, \`PIPE.*\`, and \`PERSONA.*\` keys through \`lib/memory/handbook/agent-document-registry.md\`.
- Load the docs named by the persona and stage contracts before producing artifacts.
- ${manifestEvidence}
- Do not invent an ad-hoc execution contract or treat a path list as compliance.`;
}

function renderNextPrompt(
  repoRoot: string,
  state: FeatureDeliveryState,
  pipeline: PipelineDefinition,
): string {
  if (state.currentStage === TERMINAL_STAGE && state.status === "closed") {
    return renderClosedPrompt(state);
  }
  const persona = personaForStage(pipeline, state.currentStage) ?? "human";
  const stage = state.currentStage;
  const sdkMode = state.automation?.runnerInvocation === "sdk";
  const designCompanionNote =
    stage === "plan"
      ? `
Manual mode: delegate \`/product-engineer\` with \`${productPlanPromptRel(state.artifacts.runDir)}\`, delegate \`/design-engineer\` with \`${designPlanPromptRel(state.artifacts.runDir)}\`, then delegate \`${persona}\` with this prompt for technical consolidation.
`
      : stage === "test"
        ? `
Manual mode: delegate \`/qa-tester\` with this prompt AND \`/design-reviewer\` with \`${designQaPromptRel(state.artifacts.runDir)}\` in parallel. The test gate requires both \`qa_passes\` and \`design_qa_passes\`.
`
        : "";
  return `You are executing the ${stage} stage for feature-delivery task ${state.taskId}.

Use subagent/persona: ${persona}
${designCompanionNote}
Read first, in this order:
1. lib/personas/${persona}.md
2. AGENTS.md
3. lib/memory/handbook/agent-document-registry.md
4. lib/memory/handbook/persona-contracts.md
5. lib/memory/handbook/output-manifest-contract.md
6. lib/memory/handbook/pipeline-state-contract.md
7. ${state.artifacts.handoffFile}
8. Relevant governance paths listed below
9. The stage input paths listed below

When AGENTS.md conflicts with persona-local wording in the persona spec, generated projection, or bounded prompt, follow AGENTS.md.

Relevant governance paths for this stage:
${renderGovernancePathList(stage)}

Do not read broad archives, full PRD/bootstrap docs, lib/inbox/notes/**, or unrelated .pan/work/** paths unless AGENTS.md, the handoff, or a stage-specific governance path explicitly requires it.

${renderStaticContractStagePrompt(stage)}

${stageContractMarkdown(repoRoot, state, stage)}

${
  sdkMode
    ? "Validate required stage artifacts before finishing. SDK mode ratifies on your behalf and auto-advances when validation passes; do not run pan advance manually in the same loop."
    : "After the stage artifact is accepted by the human operator, run exactly one matching state command from the handoff instructions. Do not continue to the next persona in the same agent loop."
}
`;
}

function stageContractMarkdown(
  repoRoot: string,
  state: FeatureDeliveryState,
  stage: string,
): string {
  const lintGateLine = `Lint gate (mandatory before handoff): run \`pnpm -w exec pan artifacts lint ${state.taskId} --stage ${stage}\` and proceed only when the command reports \`status: "ok"\` with \`warningCount: 0\`.`;
  const advanceLine = (forStage: string, event?: string): string => {
    if (forStage !== state.currentStage) {
      return staticAdvanceLineForStage(state, forStage, event);
    }
    const step = resolveNextStep(state, { stage: forStage, event, repoRoot });
    if (step.nextCommand !== null) {
      return step.nextCommand;
    }
    return (
      step.reason ??
      "No advance command is available for the current ledger state."
    );
  };

  switch (stage) {
    case "plan":
      return `Input: ${state.source.inboxPath}
Product companion: ${productPlanPromptRel(state.artifacts.runDir)} → ${productPlanRel(state.artifacts.runDir)} + ${productAcceptanceCriteriaRel(state.artifacts.runDir)}
Design companion: ${designPlanPromptRel(state.artifacts.runDir)} → ${designPlanRel(state.artifacts.runDir)} + ${designAcceptanceCriteriaRel(state.artifacts.runDir)} + ${uxSpecRel(state.artifacts.runDir)}
Outputs: ${productPlanRel(state.artifacts.runDir)}, ${productAcceptanceCriteriaRel(state.artifacts.runDir)}, ${designPlanRel(state.artifacts.runDir)}, ${designAcceptanceCriteriaRel(state.artifacts.runDir)}, ${uxSpecRel(state.artifacts.runDir)}, ${techPlanRel(state.artifacts.runDir)}, ${techAcceptanceCriteriaRel(state.artifacts.runDir)}, ${manualQaTestCasesRel(state.artifacts.runDir)}, ${state.artifacts.runDir}/plan.md, ${state.artifacts.runDir}/adr-draft.md, ${state.artifacts.runDir}/touch-set.json, ${state.artifacts.handoffFile}
Plan gate: plan.md MUST include ## Acceptance criteria and ## Shared-layer impact; touch-set.json MUST include paths, tests, shared_paths, integration_prerequisites, acceptance_criteria, manual_qa_test_cases; handoff.md MUST include ## Validation commands and ## Output manifest.
${lintGateLine}
Advance after ${
        state.automation?.runnerInvocation === "sdk"
          ? "agent validates product/design/tech plan artifacts"
          : "human ratification"
      }: ${advanceLine("plan")}`;
    case "implement": {
      const base = `Inputs: ${state.artifacts.handoffFile}, ${state.artifacts.runDir}/touch-set.json, ${productPlanRel(state.artifacts.runDir)}, ${productAcceptanceCriteriaRel(state.artifacts.runDir)}, ${designPlanRel(state.artifacts.runDir)}, ${designAcceptanceCriteriaRel(state.artifacts.runDir)}, ${techPlanRel(state.artifacts.runDir)}, ${techAcceptanceCriteriaRel(state.artifacts.runDir)}, ${manualQaTestCasesRel(state.artifacts.runDir)}\nOutput: ${state.artifacts.runDir}/implementation-report.md\nImplement gate: set implement_gate_passes: true only after lint, typecheck, tests, coverage thresholds, applicable compliance checks, and every product/design/technical acceptance criterion pass.\n${lintGateLine}\nAdvance after implementation is accepted: ${advanceLine("implement")}`;
      const reentry = resolveImplementMustFixReentry(state, repoRoot);
      if (reentry !== null) {
        return `${base}\nAfter must_fix fixes, when ${state.artifacts.runDir}/review.md already records review_passes: true, chain to test in one step: ${reentry.nextCommand}`;
      }
      return base;
    }
    case "review":
      return `Inputs: ${state.artifacts.handoffFile}, ${state.artifacts.runDir}/touch-set.json, ${state.artifacts.runDir}/implementation-report.md, current local diff\nOutput: ${state.artifacts.runDir}/review.md\nVerdict fields: review_passes, touch_set_tests_pass, lint_typecheck_rerun_required, core_reentry_required, scope_amendments_ratified, and when applicable spot_fixable and excluded_from_gate\nReview gate: verify every product, design, and technical acceptance criterion before review_passes: true; run every touch-set.json tests command before review_passes: true; record full-repository pnpm test and node --test tests/*.test.mjs as excluded-from-gate visibility only; ratify bounded scope amendments before review_passes: true; rerun pnpm lint and pnpm typecheck only when review-stage remediation changed code.\n${lintGateLine}\nShared-layer rule: edits under touch-set.json shared_paths are allowed; undeclared shared-layer edits route to plan. Amendments are allowed only when touch-set.json and implementation-report.md record the same bounded scope amendment.\n${SPOT_FIX_COMPLEXITY_BAR_SUMMARY}\n${SPOT_FIX_JUSTIFICATION_FIELDS}\nReview spot-fix is artifact-only (spot_fix_scope: artifact-only).\nAdvance on pass: ${advanceLine("review", "review_passes")}\nQualifying spot-fix (stay in review): pnpm -w exec pan advance ${state.taskId} --event review_spot_fix --artifact ${state.artifacts.runDir}/review.md\nTouch-set or plan invalidation (return to plan): pnpm -w exec pan advance ${state.taskId} --event review_core_reentry --artifact ${state.artifacts.runDir}/review.md\nNon-qualifying issue (return to implement): pnpm -w exec pan advance ${state.taskId} --event must_fix --artifact ${state.artifacts.runDir}/review.md`;
    case "test":
      return designStepsEnabled(state.options)
        ? `Inputs: ${state.artifacts.runDir}/review.md, ${state.artifacts.runDir}/touch-set.json, ${manualQaTestCasesRel(state.artifacts.runDir)}, ${uxSpecRel(state.artifacts.runDir)}, current local diff, validation output\nOutputs: ${state.artifacts.runDir}/test-report.md and ${path.posix.join(state.artifacts.runDir, "design-qa-report.md")}\nParallel companions: qa-tester exercises manual QA cases (${state.artifacts.runDir}/next-prompt.md) + design-reviewer checks global UI/UX/design rules (${designQaPromptRel(state.artifacts.runDir)})\nVerdict fields: qa_passes, plan_invalidating, and when applicable core_reentry_required and spot_fixable\n${SPOT_FIX_COMPLEXITY_BAR_SUMMARY}\n${SPOT_FIX_JUSTIFICATION_FIELDS}\n${lintGateLine}\nAdvance on pass (both qa_passes and design_qa_passes): ${advanceLine("test", "qa_passes")}\nDesign-only follow-up without implement re-entry: pnpm -w exec pan advance ${state.taskId} --event qa_design_followup --artifact ${state.artifacts.runDir}/test-report.md\nRepo-wide blocker outside touch-set: pnpm -w exec pan advance ${state.taskId} --event repo_wide_blocker --artifact ${state.artifacts.runDir}/test-report.md\nQualifying spot-fix (stay in test): pnpm -w exec pan advance ${state.taskId} --event qa_spot_fix --artifact ${state.artifacts.runDir}/test-report.md\nNon-qualifying issue (return to implement): pnpm -w exec pan advance ${state.taskId} --event qa_fails --artifact ${state.artifacts.runDir}/test-report.md\nPlan-invalidating issue (return to plan): pnpm -w exec pan advance ${state.taskId} --event qa_fails_plan_invalidating --artifact ${state.artifacts.runDir}/test-report.md`
        : `Inputs: ${state.artifacts.runDir}/review.md, ${state.artifacts.runDir}/touch-set.json, ${manualQaTestCasesRel(state.artifacts.runDir)}, current local diff, validation output\nOutput: ${state.artifacts.runDir}/test-report.md\nVerdict fields: qa_passes, plan_invalidating, and when applicable core_reentry_required and spot_fixable\n${SPOT_FIX_COMPLEXITY_BAR_SUMMARY}\n${SPOT_FIX_JUSTIFICATION_FIELDS}\n${lintGateLine}\nAdvance on pass: ${advanceLine("test", "qa_passes")}\nDesign-only follow-up without implement re-entry: pnpm -w exec pan advance ${state.taskId} --event qa_design_followup --artifact ${state.artifacts.runDir}/test-report.md\nRepo-wide blocker outside touch-set: pnpm -w exec pan advance ${state.taskId} --event repo_wide_blocker --artifact ${state.artifacts.runDir}/test-report.md\nQualifying spot-fix (stay in test): pnpm -w exec pan advance ${state.taskId} --event qa_spot_fix --artifact ${state.artifacts.runDir}/test-report.md\nNon-qualifying issue (return to implement): pnpm -w exec pan advance ${state.taskId} --event qa_fails --artifact ${state.artifacts.runDir}/test-report.md\nPlan-invalidating issue (return to plan): pnpm -w exec pan advance ${state.taskId} --event qa_fails_plan_invalidating --artifact ${state.artifacts.runDir}/test-report.md`;
    case "bookkeeping":
      return `Inputs: ${state.artifacts.runDir}/implementation-report.md, ${state.artifacts.runDir}/review.md, ${state.artifacts.runDir}/test-report.md, current local diff\nOutputs: ${deliveryReportRel(state.artifacts.runDir)}, ${durableFeatureIndexRel(state.featureId)}, ${pipelineCloseRel(state)}, ${operatorVerificationRel(state)}\nCloseout rule: delivery-report.md MUST stay citation-backed and machine-readable; feature index MUST be refreshed before completion.\n${lintGateLine}\nRepo-wide blocker outside active delta (visibility-only hold): pnpm -w exec pan advance ${state.taskId} --event repo_wide_blocker --artifact ${deliveryReportRel(state.artifacts.runDir)}\nAdvance after closeout artifacts are ready: ${advanceLine("bookkeeping", "bookkeeping_complete")}`;
    case "report":
      return `Inputs: ${state.artifacts.runDir}/implementation-report.md, ${state.artifacts.runDir}/review.md, ${state.artifacts.runDir}/test-report.md\nOutput: ${deliveryReportRel(state.artifacts.runDir)}\nCitation rule: each claim MUST use fenced canonical JSON with double-quoted keys per lib/personas/tech-writer.md §Conformance gates; JS-literal {kind: lines, ...} form is forbidden.\n${lintGateLine}\nBefore advance, run: node --test tests/migrate-json-formatting.test.mjs\nAdvance after report is accepted: ${advanceLine("report")}`;
    case "compliance":
      return `Inputs: ${state.artifacts.runDir}/touch-set.json, ${state.artifacts.runDir}/review.md, ${state.artifacts.runDir}/test-report.md, ${deliveryReportRel(state.artifacts.runDir)}, local diff\nOutput: ${state.artifacts.runDir}/compliance-result.json\nVerdict fields: compliance_passes, plan_invalidating, core_reentry_required, spot_fixable, excluded_from_gate, and final_gate\nCompliance exit bundle (all MUST pass): ${complianceStageExitCommands().join(", ")}\n${complianceAuditFocusContract(repoRoot, state)}\n${SPOT_FIX_COMPLEXITY_BAR_SUMMARY}\n${SPOT_FIX_JUSTIFICATION_FIELDS}\n${lintGateLine}\nAdvance on pass: ${advanceLine("compliance", "compliance_passes")}\nQualifying spot-fix (stay in compliance): pnpm -w exec pan advance ${state.taskId} --event compliance_spot_fix --artifact ${state.artifacts.runDir}/compliance-result.json\nNon-qualifying issue (return to implement): pnpm -w exec pan advance ${state.taskId} --event compliance_fails --artifact ${state.artifacts.runDir}/compliance-result.json\nPlan-invalidating issue (return to plan): pnpm -w exec pan advance ${state.taskId} --event compliance_fails_plan_invalidating --artifact ${state.artifacts.runDir}/compliance-result.json`;
    case "ship": {
      const shipInputs = stateIncludesStage(state, "compliance")
        ? `local diff, ${state.artifacts.runDir}/compliance-result.json, ${deliveryReportRel(state.artifacts.runDir)}`
        : `local diff, ${state.artifacts.runDir}/test-report.md, ${deliveryReportRel(state.artifacts.runDir)}`;
      return `Inputs: ${shipInputs}\nOutput: ${state.artifacts.runDir}/ship-ratification.json (human_ratified_diff: true)\n${lintGateLine}\nAdvance only after human ratifies local diff: ${advanceLine("ship")}`;
    }
    case "index":
      return `Inputs: delivery report and accepted ship artifacts\nOutputs: ${durableFeatureIndexRel(state.featureId)}, ${pipelineCloseRel(state)}, ${operatorVerificationRel(state)}\nIndex rule: link active ${state.artifacts.runDir}/ paths (not .pan/archive/work/).\nPipeline close: summarize outcome, residual issues, and operator next steps in ${pipelineCloseRel(state)} before complete.\nOperator verification: finalize ${operatorVerificationRel(state)} with acceptance criteria and manual test flows before close-artifacts.\n${lintGateLine}\nDo NOT mv .pan/work/ to .pan/archive/work/; pnpm -w exec pan close-artifacts performs archival at complete.\nAdvance after artifacts are indexed: ${advanceLine("index")}`;
    case "complete":
      return state.status === "closed"
        ? closedContractMarkdown(state)
        : finalClosureContractMarkdown(state);
    default:
      return `No stage contract is defined for ${stage}.`;
  }
}

function complianceScopePathsForFeatureState(
  repoRoot: string,
  state: FeatureDeliveryState,
): string[] {
  const scopedPaths = touchSetScopePaths(repoRoot, state.artifacts.runDir);
  return [...new Set([
    path.posix.join(state.artifacts.runDir, "touch-set.json"),
    path.posix.join(state.artifacts.runDir, "implementation-report.md"),
    path.posix.join(state.artifacts.runDir, "review.md"),
    path.posix.join(state.artifacts.runDir, "test-report.md"),
    ...(designStepsEnabled(state.options)
      ? [designQaReportRel(state.artifacts.runDir)]
      : []),
    deliveryReportRel(state.artifacts.runDir),
    ...scopedPaths,
  ])];
}

function complianceAuditFocusContract(
  repoRoot: string,
  state: FeatureDeliveryState,
): string {
  const promptContext = complianceAuditPromptContext({
    repoRoot,
    defaultScopePaths: complianceScopePathsForFeatureState(repoRoot, state),
  });
  if (promptContext === null) {
    return "Saved audits: none yet (history will initialize on first persisted compliance result). Default baseline: none. Effective delta focus: current compliance scope.";
  }
  const available = promptContext.availableAuditIds;
  const baseline = promptContext.defaultBaselineAuditId ?? "none";
  const deltaPaths =
    promptContext.deltaSummary.changed_paths.length === 0
      ? "(no path-level changes detected against baseline snapshot)"
      : promptContext.deltaSummary.changed_paths.join(", ");
  const options = available.length === 0 ? "none" : available.join(", ");
  return `Saved audits (newest first, max ${COMPLIANCE_AUDIT_HISTORY_MAX}): ${options}\nDefault baseline audit: ${baseline}\nEffective delta path focus: ${deltaPaths}\nOptional selector: set baseline_audit_id in compliance-result.json to one saved audit id from the list above.`;
}

function staticAdvanceLineForStage(
  state: FeatureDeliveryState,
  stage: string,
  event?: string,
): string {
  const resolvedEvent = event ?? defaultEventForStage(stage);
  const contract = stageArtifactContract(state, stage, resolvedEvent);
  const cmd = `pnpm -w exec pan advance ${state.taskId} --artifact ${contract.primaryArtifact}`;
  if (stage === "review" && resolvedEvent === "must_fix") {
    return `pnpm -w exec pan advance ${state.taskId} --event must_fix --artifact ${contract.primaryArtifact}`;
  }
  if (stage === "review" && resolvedEvent === "review_spot_fix") {
    return `pnpm -w exec pan advance ${state.taskId} --event review_spot_fix --artifact ${contract.primaryArtifact}`;
  }
  if (stage === "review" && resolvedEvent === "review_core_reentry") {
    return `pnpm -w exec pan advance ${state.taskId} --event review_core_reentry --artifact ${contract.primaryArtifact}`;
  }
  if (
    stage === "test" &&
    (resolvedEvent === "qa_fails" ||
      resolvedEvent === "qa_fails_plan_invalidating" ||
      resolvedEvent === "qa_spot_fix" ||
      resolvedEvent === "qa_design_followup" ||
      resolvedEvent === "repo_wide_blocker")
  ) {
    return `pnpm -w exec pan advance ${state.taskId} --event ${resolvedEvent} --artifact ${contract.primaryArtifact}`;
  }
  if (
    stage === "compliance" &&
    (resolvedEvent === "compliance_fails" ||
      resolvedEvent === "compliance_fails_plan_invalidating" ||
      resolvedEvent === "compliance_spot_fix")
  ) {
    return `pnpm -w exec pan advance ${state.taskId} --event ${resolvedEvent} --artifact ${contract.primaryArtifact}`;
  }
  if (stage === "bookkeeping" && resolvedEvent === "repo_wide_blocker") {
    return `pnpm -w exec pan advance ${state.taskId} --event ${resolvedEvent} --artifact ${contract.primaryArtifact}`;
  }
  return cmd;
}

export function resolveNextStep(
  state: FeatureDeliveryState,
  options?: { stage?: string; event?: string; repoRoot?: string },
): NextStep {
  const stage = options?.stage ?? state.currentStage;

  if (state.nextCommand !== undefined && state.nextCommand.trim().length > 0) {
    const parsed = parsePersistedAdvanceCommand(state.nextCommand);
    return {
      event: parsed.event,
      artifact: parsed.artifact,
      nextCommand: state.nextCommand,
      source: "persisted",
    };
  }

  if (
    state.status === "halted" ||
    state.status === "closed" ||
    state.currentStage === "aborted" ||
    state.currentStage === TERMINAL_STAGE
  ) {
    return {
      event: null,
      artifact: null,
      nextCommand: null,
      source: "derived",
      reason: `pipeline is terminal (${state.status}, stage ${state.currentStage})`,
    };
  }

  const reentry = resolveImplementMustFixReentry(state, options?.repoRoot);
  if (reentry !== null && stage === "implement") {
    return reentry;
  }

  const event = options?.event ?? defaultEventForStage(stage);
  try {
    const contract = stageArtifactContract(state, stage, event);
    const nextCommand = buildAdvanceCommand(
      state.taskId,
      contract.primaryArtifact,
      stage,
      event,
    );
    return {
      event,
      artifact: contract.primaryArtifact,
      nextCommand,
      source: "derived",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      event: null,
      artifact: null,
      nextCommand: null,
      source: "derived",
      reason: message,
    };
  }
}

function parsePersistedAdvanceCommand(nextCommand: string): {
  event: string | null;
  artifact: string | null;
} {
  const eventMatch = /--event\s+(\S+)/u.exec(nextCommand);
  const artifactMatch = /--artifact\s+(\S+)/u.exec(nextCommand);
  return {
    event: eventMatch?.[1] ?? null,
    artifact: artifactMatch?.[1] ?? null,
  };
}

function buildAdvanceCommand(
  taskId: string,
  artifact: string,
  stage: string,
  event: string,
): string {
  if (
    stage === "review" &&
    (event === "must_fix" ||
      event === "review_spot_fix" ||
      event === "review_core_reentry")
  ) {
    return `pnpm -w exec pan advance ${taskId} --event ${event} --artifact ${artifact}`;
  }
  if (
    stage === "test" &&
    (event === "qa_fails" ||
      event === "qa_fails_plan_invalidating" ||
      event === "qa_spot_fix" ||
      event === "qa_design_followup" ||
      event === "repo_wide_blocker")
  ) {
    return `pnpm -w exec pan advance ${taskId} --event ${event} --artifact ${artifact}`;
  }
  if (
    stage === "compliance" &&
    (event === "compliance_fails" ||
      event === "compliance_fails_plan_invalidating" ||
      event === "compliance_spot_fix")
  ) {
    return `pnpm -w exec pan advance ${taskId} --event ${event} --artifact ${artifact}`;
  }
  if (stage === "bookkeeping" && event === "repo_wide_blocker") {
    return `pnpm -w exec pan advance ${taskId} --event ${event} --artifact ${artifact}`;
  }
  return `pnpm -w exec pan advance ${taskId} --artifact ${artifact}`;
}

function resolveImplementMustFixReentry(
  state: FeatureDeliveryState,
  repoRoot?: string,
): NextStep | null {
  if (state.currentStage !== "implement") {
    return null;
  }
  const lastAdvance = lastAdvanceEntry(state);
  if (lastAdvance?.event !== "must_fix" || lastAdvance.from !== "review") {
    return null;
  }
  const reviewArtifact = path.posix.join(state.artifacts.runDir, "review.md");
  if (repoRoot === undefined) {
    return null;
  }
  const reviewPath = resolveRepoPath(repoRoot, reviewArtifact);
  if (!existsSync(reviewPath)) {
    return null;
  }
  const verdict = parseReviewPassesVerdict(readFileSync(reviewPath, "utf8"));
  if (verdict !== true) {
    return null;
  }
  return {
    event: "review_passes",
    artifact: reviewArtifact,
    nextCommand: buildAdvanceCommand(
      state.taskId,
      reviewArtifact,
      "review",
      "review_passes",
    ),
    source: "derived",
  };
}

function isNonTerminalFeatureDeliveryState(
  state: FeatureDeliveryState,
): boolean {
  return (
    state.status !== "halted" &&
    state.status !== "closed" &&
    state.currentStage !== "aborted" &&
    state.currentStage !== TERMINAL_STAGE
  );
}

function enrichFeatureDeliveryEnvelope<T extends Record<string, unknown>>(
  repoRoot: string,
  state: FeatureDeliveryState,
  payload: T,
): T & {
  nextCommand?: string | null;
  event?: string | null;
  artifact?: string | null;
  workflowHealthStatus?: string;
  gateBlockReasons?: string[];
} {
  type Enriched = T & {
    nextCommand?: string | null;
    event?: string | null;
    artifact?: string | null;
    workflowHealthStatus?: string;
    gateBlockReasons?: string[];
  };
  const workflowHealth = readWorkflowHealthSummary(repoRoot, state.artifacts.runDir);
  const healthFields =
    workflowHealth === null
      ? {}
      : {
          workflowHealthStatus: workflowHealth.status,
          ...(workflowHealth.gate_block_reasons.length > 0
            ? { gateBlockReasons: workflowHealth.gate_block_reasons }
            : {}),
        };
  if (!isNonTerminalFeatureDeliveryState(state)) {
    return {
      ...payload,
      nextCommand: null,
      event: null,
      artifact: null,
      ...healthFields,
    } as Enriched;
  }
  const step = resolveNextStep(state, { repoRoot });
  const enriched = {
    ...payload,
    nextCommand: step.nextCommand,
    ...healthFields,
  };
  if ("event" in payload) {
    return enriched as Enriched;
  }
  return {
    ...enriched,
    event: step.event,
    artifact: step.artifact,
  } as Enriched;
}

function decodedTimestampFields(
  runDirRel: string,
  taskId: string,
): { decodedTimestamp?: string; decodedTimestampDiagnostic?: string } {
  const parsed = parseRunDirParts(runDirRel);
  if (parsed === null) {
    return {};
  }
  const decoded = decodeCountdownTimestamp(parsed.dayBucket, taskId);
  if (decoded.ok) {
    return { decodedTimestamp: decoded.utcLabel };
  }
  return { decodedTimestampDiagnostic: decoded.diagnostic };
}

export async function resolveFeatureDeliveryNext(
  repoRootInput: string,
  taskIdInput: string,
): Promise<FeatureDeliveryNextResult> {
  const repoRoot = path.resolve(repoRootInput);
  const taskId = sanitizeTaskId(taskIdInput);
  const stateFile = await findStateFile(repoRoot, taskId);
  const state = await readFeatureDeliveryState(stateFile.abs);
  const step = resolveNextStep(state, { repoRoot });
  const decoded = decodedTimestampFields(state.artifacts.runDir, taskId);
  return {
    command: "next",
    status: "ok",
    taskId,
    featureId: state.featureId,
    runDir: state.artifacts.runDir,
    currentStage: state.currentStage,
    pipelineStatus: state.status,
    nextHumanAction: state.nextHumanAction,
    event: step.event,
    artifact: step.artifact,
    nextCommand: step.nextCommand,
    source: step.source,
    ...(step.reason !== undefined ? { reason: step.reason } : {}),
    ...decoded,
  };
}

export async function validateArtifactsForTask(input: {
  repoRoot: string;
  taskId: string;
  stage: string;
}): Promise<ValidateArtifactsResult> {
  const repoRoot = path.resolve(input.repoRoot);
  const taskId = sanitizeTaskId(input.taskId);
  const stage = assertFeatureDeliveryStage(input.stage);
  const stateFile = await findStateFile(repoRoot, taskId);
  const state = await readFeatureDeliveryState(stateFile.abs);
  const validation = validateStageCompletionArtifacts(repoRoot, state, stage);
  const clean = validation.ok && validation.warningCount === 0;
  return {
    command: "artifacts validate",
    status: clean ? "ok" : "invalid",
    taskId,
    stage,
    warningCount: validation.warningCount,
    warnings: validation.warnings,
    missing: validation.missing,
    present: validation.present,
  };
}

export async function lintArtifactsForTask(input: {
  repoRoot: string;
  taskId: string;
  stage: string;
}): Promise<ValidateArtifactsResult> {
  const result = await validateArtifactsForTask(input);
  return {
    ...result,
    command: "artifacts lint",
  };
}

function collectStageContentWarnings(
  repoRoot: string,
  state: FeatureDeliveryState,
  stage: string,
): ArtifactContentWarning[] {
  const validation = validateStageCompletionArtifacts(repoRoot, state, stage);
  return validation.warnings;
}

function finalClosureContractMarkdown(state: FeatureDeliveryState): string {
  const closure = finalClosurePaths(state);
  const closeDoc = pipelineCloseRel(state);
  return `Final artifact closure follows ${closeDoc} in the active run directory.

Librarian task:

1. Confirm the run is complete, ${closeDoc} exists, ${operatorVerificationRel(state)} exists, and the active artifacts exist.
2. Execute the artifact closure command exactly once:

\`\`\`bash
pnpm -w exec pan close-artifacts ${state.taskId}
\`\`\`

3. Verify the command output reports:
   - archivedRunDir: ${closure.workArchiveRel}
   - archivedInboxPath: ${closure.inboxArchiveRel}
   - activeMemoryPath: lib/memory/active/current.md (refreshed automatically; Active Feature clears to \`(none)\` when it matched the archived inbox source)
4. Run \`pnpm -w exec pan status ${state.taskId}\` and confirm the status resolves from the archive.
5. Report the resulting \`git status --short\`.

Do not manually move files from .pan/work/ to .pan/archive/work/. When closure fails, report the error to the operator.`;
}

function renderClosedPrompt(state: FeatureDeliveryState): string {
  return `Feature-delivery task ${state.taskId} is closed.

Artifact closure has already completed.

Archived run directory: ${state.artifacts.runDir}
State file: ${state.artifacts.stateFile}
Run log: ${state.artifacts.runLogFile}

No further feature-delivery agent action is required.`;
}

function closedContractMarkdown(state: FeatureDeliveryState): string {
  return `Artifact closure completed.

Archived run directory: ${state.artifacts.runDir}
State file: ${state.artifacts.stateFile}
Run log: ${state.artifacts.runLogFile}

No further feature-delivery action is required.`;
}

function finalClosurePaths(state: FeatureDeliveryState): {
  runDirRel: string;
  workArchiveRel: string;
  inboxSourceRel: string;
  inboxArchiveRel: string;
} {
  const run = parseWorkRunDir(state.artifacts.runDir, state.taskId);
  const activeRunDirRel = path.posix.join(".pan/work", run.dayDir, run.taskId);
  const workArchiveRel = path.posix.join(
    ".pan/archive",
    "work",
    run.dayDir,
    run.taskId,
  );
  const inboxSourceRel = state.source.inboxPath
    .replace(/\\/gu, "/")
    .replace(/^\/+/, "");
  return {
    runDirRel: activeRunDirRel,
    workArchiveRel,
    inboxSourceRel,
    inboxArchiveRel: archiveInboxPathForSource(inboxSourceRel, run.dayDir),
  };
}

function parseWorkRunDir(
  runDirRel: string,
  expectedTaskId: string,
): { dayDir: string; taskId: string } {
  let norm = runDirRel.replace(/\\/gu, "/").replace(/^\/+/, "");
  if (norm.startsWith(".pan/archive/work/")) {
    norm = `.pan/work/${norm.slice(".pan/archive/work/".length)}`;
  }
  const parts = norm.split("/");
  if (parts.length !== 4 || parts[0] !== ".pan" || parts[1] !== "work") {
    throw new Error(
      `feature-delivery runDir must be .pan/work/<day>/<task-id> or .pan/archive/work/<day>/<task-id>; got ${runDirRel}.`,
    );
  }
  const [, , dayDir, taskId] = parts;
  if (taskId !== expectedTaskId) {
    throw new Error(
      `feature-delivery runDir task id ${taskId} does not match state task id ${expectedTaskId}.`,
    );
  }
  return { dayDir, taskId };
}

function makeInterventionRecord(
  state: FeatureDeliveryState,
  now: Date,
  command: "pause" | "resume" | "abort",
  abortReason?: string,
): RunLogRecord {
  const checkpointSeq = state.advanceHistory?.length ?? 0;
  const attrs: Record<string, unknown> = {
    "openinference.span.kind": "CHAIN",
    "gen_ai.operation.name": `pancreator.pipeline.intervention.${command}`,
    "gen_ai.provider.name": "local-cli",
    "gen_ai.request.model": "none",
    "pancreator.feature_id": state.featureId,
    "pancreator.state_file": state.artifacts.stateFile,
    "pancreator.intervention.command": command,
  };
  if (abortReason !== undefined) {
    attrs["pancreator.intervention.abort_reason"] = abortReason;
  }
  return {
    ts: rfc3339UtcMs(now),
    trace_id: newTraceId(),
    span_id: newSpanId(),
    name: `pancreator.pipeline.intervention.${command}`,
    kind: "event",
    status: { code: "OK" },
    attributes: attrs,
    resource: { "service.name": "pancreator", "service.version": "0.0.0" },
    pancreator: {
      task_id: asTaskId(state.taskId),
      pipeline: state.pipelineId,
      stage_id: state.currentStage,
      outcome: command === "abort" ? "aborted" : "success",
      checkpoint_seq: checkpointSeq,
      token_usage_unavailable: true,
      intervention: { lever: command },
    },
  };
}

function makeInvocationRecord(
  state: FeatureDeliveryState,
  now: Date,
): RunLogRecord {
  return {
    ts: rfc3339UtcMs(now),
    trace_id: newTraceId(),
    span_id: newSpanId(),
    name: "pancreator.pipeline.invoke",
    kind: "event",
    status: { code: "OK" },
    attributes: {
      "openinference.span.kind": "CHAIN",
      "gen_ai.operation.name": "pipeline.invoke",
      "gen_ai.provider.name": "local-cli",
      "gen_ai.request.model": "none",
      "pancreator.feature_id": state.featureId,
      "pancreator.state_file": state.artifacts.stateFile,
    },
    resource: { "service.name": "pancreator", "service.version": "0.0.0" },
    pancreator: {
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
  options?: { contentWarnings?: ArtifactContentWarning[] },
): RunLogRecord {
  const record = makeStateRecord(
    state,
    now,
    "pancreator.pipeline.advance",
    fromStage,
    toStage,
    event,
    artifact,
  );
  const contentWarnings = options?.contentWarnings ?? [];
  if (contentWarnings.length === 0) {
    return record;
  }
  return {
    ...record,
    attributes: {
      ...record.attributes,
      "pancreator.content_warning_count": contentWarnings.length,
      "pancreator.content_warnings": contentWarnings.map((warning) => ({
        path: warning.path,
        code: warning.code,
        message: warning.message,
      })),
    },
  };
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
    "pancreator.pipeline.repair_state",
    fromStage,
    toStage,
    "manual_repair",
    artifact,
  );
  return {
    ...record,
    attributes: {
      ...record.attributes,
      "pancreator.repair.reason": reason,
    },
  };
}

function makeReopenRecord(
  state: FeatureDeliveryState,
  now: Date,
  fromStage: string,
  toStage: string,
  reason: string,
): RunLogRecord {
  const record = makeStateRecord(
    state,
    now,
    "pancreator.pipeline.reopen",
    fromStage,
    toStage,
    "operator_reopen",
    state.artifacts.runDir,
  );
  return {
    ...record,
    attributes: {
      ...record.attributes,
      "pancreator.reopen.reason": reason,
    },
  };
}

function makeCloseRecord(
  state: FeatureDeliveryState,
  now: Date,
  previousRunDir: string,
  archivedRunDir: string,
  inboxSource: string,
  archivedInboxPath: string,
): RunLogRecord {
  const record = makeStateRecord(
    state,
    now,
    "pancreator.pipeline.close_artifacts",
    TERMINAL_STAGE,
    TERMINAL_STAGE,
    "artifacts_closed",
    archivedRunDir,
  );
  return {
    ...record,
    attributes: {
      ...record.attributes,
      "pancreator.previous_run_dir": previousRunDir,
      "pancreator.archived_run_dir": archivedRunDir,
      "pancreator.inbox_source": inboxSource,
      "pancreator.archived_inbox_path": archivedInboxPath,
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
      "pancreator.feature_id": state.featureId,
      "pancreator.state_file": state.artifacts.stateFile,
      "pancreator.from_stage": fromStage,
      "pancreator.to_stage": toStage,
      "pancreator.transition_event": event,
      "pancreator.artifact": artifact,
    },
    resource: { "service.name": "pancreator", "service.version": "0.0.0" },
    pancreator: {
      task_id: asTaskId(state.taskId),
      pipeline: state.pipelineId,
      stage_id: fromStage,
      outcome: "success",
      checkpoint_seq: state.advanceHistory?.length ?? 0,
      token_usage_unavailable: true,
    },
  };
}

async function findStateFile(
  repoRoot: string,
  taskId: string,
): Promise<{ abs: string; rel: string }> {
  const roots = [
    {
      abs: resolveProjectPath(repoRoot, ".pan/work"),
      rel: path.posix.join(".pan/work"),
    },
    {
      abs: resolveProjectPath(repoRoot, ".pan/archive", "work"),
      rel: path.posix.join(".pan/archive", "work"),
    },
  ];

  const matches: Array<{
    abs: string;
    rel: string;
    rootKind: ".pan/work" | ".pan/archive";
  }> = [];

  for (const root of roots) {
    const dayDirs = await safeReaddir(root.abs);
    for (const day of dayDirs) {
      const candidate = path.join(root.abs, day, taskId, "state.json");
      try {
        await readFile(candidate, "utf8");
        matches.push({
          abs: candidate,
          rel: path.posix.join(root.rel, day, taskId, "state.json"),
          rootKind: root.rel === ".pan/work" ? ".pan/work" : ".pan/archive",
        });
      } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (err.code !== "ENOENT" && err.code !== "ENOTDIR") {
          throw error;
        }
      }
    }
  }

  if (matches.length === 0) {
    throw new Error(`No feature-delivery state.json found for task ${taskId}.`);
  }

  const workMatch = matches.find((match) => match.rootKind === ".pan/work");
  const archiveMatch = matches.find(
    (match) => match.rootKind === ".pan/archive",
  );

  if (workMatch !== undefined && archiveMatch !== undefined) {
    const workState = await readFeatureDeliveryState(workMatch.abs);
    if (workState.status !== "closed") {
      return workMatch;
    }
    return archiveMatch;
  }

  return matches[0]!;
}

async function readFeatureDeliveryState(
  stateFile: string,
): Promise<FeatureDeliveryState> {
  const parsed = parsePanWorkJsonText(
    await readFile(stateFile, "utf8"),
  ) as FeatureDeliveryState;
  if (parsed.pipelineId !== "feature-delivery") {
    throw new Error(
      `Expected feature-delivery state file; found ${parsed.pipelineId}.`,
    );
  }
  if (parsed.artifacts.nextPromptFile === undefined) {
    parsed.artifacts.nextPromptFile = path.posix.join(
      parsed.artifacts.runDir,
      "next-prompt.md",
    );
  }
  return parsed;
}

function loadFeatureDeliveryPipeline(repoRoot: string): PipelineDefinition {
  const pipeline = loadPipelineYaml(
    resolveProjectPath(repoRoot, "lib", "pipelines", "feature-delivery.yaml"),
  );
  if (pipeline.id !== "feature-delivery") {
    throw new Error(
      `Expected feature-delivery pipeline; found ${pipeline.id}.`,
    );
  }
  return pipeline;
}

async function refreshDesignStepsOptions(
  repoRoot: string,
  state: FeatureDeliveryState,
): Promise<void> {
  const designConfig = await resolveDesignStepsConfig(
    repoRoot,
    state.featureId,
  );
  state.options = {
    designSteps: designConfig.designSteps,
    designStepsSource: designConfig.designStepsSource,
  };
}

async function persistDesignCompanionPrompts(
  repoRoot: string,
  state: FeatureDeliveryState,
): Promise<void> {
  const runDir = state.artifacts.runDir;
  const specPath = path.posix.join(
    "lib",
    "memory",
    "features",
    state.featureId,
    "spec.md",
  );
  if (state.currentStage === "plan") {
    await writeFile(
      resolveRepoPath(repoRoot, productPlanPromptRel(runDir)),
      wrapPanWorkMarkdown(
        renderProductPlanPrompt({
          featureId: state.featureId,
          taskId: state.taskId,
          runDir,
          sourcePath: state.source.inboxPath,
          specPath,
        }),
        panWorkMarkdownMeta({
          artifact: "Product plan companion prompt",
          featureId: state.featureId,
          taskId: state.taskId,
          whyItMatters: "Delegates product planning inputs before tech-lead consolidation.",
        }),
      ),
      "utf8",
    );
    if (designStepsEnabled(state.options)) {
      await writeFile(
        resolveRepoPath(repoRoot, designPlanPromptRel(runDir)),
        wrapPanWorkMarkdown(
          renderDesignPlanPrompt({
            featureId: state.featureId,
            taskId: state.taskId,
            runDir,
            sourcePath: state.source.inboxPath,
            specPath,
          }),
          panWorkMarkdownMeta({
            artifact: "Design plan companion prompt",
            featureId: state.featureId,
            taskId: state.taskId,
            whyItMatters: "Delegates design planning inputs before tech-lead consolidation.",
          }),
        ),
        "utf8",
      );
    }
  }
  if (state.currentStage === "test" && designStepsEnabled(state.options)) {
    await writeFile(
      resolveRepoPath(repoRoot, designQaPromptRel(runDir)),
      wrapPanWorkMarkdown(
        renderDesignQaPrompt({
          featureId: state.featureId,
          taskId: state.taskId,
          runDir,
        }),
        panWorkMarkdownMeta({
          artifact: "Design QA companion prompt",
          featureId: state.featureId,
          taskId: state.taskId,
          whyItMatters: "Runs design-reviewer in parallel with qa-tester at the test stage.",
        }),
      ),
      "utf8",
    );
  }
}

async function persistStateAndPrompts(
  repoRoot: string,
  state: FeatureDeliveryState,
  pipeline: PipelineDefinition,
  mode: "advance" | "repair" | "refresh-prompt",
): Promise<void> {
  const statePath = resolveRepoPath(repoRoot, state.artifacts.stateFile);
  let existing: Record<string, unknown> = {};
  try {
    existing = parsePanWorkJsonText(await readFile(statePath, "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    existing = {};
  }
  const serialized = JSON.parse(stringifyCliJson(repoRoot, state)) as Record<
    string,
    unknown
  >;
  if (existing.schemaVersion !== undefined) {
    serialized.schemaVersion = existing.schemaVersion;
  }
  const merged = { ...existing, ...serialized };
  if (
    state.nextCommand === undefined ||
    state.nextCommand.trim().length === 0
  ) {
    delete merged.nextCommand;
  }
  if (state.currentStage === "plan" || state.currentStage === "test") {
    await refreshDesignStepsOptions(repoRoot, state);
  }
  await writeFile(
    statePath,
    stringifyPanWorkJson(
      repoRoot,
      merged,
      panWorkStateMeta(state.featureId, state.taskId, state.pipelineId),
    ),
    "utf8",
  );
  await writeFile(
    resolveRepoPath(repoRoot, state.artifacts.handoffFile),
    wrapPanWorkMarkdown(
      renderHandoff(repoRoot, state, pipeline),
      panWorkMarkdownMeta({
        artifact: "Handoff card",
        featureId: state.featureId,
        taskId: state.taskId,
        whyItMatters: "Bounds stage scope, validation commands, and in-scope paths for the active executor.",
      }),
    ),
    "utf8",
  );
  await writeFile(
    resolveRepoPath(repoRoot, requireNextPromptFile(state)),
    wrapPanWorkMarkdown(
      `# Generated by pan ${mode}\n\n${renderNextPrompt(repoRoot, state, pipeline)}`,
      panWorkMarkdownMeta({
        artifact: "Stage delegation prompt",
        featureId: state.featureId,
        taskId: state.taskId,
        whyItMatters: "Copy-paste prompt for delegating the current feature-delivery stage to the owning persona.",
      }),
    ),
    "utf8",
  );
  await persistDesignCompanionPrompts(repoRoot, state);
}

interface AppliedFeatureDeliveryTransition {
  fromStage: string;
  toStage: FeatureDeliveryCurrentStage;
  event: string;
  artifact: string;
}

function transitionSummariesRel(runDir: string): string {
  return path.posix.join(runDir, "transition-summaries.jsonl");
}

function appendTransitionSummary(input: {
  repoRoot: string;
  state: FeatureDeliveryState;
  applied: AppliedFeatureDeliveryTransition;
  now: Date;
  contentWarnings: readonly ArtifactContentWarning[];
}): void {
  const workflowHealth = readWorkflowHealthSummary(
    input.repoRoot,
    input.state.artifacts.runDir,
  );
  const lintWarnings = input.contentWarnings.map((warning) => warning.message);
  const healthWarnings =
    workflowHealth === null
      ? []
      : [
          ...workflowHealth.gate_block_reasons,
          ...workflowHealth.findings
            .filter((finding) => finding.severity === "warning" || finding.severity === "blocking")
            .map((finding) => finding.summary),
        ];
  const combinedWarnings = [...new Set([...lintWarnings, ...healthWarnings])];
  const nextStep = resolveNextStep(input.state, { repoRoot: input.repoRoot });
  const summary = {
    at_iso: rfc3339UtcMs(input.now),
    task_id: input.state.taskId,
    feature_id: input.state.featureId,
    from_stage: input.applied.fromStage,
    to_stage: input.applied.toStage,
    transition_event: input.applied.event,
    stage_decision:
      input.applied.fromStage === input.applied.toStage ? "hold" : "advance",
    artifact: input.applied.artifact,
    validation_artifacts: [
      input.applied.artifact,
      workflowHealthRel(input.state.artifacts.runDir),
    ],
    warning_count: combinedWarnings.length,
    warnings: combinedWarnings,
    artifact_lint_status: input.contentWarnings.length === 0 ? "pass" : "fail",
    artifact_lint_warning_count: input.contentWarnings.length,
    workflow_health_status: workflowHealth?.status ?? null,
    workflow_health_warning_count: healthWarnings.length,
    pipeline_status: input.state.status,
    next_human_action: input.state.nextHumanAction,
    next_command: nextStep.nextCommand,
    next_event: nextStep.event,
    output_manifest: {
      persona_contract: "PERSONA.SUPERVISOR",
      stage_contract: "PIPE.FEATURE_DELIVERY",
      required_docs: ["DOC.PIPELINE_STATE", "DOC.OUTPUT_MANIFEST"],
      consulted_docs: ["DOC.PIPELINE_STATE", "DOC.OUTPUT_MANIFEST"],
      produced_artifacts: [transitionSummariesRel(input.state.artifacts.runDir)],
      scope_amendments: [],
      validation: [{ name: "transition-summary", result: "pass" }],
      definition_of_done: "pass",
      gate_decision: "not_applicable",
      remediation_route: "none",
    },
  };
  const abs = resolveRepoPath(
    input.repoRoot,
    transitionSummariesRel(input.state.artifacts.runDir),
  );
  writeFileSync(abs, `${stringifyCliJson(input.repoRoot, summary)}\n`, {
    encoding: "utf8",
    flag: "a",
  });
}

function applyTerminalWorkflowHealthOutcome(
  state: FeatureDeliveryState,
  workflowHealth: WorkflowHealthSummary | null,
): void {
  if (state.currentStage !== TERMINAL_STAGE || state.status === "closed") {
    return;
  }
  if (workflowHealth !== null && workflowHealth.status !== "healthy") {
    state.status = "complete_with_attention";
    state.nextHumanAction = `Run is complete with attention (${workflowHealth.status}); inspect ${workflowHealthRel(state.artifacts.runDir)} before artifact closure.`;
    return;
  }
  if (state.status === "complete_with_attention") {
    state.status = "complete";
  }
}

interface ReviewReentryAdvancePlan {
  reviewArtifact: string;
  implementationReport: string;
}

function applyFeatureDeliveryTransition(
  state: FeatureDeliveryState,
  transition: FeatureDeliveryTransition,
  event: string,
  artifactRel: string,
  now: Date,
): AppliedFeatureDeliveryTransition {
  const fromStage = state.currentStage;
  const toStage = transition.to as FeatureDeliveryCurrentStage;
  state.currentStage = toStage;
  state.status =
    toStage === TERMINAL_STAGE ? "complete" : "ready_for_stage_delegation";
  state.nextHumanAction = nextHumanActionForStage(
    state,
    toStage,
    transition.humanAttention,
    state.automation?.runnerInvocation ?? "manual",
  );
  state.stages = applyStageStatuses(state.stages, fromStage, toStage, event);
  state.advanceHistory = [
    ...(state.advanceHistory ?? []),
    {
      atIso: rfc3339UtcMs(now),
      kind: "advance",
      from: fromStage,
      to: toStage,
      event,
      artifact: artifactRel,
    },
  ];
  return { fromStage, toStage, event, artifact: artifactRel };
}

function lastAdvanceEntry(
  state: FeatureDeliveryState,
): FeatureDeliveryAdvanceHistoryEntry | undefined {
  const history = state.advanceHistory ?? [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    if (entry.kind === "advance") {
      return entry;
    }
  }
  return undefined;
}

async function tryResolveReviewReentryAdvance(
  repoRoot: string,
  state: FeatureDeliveryState,
  artifactRel: string,
  eventOverride?: string,
): Promise<ReviewReentryAdvancePlan | null> {
  if (state.currentStage !== "implement") {
    return null;
  }
  const reviewArtifact = path.posix.join(state.artifacts.runDir, "review.md");
  if (artifactRel !== reviewArtifact) {
    return null;
  }
  if (eventOverride !== undefined && eventOverride !== "review_passes") {
    return null;
  }

  const lastAdvance = lastAdvanceEntry(state);
  if (lastAdvance?.event !== "must_fix" || lastAdvance.from !== "review") {
    return null;
  }

  const reviewContent = await readFile(
    resolveRepoPath(repoRoot, reviewArtifact),
    "utf8",
  );
  const verdict = parseReviewPassesVerdict(reviewContent);
  if (verdict !== true) {
    throw new Error(
      `Cannot advance ${state.taskId} with ${reviewArtifact} from implement after must_fix: ` +
        `review.md must contain review_passes: true. ` +
        `Advance with ${path.posix.join(state.artifacts.runDir, "implementation-report.md")} to return to review, ` +
        `or update review.md and retry. When review passes, the chain lands at test stage.`,
    );
  }

  const implementationReport = path.posix.join(
    state.artifacts.runDir,
    "implementation-report.md",
  );
  if (!existsSync(resolveRepoPath(repoRoot, implementationReport))) {
    throw new Error(
      `Cannot advance ${state.taskId} with ${reviewArtifact} from implement after must_fix: ` +
        `required artifact is missing: ${implementationReport}.`,
    );
  }

  return { reviewArtifact, implementationReport };
}

async function tryAdvanceFromReportApproval(input: {
  repoRoot: string;
  taskId: string;
  state: FeatureDeliveryState;
  pipeline: PipelineDefinition;
  stateFileRel: string;
  artifactRel: string;
  now: Date;
  testHooks?: FeatureDeliveryTestHooks;
  progress?: FeatureDeliverySdkProgressReporter;
}): Promise<AdvanceFeatureDeliveryResult | null> {
  if (!input.artifactRel.startsWith("lib/inbox/out/")) {
    return null;
  }
  const content = await readFile(
    resolveRepoPath(input.repoRoot, input.artifactRel),
    "utf8",
  );
  const decision = parseReportApprovalArtifact(content);
  if (decision === null) {
    return null;
  }
  if (
    input.state.automation?.reportApprovalPending !== true &&
    input.state.status !== "waiting_for_human_gate"
  ) {
    throw new Error(
      `Artifact ${input.artifactRel} is a report-approval decision but task ${input.taskId} is not awaiting report approval.`,
    );
  }

  if (decision.decision === "approve") {
    const transition = input.state.transitions.find(
      (candidate) =>
        candidate.from === "report" && candidate.on === "report_ready",
    );
    if (transition === undefined) {
      throw new Error(
        "feature-delivery pipeline is missing report → report_ready transition.",
      );
    }
    const applied = applyFeatureDeliveryTransition(
      input.state,
      transition,
      "report_ready",
      input.artifactRel,
      input.now,
    );
    input.state.automation = {
      ...(input.state.automation ?? {
        runnerInvocation: "sdk",
        cumulativeRetryCount: 0,
      }),
      reportApprovalPending: false,
    };
    return finishAdvanceAfterTransition({
      ...input,
      applied,
    });
  }

  if (decision.requiredChanges.trim().length === 0) {
    throw new Error(
      "needs_changes report approval requires non-empty required_changes.",
    );
  }
  const targetStage = decision.targetStage ?? "implement";
  assertFeatureDeliveryStage(targetStage);
  const fromStage = input.state.currentStage;
  input.state.currentStage = targetStage;
  input.state.status = "ready_for_stage_delegation";
  input.state.nextHumanAction = nextHumanActionForStage(
    input.state,
    targetStage,
    `Report approval needs_changes: ${decision.requiredChanges}`,
    input.state.automation?.runnerInvocation ?? "manual",
  );
  input.state.stages = repairStageStatuses(input.state.stages, targetStage);
  input.state.advanceHistory = [
    ...(input.state.advanceHistory ?? []),
    {
      atIso: rfc3339UtcMs(input.now),
      kind: "advance",
      from: fromStage,
      to: targetStage,
      event: "needs_changes",
      artifact: input.artifactRel,
    },
  ];
  const applied: AppliedFeatureDeliveryTransition = {
    fromStage,
    toStage: targetStage,
    event: "needs_changes",
    artifact: input.artifactRel,
  };
  input.state.automation = {
    ...(input.state.automation ?? {
      runnerInvocation: "sdk",
      cumulativeRetryCount: 0,
    }),
    reportApprovalPending: false,
  };
  return finishAdvanceAfterTransition({
    ...input,
    applied,
  });
}

async function finishAdvanceAfterTransition(input: {
  repoRoot: string;
  taskId: string;
  state: FeatureDeliveryState;
  pipeline: PipelineDefinition;
  stateFileRel: string;
  applied: AppliedFeatureDeliveryTransition;
  now: Date;
  testHooks?: FeatureDeliveryTestHooks;
  progress?: FeatureDeliverySdkProgressReporter;
}): Promise<AdvanceFeatureDeliveryResult> {
  delete input.state.nextCommand;
  const invocation = await readCursorInvocationForState(
    input.repoRoot,
    input.state,
  );
  let compiled:
    | Awaited<ReturnType<typeof compileFeatureDeliveryPipeline>>
    | undefined;
  if (
    invocation === "sdk" &&
    input.state.status !== "halted" &&
    input.state.currentStage !== TERMINAL_STAGE
  ) {
    compiled = await compileFeatureDeliveryPipeline(
      input.repoRoot,
      input.pipeline,
    );
    prepareStageInvocationIndexForSdkEntry(
      input.state,
      input.state.currentStage,
      invocation,
    );
    await persistStateAndPrompts(
      input.repoRoot,
      input.state,
      input.pipeline,
      "advance",
    );
    emitFeatureDeliveryStageTransition(resolveFeatureDeliveryProgress(input), {
      taskId: input.taskId,
      featureId: input.state.featureId,
      fromStage: input.applied.fromStage,
      toStage: input.applied.toStage,
      event: input.applied.event,
      persona:
        personaForStage(input.pipeline, input.state.currentStage) ?? undefined,
      now: input.now,
    });
    await invokeFeatureDeliveryEnteringStage({
      repoRoot: input.repoRoot,
      state: input.state,
      pipeline: input.pipeline,
      stageId: input.state.currentStage,
      compiled,
      now: input.now,
      testHooks: input.testHooks,
      progress: resolveFeatureDeliveryProgress(input),
    });
  }
  await persistStateAndPrompts(
    input.repoRoot,
    input.state,
    input.pipeline,
    "advance",
  );
  if (invocation === "sdk" && compiled !== undefined) {
    const chained = await ensureSdkAutoChainProgress({
      repoRoot: input.repoRoot,
      taskId: input.taskId,
      state: input.state,
      pipeline: input.pipeline,
      completedStageId: input.state.currentStage,
      compiled,
      now: input.now,
      testHooks: input.testHooks,
      progress: resolveFeatureDeliveryProgress(input),
    });
    if (chained) {
      const refreshed = await readFeatureDeliveryState(
        resolveRepoPath(input.repoRoot, input.state.artifacts.stateFile),
      );
      Object.assign(input.state, refreshed);
    }
  }
  await appendRunLogRecord(
    resolveRepoPath(input.repoRoot, input.state.artifacts.runLogFile),
    makeAdvanceRecord(
      input.state,
      input.now,
      input.applied.fromStage,
      input.applied.toStage,
      input.applied.event,
      input.applied.artifact,
    ),
  );
  await writeWorkflowHealthArtifact({
    repoRoot: input.repoRoot,
    state: input.state,
    stageId: input.state.currentStage,
    now: input.now,
  });
  const workflowHealth = readWorkflowHealthSummary(
    input.repoRoot,
    input.state.artifacts.runDir,
  );
  if (input.applied.toStage === TERMINAL_STAGE) {
    applyTerminalWorkflowHealthOutcome(input.state, workflowHealth);
    await persistStateAndPrompts(
      input.repoRoot,
      input.state,
      input.pipeline,
      "advance",
    );
  }
  appendTransitionSummary({
    repoRoot: input.repoRoot,
    state: input.state,
    applied: input.applied,
    now: input.now,
    contentWarnings: [],
  });
  return enrichFeatureDeliveryEnvelope(input.repoRoot, input.state, {
    command: "advance",
    status: "ok",
    taskId: input.taskId,
    featureId: input.state.featureId,
    fromStage: input.applied.fromStage,
    event: input.applied.event,
    currentStage: input.state.currentStage,
    artifact: input.applied.artifact,
    stateFile: input.stateFileRel,
    handoffFile: input.state.artifacts.handoffFile,
    nextPromptFile: requireNextPromptFile(input.state),
    nextPersona: personaForStage(input.pipeline, input.state.currentStage),
    nextHumanAction: input.state.nextHumanAction,
    ...classifyCurrentDiffPaths(input.repoRoot, input.state.artifacts.runDir),
  }) as AdvanceFeatureDeliveryResult;
}

async function advanceReviewReentryFromImplement(input: {
  repoRoot: string;
  taskId: string;
  state: FeatureDeliveryState;
  pipeline: PipelineDefinition;
  stateFileRel: string;
  reentry: ReviewReentryAdvancePlan;
  now: Date;
  testHooks?: FeatureDeliveryTestHooks;
  progress?: FeatureDeliverySdkProgressReporter;
}): Promise<AdvanceFeatureDeliveryResult> {
  const { repoRoot, taskId, state, pipeline, stateFileRel, reentry, now } =
    input;
  delete state.nextCommand;
  const implementTransition = state.transitions.find(
    (candidate) =>
      candidate.from === "implement" &&
      candidate.on === "implementation_complete",
  );
  if (implementTransition === undefined) {
    throw new Error(
      "feature-delivery pipeline is missing implement → review transition.",
    );
  }
  assertStageArtifact(
    repoRoot,
    state,
    "implement",
    reentry.implementationReport,
    "implementation_complete",
  );

  const contentWarnings = collectStageContentWarnings(
    repoRoot,
    state,
    "implement",
  );

  const first = applyFeatureDeliveryTransition(
    state,
    implementTransition,
    "implementation_complete",
    reentry.implementationReport,
    now,
  );
  await appendRunLogRecord(
    resolveRepoPath(repoRoot, state.artifacts.runLogFile),
    makeAdvanceRecord(
      state,
      now,
      first.fromStage,
      first.toStage,
      first.event,
      first.artifact,
      { contentWarnings },
    ),
  );

  const reviewTransition = state.transitions.find(
    (candidate) =>
      candidate.from === "review" && candidate.on === "review_passes",
  );
  if (reviewTransition === undefined) {
    throw new Error(
      "feature-delivery pipeline is missing review → test transition.",
    );
  }
  assertStageArtifact(
    repoRoot,
    state,
    "review",
    reentry.reviewArtifact,
    "review_passes",
  );

  const second = applyFeatureDeliveryTransition(
    state,
    reviewTransition,
    "review_passes",
    reentry.reviewArtifact,
    now,
  );
  await appendRunLogRecord(
    resolveRepoPath(repoRoot, state.artifacts.runLogFile),
    makeAdvanceRecord(
      state,
      now,
      second.fromStage,
      second.toStage,
      second.event,
      second.artifact,
      { contentWarnings },
    ),
  );

  const invocation = await readCursorInvocationForState(repoRoot, state);
  if (invocation === "sdk") {
    const compiled = await compileFeatureDeliveryPipeline(repoRoot, pipeline);
    prepareStageInvocationIndexForSdkEntry(
      state,
      state.currentStage,
      invocation,
    );
    await persistStateAndPrompts(repoRoot, state, pipeline, "advance");
    emitFeatureDeliveryStageTransition(resolveFeatureDeliveryProgress(input), {
      taskId,
      featureId: state.featureId,
      fromStage: second.fromStage,
      toStage: state.currentStage,
      event: second.event,
      persona: personaForStage(pipeline, state.currentStage) ?? undefined,
      now,
    });
    await invokeFeatureDeliveryEnteringStage({
      repoRoot,
      state,
      pipeline,
      stageId: state.currentStage,
      compiled,
      now,
      testHooks: input.testHooks,
      progress: resolveFeatureDeliveryProgress(input),
    });
  }

  await persistStateAndPrompts(repoRoot, state, pipeline, "advance");
  await writeWorkflowHealthArtifact({
    repoRoot,
    state,
    stageId: state.currentStage,
    gateBlockReasons: contentWarnings.map((warning) => warning.message),
    now,
  });
  const workflowHealth = readWorkflowHealthSummary(repoRoot, state.artifacts.runDir);
  if (second.toStage === TERMINAL_STAGE) {
    applyTerminalWorkflowHealthOutcome(state, workflowHealth);
    await persistStateAndPrompts(repoRoot, state, pipeline, "advance");
  }
  appendTransitionSummary({
    repoRoot,
    state,
    applied: second,
    now,
    contentWarnings,
  });

  return enrichFeatureDeliveryEnvelope(repoRoot, state, {
    command: "advance",
    status: "ok",
    taskId,
    featureId: state.featureId,
    fromStage: first.fromStage,
    event: second.event,
    currentStage: state.currentStage,
    artifact: second.artifact,
    stateFile: stateFileRel,
    handoffFile: state.artifacts.handoffFile,
    nextPromptFile: requireNextPromptFile(state),
    nextPersona: personaForStage(pipeline, state.currentStage),
    nextHumanAction: state.nextHumanAction,
    ...classifyCurrentDiffPaths(repoRoot, state.artifacts.runDir),
    reviewReentry: true,
    contentWarnings,
    warningCount: contentWarnings.length,
  }) as AdvanceFeatureDeliveryResult;
}

function defaultEventForStage(stage: string): string {
  switch (stage) {
    case "plan":
      return "sdk_artifact_validation";
    case "implement":
      return "implementation_complete";
    case "review":
      return "review_passes";
    case "test":
      return "qa_passes";
    case "bookkeeping":
      return "bookkeeping_complete";
    case "report":
      return "report_ready";
    case "compliance":
      return "compliance_passes";
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
  try {
    assertAdvanceArtifacts(repoRoot, state, stage, artifact, event);
  } catch (error) {
    const reviewArtifact = path.posix.join(state.artifacts.runDir, "review.md");
    const lastAdvance = lastAdvanceEntry(state);
    const afterMustFix =
      stage === "implement" &&
      artifact === reviewArtifact &&
      lastAdvance?.event === "must_fix" &&
      lastAdvance.from === "review";
    if (
      afterMustFix &&
      error instanceof Error &&
      error.message.includes("is not valid for implement")
    ) {
      throw new Error(
        `${error.message} After must_fix re-entry, advance with review.md when it records review_passes: true to chain implement→review→test, or advance with ${path.posix.join(state.artifacts.runDir, "implementation-report.md")} first.`,
      );
    }
    throw error;
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
  if (event === "review_spot_fix") {
    return stages.map((stage) => {
      if (stage.id === "review") return { ...stage, status: "ready" };
      return stage;
    });
  }
  if (event === "review_core_reentry") {
    const planIndex = FEATURE_DELIVERY_STAGES.indexOf("plan");
    return stages.map((stage) => {
      const index = FEATURE_DELIVERY_STAGES.indexOf(
        stage.id as FeatureDeliveryStageId,
      );
      if (index < 0) return stage;
      if (stage.id === "review") return { ...stage, status: "blocked" };
      if (index < planIndex) return { ...stage, status: "complete" };
      if (stage.id === "plan") return { ...stage, status: "ready" };
      return { ...stage, status: "pending" };
    });
  }
  if (event === "qa_fails") {
    return stages.map((stage) => {
      if (stage.id === "test") return { ...stage, status: "blocked" };
      if (stage.id === "implement") return { ...stage, status: "ready" };
      return stage;
    });
  }
  if (event === "qa_fails_plan_invalidating") {
    const planIndex = FEATURE_DELIVERY_STAGES.indexOf("plan");
    return stages.map((stage) => {
      const index = FEATURE_DELIVERY_STAGES.indexOf(
        stage.id as FeatureDeliveryStageId,
      );
      if (index < 0) return stage;
      if (stage.id === "test") return { ...stage, status: "blocked" };
      if (index < planIndex) return { ...stage, status: "complete" };
      if (stage.id === "plan") return { ...stage, status: "ready" };
      return { ...stage, status: "pending" };
    });
  }
  if (event === "qa_spot_fix") {
    return stages.map((stage) => {
      if (stage.id === "test") return { ...stage, status: "ready" };
      return stage;
    });
  }
  if (event === "repo_wide_blocker") {
    return stages.map((stage) => {
      if (stage.id === fromStage) return { ...stage, status: "ready" };
      return stage;
    });
  }
  if (event === "compliance_fails") {
    return stages.map((stage) => {
      if (stage.id === "compliance") return { ...stage, status: "blocked" };
      if (stage.id === "implement") return { ...stage, status: "ready" };
      return stage;
    });
  }
  if (event === "compliance_fails_plan_invalidating") {
    const planIndex = FEATURE_DELIVERY_STAGES.indexOf("plan");
    return stages.map((stage) => {
      const index = FEATURE_DELIVERY_STAGES.indexOf(
        stage.id as FeatureDeliveryStageId,
      );
      if (index < 0) return stage;
      if (stage.id === "compliance") return { ...stage, status: "blocked" };
      if (index < planIndex) return { ...stage, status: "complete" };
      if (stage.id === "plan") return { ...stage, status: "ready" };
      return { ...stage, status: "pending" };
    });
  }
  if (event === "compliance_spot_fix") {
    return stages.map((stage) => {
      if (stage.id === "compliance") return { ...stage, status: "ready" };
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
    const index = FEATURE_DELIVERY_STAGES.indexOf(
      stage.id as FeatureDeliveryStageId,
    );
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
  invocation: "manual" | "sdk" = "manual",
): string {
  const prefix = extra === undefined ? "" : `${extra} `;
  if (invocation === "sdk") {
    switch (stage) {
      case "plan":
      case "bookkeeping":
      case "report":
        return `${prefix}SDK validates stage artifacts and auto-advances when validation passes.`;
      case "implement":
        return `${prefix}SDK invokes coder; auto-advances to review when implementation-report.md validates.`;
      case "review":
      case "test":
      case "compliance":
        return `${prefix}SDK routes from stage verdict artifacts without operator advance.`;
      case "ship":
        return `${prefix}SDK validates ship-ratification.json and auto-advances after local diff checks.`;
      case "index":
        return `${prefix}SDK validates index.json, writes ${pipelineCloseRel(state)}, and advances to complete.`;
      case "complete":
        return state.status === "closed"
          ? `${prefix}Artifact closure complete; review ${pipelineCloseRel(state)} in the archived run directory.`
          : `${prefix}Review ${pipelineCloseRel(state)} then run pan close-artifacts once.`;
      default:
        return `${prefix}No SDK action defined for ${stage}.`;
    }
  }
  switch (stage) {
    case "plan":
      return `${prefix}Delegate product/plan-prompt.md to product-engineer and design/plan-prompt.md to design-engineer, then delegate next-prompt.md to tech-lead. Ratify product/design/tech plans, acceptance criteria, manual QA cases, plan.md, touch-set.json, and handoff.md before advancing.`;
    case "implement":
      return `${prefix}Delegate next-prompt.md to coder; monitor drift and require ${state.artifacts.runDir}/implementation-report.md before review.`;
    case "review":
      return `${prefix}Delegate next-prompt.md to reviewer; inspect ${state.artifacts.runDir}/review.md and choose pass, must-fix, or review-core-reentry.`;
    case "test":
      return `${prefix}Delegate next-prompt.md to qa-tester and design-qa-prompt.md to design-reviewer in parallel; inspect test-report.md plus design-qa-report.md and choose pass or qa-fail.`;
    case "bookkeeping":
      return `${prefix}Delegate next-prompt.md to librarian; verify delivery-report.md, feature index refresh, and closeout artifacts before complete.`;
    case "report":
      return stateIncludesStage(state, "compliance")
        ? `${prefix}Delegate next-prompt.md to tech-writer; ratify delivery-report.md before compliance.`
        : `${prefix}Delegate next-prompt.md to tech-writer; ratify delivery-report.md before ship.`;
    case "compliance":
      return `${prefix}Delegate next-prompt.md to compliance-auditor; require compliance-result.json plus green compliance exit bundle before ship.`;
    case "ship":
      return `${prefix}Delegate next-prompt.md to supervisor; human must ratify the local diff before index.`;
    case "index":
      return `${prefix}Delegate next-prompt.md to librarian; verify feature index artifacts before complete. The generated complete-stage prompt delegates artifact closure to librarian.`;
    case "complete":
      return state.status === "closed"
        ? `${prefix}Artifact closure complete; no further feature-delivery action is required.`
        : `${prefix}Delegate next-prompt.md to librarian for final artifact closure with pan close-artifacts.`;
    default:
      return `${prefix}No human action defined for ${stage}.`;
  }
}

function personaForStage(
  pipeline: PipelineDefinition,
  stage: string,
): string | null {
  if (stage === TERMINAL_STAGE) return "librarian";
  return (
    pipeline.stages.find((candidate) => candidate.id === stage)?.persona ?? null
  );
}

function assertFeatureDeliveryStage(value: string): FeatureDeliveryStageId {
  const stage = value as FeatureDeliveryStageId;
  if (!FEATURE_DELIVERY_STAGES.includes(stage)) {
    throw new Error(
      `stage MUST be one of: ${FEATURE_DELIVERY_STAGES.join(", ")}.`,
    );
  }
  return stage;
}

async function assertRepoRelativeExistingFile(
  repoRoot: string,
  value: string,
  label: string,
): Promise<{ abs: string; rel: string }> {
  const rel = value.replace(/\\/gu, "/").replace(/^\/+/, "");
  if (
    rel === "" ||
    rel.includes("\0") ||
    rel.split("/").some((part) => part === ".." || part === ".")
  ) {
    throw new Error(`${label} MUST be a safe repo-relative path.`);
  }
  const abs = resolveRepoPath(repoRoot, rel);
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

async function assertExistingFile(abs: string, rel: string): Promise<void> {
  try {
    const info = await stat(abs);
    if (!info.isFile()) {
      throw new Error(`Expected file but found non-file path: ${rel}.`);
    }
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT" || err.code === "ENOTDIR") {
      throw new Error(`Required file is missing: ${rel}.`);
    }
    throw error;
  }
}

async function assertExistingDirectory(
  abs: string,
  rel: string,
): Promise<void> {
  try {
    const info = await stat(abs);
    if (!info.isDirectory()) {
      throw new Error(
        `Expected directory but found non-directory path: ${rel}.`,
      );
    }
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT" || err.code === "ENOTDIR") {
      throw new Error(`Required directory is missing: ${rel}.`);
    }
    throw error;
  }
}

async function assertPathMissing(abs: string, rel: string): Promise<void> {
  try {
    await stat(abs);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT" || err.code === "ENOTDIR") {
      return;
    }
    throw error;
  }
  throw new Error(`Closure target already exists: ${rel}.`);
}

function requireNextPromptFile(state: FeatureDeliveryState): string {
  const nextPromptFile =
    state.artifacts.nextPromptFile ??
    path.posix.join(state.artifacts.runDir, "next-prompt.md");
  state.artifacts.nextPromptFile = nextPromptFile;
  return nextPromptFile;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function normalizeRelPath(value: string): string {
  return value.replace(/\\/gu, "/").replace(/^\/+/u, "");
}

async function resolveAttestedPath(repoRoot: string, rel: string): Promise<string | null> {
  const normalized = normalizeRelPath(rel);
  const candidates = normalized.startsWith("pancreator/")
    ? [normalized]
    : [normalized, path.posix.join("pancreator", normalized)];
  for (const candidate of candidates) {
    if (existsSync(resolveRepoPath(repoRoot, candidate))) {
      return candidate;
    }
  }
  return null;
}

async function findInboxDirectiveByBasename(
  repoRoot: string,
  basename: string,
): Promise<string | null> {
  const roots = ["lib/inbox/in", "pancreator/lib/inbox/in"];
  for (const rootRel of roots) {
    const rootAbs = resolveRepoPath(repoRoot, rootRel);
    if (!existsSync(rootAbs)) {
      continue;
    }
    const queue: Array<{ abs: string; rel: string }> = [
      { abs: rootAbs, rel: rootRel },
    ];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) {
        break;
      }
      const entries = await safeReaddir(current.abs);
      for (const entry of entries) {
        const childAbs = path.join(current.abs, entry);
        const childRel = path.posix.join(current.rel, entry);
        try {
          const info = await stat(childAbs);
          if (info.isDirectory()) {
            queue.push({ abs: childAbs, rel: childRel });
            continue;
          }
          if (info.isFile() && entry === basename) {
            return childRel;
          }
        } catch {
          continue;
        }
      }
    }
  }
  return null;
}

async function introspectionPathAttestationIssues(
  repoRoot: string,
): Promise<{ markerPath: string | null; issues: string[] }> {
  const markerCandidates = [
    ".pan/introspection/last-run.json",
    "pancreator/.pan/introspection/last-run.json",
  ];
  let markerPath: string | null = null;
  for (const candidate of markerCandidates) {
    if (existsSync(resolveRepoPath(repoRoot, candidate))) {
      markerPath = candidate;
      break;
    }
  }
  if (markerPath === null) {
    return { markerPath: null, issues: [] };
  }
  const markerRaw = await readFile(resolveRepoPath(repoRoot, markerPath), "utf8");
  let marker: Record<string, unknown>;
  try {
    marker = JSON.parse(markerRaw) as Record<string, unknown>;
  } catch {
    return { markerPath, issues: [`${markerPath} must parse as JSON.`] };
  }
  const issues: string[] = [];
  const reportPath = marker.report_path;
  if (typeof reportPath !== "string" || reportPath.trim().length === 0) {
    issues.push(`${markerPath} must include string report_path.`);
  } else if ((await resolveAttestedPath(repoRoot, reportPath)) === null) {
    issues.push(`${markerPath} report_path is missing: ${reportPath}`);
  }
  const inboxPath = marker.inbox_item_path;
  if (typeof inboxPath !== "string" || inboxPath.trim().length === 0) {
    issues.push(`${markerPath} must include string inbox_item_path.`);
  } else {
    const resolved = await resolveAttestedPath(repoRoot, inboxPath);
    if (resolved === null) {
      const candidate = await findInboxDirectiveByBasename(
        repoRoot,
        path.posix.basename(normalizeRelPath(inboxPath)),
      );
      if (candidate !== null) {
        issues.push(
          `${markerPath} inbox_item_path is stale: ${inboxPath} (found ${candidate}).`,
        );
      } else {
        issues.push(`${markerPath} inbox_item_path is missing: ${inboxPath}`);
      }
    }
  }
  return { markerPath, issues };
}

export interface PanCheckEntry {
  id: string;
  label: string;
  command: string;
  status: "pass" | "fail" | "skip";
  exitCode?: number;
  remediation?: string;
}

export interface PanCheckResult {
  command: "check";
  status: "ok" | "fail";
  passCount: number;
  failCount: number;
  skipCount: number;
  checks: PanCheckEntry[];
}

/** @deprecated Renamed to {@link PanCheckEntry}. */
export type PanDoctorCheck = PanCheckEntry;

/** @deprecated Renamed to {@link PanCheckResult}. */
export type PanDoctorResult = PanCheckResult;

export const PAN_CHECK_REPO_CHECK_IDS = [
  "active-fd-artifacts",
  "work-archive-hygiene",
  "shipped-ledger-cap",
  "introspection-path-attestation",
  "cursorindexingignore",
] as const;

export function panCheckRegistry(): readonly string[] {
  return [
    ...PAN_CHECK_SHELL_CHECKS.map((spec) => spec.id),
    ...PAN_CHECK_REPO_CHECK_IDS,
  ];
}

/** @deprecated Renamed to {@link panCheckRegistry}. */
export const panDoctorCheckRegistry = panCheckRegistry;

const PAN_CHECK_SHELL_CHECKS: ReadonlyArray<{
  id: string;
  label: string;
  command: string;
}> = [
  { id: "build", label: "pnpm run build", command: "pnpm run build" },
  { id: "lint", label: "pnpm lint", command: "pnpm lint" },
  {
    id: "lint-deps",
    label: "pnpm run lint:deps",
    command: "pnpm run lint:deps",
  },
  { id: "typecheck", label: "pnpm typecheck", command: "pnpm typecheck" },
  { id: "attw", label: "pnpm run attw", command: "pnpm run attw" },
  { id: "publint", label: "pnpm run publint", command: "pnpm run publint" },
  { id: "test", label: "pnpm test", command: "pnpm test" },
  {
    id: "tests-mjs",
    label: "node --test tests/*.test.mjs",
    command: "node --test tests/*.test.mjs",
  },
  {
    id: "compliance",
    label: "node lib/internal/tools/compliance/run-compliance.mjs",
    command: "node lib/internal/tools/compliance/run-compliance.mjs",
  },
  {
    id: "workspace-contracts",
    label: "node lib/internal/tools/checks/check-workspace-contracts.mjs",
    command: "node lib/internal/tools/checks/check-workspace-contracts.mjs",
  },
  {
    id: "context-budget-report",
    label: "node lib/internal/tools/context/context-budget-report.mjs",
    command: "node lib/internal/tools/context/context-budget-report.mjs",
  },
  {
    id: "operator-output",
    label: "node lib/internal/tools/checks/check-operator-output.mjs",
    command: "node lib/internal/tools/checks/check-operator-output.mjs",
  },
];

const COMPLIANCE_EXIT_CHECK_IDS = new Set([
  "lint",
  "typecheck",
  "test",
  "tests-mjs",
]);

export function complianceStageExitCheckBundle(): ReadonlyArray<{
  id: string;
  label: string;
  command: string;
}> {
  return PAN_CHECK_SHELL_CHECKS.filter((spec) =>
    COMPLIANCE_EXIT_CHECK_IDS.has(spec.id),
  );
}

export function complianceStageExitCommands(): readonly string[] {
  return complianceStageExitCheckBundle().map((spec) => spec.command);
}

function runShellCheck(
  repoRoot: string,
  spec: { id: string; label: string; command: string },
): PanCheckEntry {
  const result = spawnSync(spec.command, {
    cwd: repoRoot,
    shell: true,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exitCode = result.status ?? 1;
  if (exitCode === 0) {
    return {
      id: spec.id,
      label: spec.label,
      command: spec.command,
      status: "pass",
      exitCode: 0,
    };
  }
  return {
    id: spec.id,
    label: spec.label,
    command: spec.command,
    status: "fail",
    exitCode,
    remediation: `cd ${repoRoot} && ${spec.command}`,
  };
}

function countShippedLedgerDataRows(currentMd: string): number {
  const header = "## Most recent shipped Features\n";
  const idx = currentMd.indexOf(header);
  if (idx === -1) {
    return 0;
  }
  const tail = currentMd.slice(idx + header.length);
  const relNext = tail.search(/\n## /u);
  const inner = relNext === -1 ? tail : tail.slice(0, relNext);
  return inner
    .split("\n")
    .filter(
      (line) =>
        line.startsWith("|") &&
        !line.includes("---") &&
        !/^\|\s*Feature\s*\|/u.test(line) &&
        !/^\|\s*`—`\s*\|/u.test(line),
    ).length;
}

async function listActiveFeatureDeliveryStates(
  repoRoot: string,
): Promise<
  Array<{ taskId: string; stage: string; state: FeatureDeliveryState }>
> {
  const workRoot = resolveProjectPath(repoRoot, ".pan/work");
  const active: Array<{
    taskId: string;
    stage: string;
    state: FeatureDeliveryState;
  }> = [];
  const dayDirs = await listCanonicalWorkDayDirs(workRoot);
  for (const dayDir of dayDirs) {
    const dayAbs = path.join(workRoot, dayDir);
    const taskDirs = await listTaskDirNames(dayAbs);
    for (const taskId of taskDirs) {
      const stateAbs = path.join(dayAbs, taskId, "state.json");
      if (!existsSync(stateAbs)) {
        continue;
      }
      const state = await readFeatureDeliveryState(stateAbs);
      if (state.pipelineId !== "feature-delivery") {
        continue;
      }
      if (state.status === "closed" || state.currentStage === TERMINAL_STAGE) {
        continue;
      }
      active.push({ taskId, stage: state.currentStage, state });
    }
  }
  return active;
}

export async function runPanCheck(
  repoRootInput: string,
): Promise<PanCheckResult> {
  const repoRoot = path.resolve(repoRootInput);
  const checks: PanCheckEntry[] = PAN_CHECK_SHELL_CHECKS.map((spec) =>
    runShellCheck(repoRoot, spec),
  );

  const activeRuns = await listActiveFeatureDeliveryStates(repoRoot);
  if (activeRuns.length === 0) {
    checks.push({
      id: "active-fd-artifacts",
      label: "Active feature-delivery artifact content validation",
      command: "(no active runs)",
      status: "skip",
      remediation: "No active feature-delivery state under .pan/work/",
    });
  } else {
    const artifactIssues: string[] = [];
    for (const run of activeRuns) {
      const validation = validateStageCompletionArtifacts(
        repoRoot,
        run.state,
        run.stage,
      );
      for (const missing of validation.missing) {
        artifactIssues.push(
          `${run.taskId}/${run.stage}: missing required artifact ${missing}`,
        );
      }
      if (validation.warningCount > 0) {
        for (const warning of validation.warnings) {
          artifactIssues.push(
            `${run.taskId}/${run.stage}: ${warning.path} — ${warning.message}`,
          );
        }
      }
    }
    if (artifactIssues.length === 0) {
      checks.push({
        id: "active-fd-artifacts",
        label: "Active feature-delivery artifact content validation",
        command: "pan artifacts validate (read-only aggregate)",
        status: "pass",
        exitCode: 0,
      });
    } else {
      checks.push({
        id: "active-fd-artifacts",
        label: "Active feature-delivery artifact content validation",
        command: "pan artifacts validate <taskId> --stage <stage>",
        status: "fail",
        exitCode: 1,
        remediation: artifactIssues.join("; "),
      });
    }
  }

  const hygiene = await scanWorkArchiveHygiene(repoRoot);
  if (hygiene.issues.length === 0) {
    checks.push({
      id: "work-archive-hygiene",
      label: ".pan/work/ vs .pan/archive/work/ feature-delivery hygiene",
      command: "scanWorkArchiveHygiene (read-only)",
      status: "pass",
      exitCode: 0,
    });
  } else {
    checks.push({
      id: "work-archive-hygiene",
      label: ".pan/work/ vs .pan/archive/work/ feature-delivery hygiene",
      command: `issues=${hygiene.issues.length} pending_close=${hygiene.pendingCloseCount}`,
      status: "fail",
      exitCode: 1,
      remediation: formatWorkArchiveHygieneRemediation(hygiene.issues),
    });
  }

  const currentPath = resolveProjectPath(
    repoRoot,
    "lib",
    "memory",
    "active",
    "current.md",
  );
  if (!existsSync(currentPath)) {
    checks.push({
      id: "shipped-ledger-cap",
      label: "Shipped-ledger row cap on lib/memory/active/current.md",
      command: currentPath,
      status: "fail",
      exitCode: 1,
      remediation: `Restore ${currentPath} or run pnpm -w exec pan refresh-active-memory`,
    });
  } else {
    const currentMd = await readFile(currentPath, "utf8");
    const rowCount = countShippedLedgerDataRows(currentMd);
    if (rowCount > SHIPPED_LEDGER_ROW_CAP) {
      checks.push({
        id: "shipped-ledger-cap",
        label: "Shipped-ledger row cap on lib/memory/active/current.md",
        command: `count=${rowCount} cap=${SHIPPED_LEDGER_ROW_CAP}`,
        status: "fail",
        exitCode: 1,
        remediation: `pnpm -w exec pan refresh-active-memory --dry-run (cap is ${SHIPPED_LEDGER_ROW_CAP} data rows)`,
      });
    } else {
      checks.push({
        id: "shipped-ledger-cap",
        label: "Shipped-ledger row cap on lib/memory/active/current.md",
        command: `rows=${rowCount} cap=${SHIPPED_LEDGER_ROW_CAP}`,
        status: "pass",
        exitCode: 0,
      });
    }
  }

  const ignorePath = path.join(repoRoot, ".cursorindexingignore");
  if (!existsSync(ignorePath)) {
    checks.push({
      id: "cursorindexingignore",
      label: ".cursorindexingignore availability",
      command: ignorePath,
      status: "fail",
      exitCode: 1,
      remediation: `Restore ${ignorePath} at the repository root`,
    });
  } else {
    checks.push({
      id: "cursorindexingignore",
      label: ".cursorindexingignore availability",
      command: ignorePath,
      status: "pass",
      exitCode: 0,
    });
  }

  const introspectionAttestation = await introspectionPathAttestationIssues(
    repoRoot,
  );
  if (introspectionAttestation.markerPath === null) {
    checks.push({
      id: "introspection-path-attestation",
      label: "Introspection last-run path attestation",
      command: "(no introspection marker)",
      status: "skip",
      remediation: "Run /introspect once to initialize .pan/introspection/last-run.json",
    });
  } else if (introspectionAttestation.issues.length === 0) {
    checks.push({
      id: "introspection-path-attestation",
      label: "Introspection last-run path attestation",
      command: introspectionAttestation.markerPath,
      status: "pass",
      exitCode: 0,
    });
  } else {
    checks.push({
      id: "introspection-path-attestation",
      label: "Introspection last-run path attestation",
      command: introspectionAttestation.markerPath,
      status: "fail",
      exitCode: 1,
      remediation: introspectionAttestation.issues.join("; "),
    });
  }

  const passCount = checks.filter((c) => c.status === "pass").length;
  const failCount = checks.filter((c) => c.status === "fail").length;
  const skipCount = checks.filter((c) => c.status === "skip").length;
  return {
    command: "check",
    status: failCount === 0 ? "ok" : "fail",
    passCount,
    failCount,
    skipCount,
    checks,
  };
}

/** @deprecated Renamed to {@link runPanCheck}. */
export const runPanDoctor = runPanCheck;
