import { readFileSync } from "node:fs";
import { resolveRepoPath } from "@pancreator/core";
import path from "node:path";
import { existsSync } from "node:fs";

/** Minimal state slice for artifact path resolution without importing feature-delivery-run. */
export interface FeatureDeliveryArtifactState {
  featureId: string;
  artifacts: {
    runDir: string;
    handoffFile?: string;
  };
}

function handoffPath(state: FeatureDeliveryArtifactState): string {
  return state.artifacts.handoffFile ?? path.posix.join(state.artifacts.runDir, "handoff.md");
}

export interface StageArtifactContract {
  /** Primary artifact referenced on advance commands and in run logs. */
  primaryArtifact: string;
  /** All repo-relative paths that MUST exist after stage work completes. */
  requiredAfterStageWork: readonly string[];
  /** Paths accepted as `--artifact` on advance for the default stage event. */
  acceptedAdvanceArtifacts: readonly string[];
}

export interface ArtifactContentWarning {
  path: string;
  code: string;
  message: string;
}

export interface StageArtifactValidation {
  ok: boolean;
  missing: string[];
  present: string[];
  warnings: ArtifactContentWarning[];
  warningCount: number;
}

const STAGE_IDS = [
  "intake",
  "plan",
  "implement",
  "review",
  "test",
  "report",
  "compliance",
  "ship",
  "index",
] as const;

export type FeatureDeliveryStageId = (typeof STAGE_IDS)[number];

const POLICY_COMPLIANCE_REQUIRED_KEYS = [
  "task_id",
  "governing_sources_checked",
  "documentation_impact",
  "policy_alignment",
] as const;

export const COMPLIANCE_STAGE_EXIT_COMMANDS = [
  "pnpm lint",
  "pnpm typecheck",
  "pnpm test",
  "node --test tests/*.test.mjs",
] as const;

export function isFeatureDeliveryStageId(stage: string): stage is FeatureDeliveryStageId {
  return (STAGE_IDS as readonly string[]).includes(stage);
}

export function parseReviewPassesVerdict(reviewMarkdown: string): boolean | null {
  const match = reviewMarkdown.match(/review_passes:\s*(true|false)/iu);
  if (match === null) {
    return null;
  }
  return match[1].toLowerCase() === "true";
}

export function parseReviewGateOutcome(reviewMarkdown: string): {
  passes: boolean | null;
  coreReentryRequired: boolean;
  spotFixable: boolean;
  excludedFromGate: boolean;
} {
  return {
    passes: parseReviewPassesVerdict(reviewMarkdown),
    coreReentryRequired: /core_reentry_required:\s*true/iu.test(reviewMarkdown),
    spotFixable: /spot_fixable:\s*true/iu.test(reviewMarkdown),
    excludedFromGate: /excluded_from_gate:\s*true/iu.test(reviewMarkdown),
  };
}

export function parseQaVerdict(testMarkdown: string): {
  passes: boolean | null;
  planInvalidating: boolean;
  coreReentryRequired: boolean;
  spotFixable: boolean;
  excludedFromGate: boolean;
} {
  const passMatch = testMarkdown.match(/qa_passes:\s*(true|false)/iu);
  const planMatch = testMarkdown.match(/plan_invalidating:\s*(true|false)/iu);
  return {
    passes: passMatch === null ? null : passMatch[1].toLowerCase() === "true",
    planInvalidating: planMatch !== null && planMatch[1].toLowerCase() === "true",
    coreReentryRequired: /core_reentry_required:\s*true/iu.test(testMarkdown),
    spotFixable: /spot_fixable:\s*true/iu.test(testMarkdown),
    excludedFromGate: /excluded_from_gate:\s*true/iu.test(testMarkdown),
  };
}

function readBool(record: Record<string, unknown>, key: string): boolean | null {
  const value = record[key];
  return typeof value === "boolean" ? value : null;
}

function parseFinalGateExitCodes(
  value: unknown,
): {
  observed: boolean;
  exitCodes: Map<string, number | null>;
} {
  const exitCodes = new Map<string, number | null>();
  if (value === null || value === undefined) {
    return { observed: false, exitCodes };
  }
  if (Array.isArray(value)) {
    for (const row of value) {
      if (row === null || typeof row !== "object" || Array.isArray(row)) {
        continue;
      }
      const item = row as Record<string, unknown>;
      const command = item.command;
      if (typeof command !== "string" || command.trim().length === 0) {
        continue;
      }
      const exitCode = item.exitCode;
      exitCodes.set(command, typeof exitCode === "number" ? exitCode : null);
    }
    return { observed: exitCodes.size > 0, exitCodes };
  }
  if (typeof value !== "object") {
    return { observed: false, exitCodes };
  }
  const record = value as Record<string, unknown>;
  for (const command of COMPLIANCE_STAGE_EXIT_COMMANDS) {
    const item = record[command];
    if (typeof item === "number") {
      exitCodes.set(command, item);
      continue;
    }
    if (item !== null && typeof item === "object" && !Array.isArray(item)) {
      const exitCode = (item as Record<string, unknown>).exitCode;
      exitCodes.set(command, typeof exitCode === "number" ? exitCode : null);
    }
  }
  return { observed: exitCodes.size > 0, exitCodes };
}

function parseComplianceVerdictFromRecord(record: Record<string, unknown>): {
  passes: boolean | null;
  planInvalidating: boolean;
  coreReentryRequired: boolean;
  spotFixable: boolean;
  excludedFromGate: boolean;
  finalGateObserved: boolean;
  missingFinalGateCommands: string[];
  failingFinalGateCommands: string[];
} {
  let passes = readBool(record, "compliance_passes");
  const status = record.status;
  if (passes === null && typeof status === "string") {
    if (status === "pass") passes = true;
    if (status === "fail") passes = false;
  }
  const finalGate = parseFinalGateExitCodes(record.final_gate);
  const missingFinalGateCommands = COMPLIANCE_STAGE_EXIT_COMMANDS.filter(
    (command) => !finalGate.exitCodes.has(command),
  );
  const failingFinalGateCommands = COMPLIANCE_STAGE_EXIT_COMMANDS.filter((command) => {
    const exitCode = finalGate.exitCodes.get(command);
    return typeof exitCode === "number" && exitCode !== 0;
  });
  return {
    passes,
    planInvalidating: readBool(record, "plan_invalidating") ?? false,
    coreReentryRequired: readBool(record, "core_reentry_required") ?? false,
    spotFixable: readBool(record, "spot_fixable") ?? false,
    excludedFromGate: readBool(record, "excluded_from_gate") ?? false,
    finalGateObserved: finalGate.observed,
    missingFinalGateCommands,
    failingFinalGateCommands,
  };
}

export function parseComplianceVerdict(complianceContent: string): {
  passes: boolean | null;
  planInvalidating: boolean;
  coreReentryRequired: boolean;
  spotFixable: boolean;
  excludedFromGate: boolean;
  finalGateObserved: boolean;
  missingFinalGateCommands: string[];
  failingFinalGateCommands: string[];
} {
  try {
    const parsed = JSON.parse(complianceContent) as unknown;
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parseComplianceVerdictFromRecord(parsed as Record<string, unknown>);
    }
  } catch {
    // markdown fallback below
  }
  const passMatch = complianceContent.match(/compliance_passes:\s*(true|false)/iu);
  return {
    passes: passMatch === null ? null : passMatch[1].toLowerCase() === "true",
    planInvalidating: /plan_invalidating:\s*true/iu.test(complianceContent),
    coreReentryRequired: /core_reentry_required:\s*true/iu.test(complianceContent),
    spotFixable: /spot_fixable:\s*true/iu.test(complianceContent),
    excludedFromGate: /excluded_from_gate:\s*true/iu.test(complianceContent),
    finalGateObserved: false,
    missingFinalGateCommands: [...COMPLIANCE_STAGE_EXIT_COMMANDS],
    failingFinalGateCommands: [],
  };
}

function validateMarkdownBody(
  rel: string,
  content: string,
): ArtifactContentWarning | null {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return { path: rel, code: "empty_markdown", message: "file is empty" };
  }
  const lines = content.split(/\r?\n/u);
  const hasH2 = lines.some((line) => /^##\s+\S/u.test(line));
  if (!hasH2) {
    return { path: rel, code: "missing_h2", message: "markdown must include at least one ## heading" };
  }
  const hasBodyLine = lines.some((line) => {
    const t = line.trim();
    return t.length > 0 && !t.startsWith("#");
  });
  if (!hasBodyLine) {
    return {
      path: rel,
      code: "missing_body",
      message: "markdown must include at least one non-heading content line",
    };
  }
  return null;
}

function readRepoText(repoRoot: string, rel: string): string | null {
  const abs = resolveRepoPath(repoRoot, rel);
  if (!existsSync(abs)) {
    return null;
  }
  return readFileSync(abs, "utf8");
}

function validateArtifactContent(
  repoRoot: string,
  rel: string,
): ArtifactContentWarning | null {
  const base = path.posix.basename(rel);
  const content = readRepoText(repoRoot, rel);
  if (content === null) {
    return null;
  }

  if (base === "review.md") {
    if (parseReviewPassesVerdict(content) === null) {
      return {
        path: rel,
        code: "review_passes_unparseable",
        message: "review.md must contain review_passes: true or review_passes: false",
      };
    }
    return null;
  }

  if (base === "test-report.md") {
    if (parseQaVerdict(content).passes === null) {
      return {
        path: rel,
        code: "qa_passes_unparseable",
        message: "test-report.md must contain qa_passes: true or qa_passes: false",
      };
    }
    return null;
  }

  if (base === "policy-compliance.json") {
    try {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      for (const key of POLICY_COMPLIANCE_REQUIRED_KEYS) {
        if (!(key in parsed)) {
          return {
            path: rel,
            code: "policy_compliance_missing_key",
            message: `policy-compliance.json must include top-level key ${key}`,
          };
        }
      }
    } catch {
      return {
        path: rel,
        code: "policy_compliance_invalid_json",
        message: "policy-compliance.json must parse as JSON",
      };
    }
    return null;
  }

  if (base === "compliance-result.json") {
    const verdict = parseComplianceVerdict(content);
    if (verdict.passes === null) {
      return {
        path: rel,
        code: "compliance_passes_unparseable",
        message: "compliance-result.json must include compliance_passes: true or compliance_passes: false",
      };
    }
    if (!verdict.finalGateObserved) {
      return {
        path: rel,
        code: "compliance_final_gate_missing",
        message: "compliance-result.json must include final_gate results for the compliance exit bundle",
      };
    }
    return null;
  }

  if (base === "plan.md" || base === "implementation-report.md") {
    return validateMarkdownBody(rel, content);
  }

  return null;
}

export function stageArtifactContract(
  state: FeatureDeliveryArtifactState,
  stage: string,
  event = defaultAdvanceEventForStage(stage),
): StageArtifactContract {
  const run = state.artifacts.runDir;
  switch (stage) {
    case "intake": {
      const spec = path.posix.join("lib", "memory", "features", state.featureId, "spec.md");
      return {
        primaryArtifact: spec,
        requiredAfterStageWork: [spec],
        acceptedAdvanceArtifacts: [spec],
      };
    }
    case "plan": {
      const plan = path.posix.join(run, "plan.md");
      const adr = path.posix.join(run, "adr-draft.md");
      const touchSet = path.posix.join(run, "touch-set.json");
      const handoff = handoffPath(state);
      const requiredAfterStageWork = [plan, adr, touchSet, handoff];
      const acceptedAdvanceArtifacts = [plan, touchSet, handoff];
      return {
        primaryArtifact: touchSet,
        requiredAfterStageWork,
        acceptedAdvanceArtifacts,
      };
    }
    case "implement": {
      const report = path.posix.join(run, "implementation-report.md");
      return {
        primaryArtifact: report,
        requiredAfterStageWork: [report],
        acceptedAdvanceArtifacts: [report],
      };
    }
    case "review": {
      const review = path.posix.join(run, "review.md");
      if (event !== "review_passes" && event !== "must_fix" && event !== "review_spot_fix") {
        throw new Error(`Review stage only supports review_passes, must_fix, or review_spot_fix, got ${event}.`);
      }
      return {
        primaryArtifact: review,
        requiredAfterStageWork: [review],
        acceptedAdvanceArtifacts: [review],
      };
    }
    case "test": {
      const testReport = path.posix.join(run, "test-report.md");
      if (
        event !== "qa_passes" &&
        event !== "qa_fails" &&
        event !== "qa_fails_plan_invalidating" &&
        event !== "qa_spot_fix"
      ) {
        throw new Error(
          `Test stage only supports qa_passes, qa_fails, qa_fails_plan_invalidating, or qa_spot_fix, got ${event}.`,
        );
      }
      return {
        primaryArtifact: testReport,
        requiredAfterStageWork: [testReport],
        acceptedAdvanceArtifacts: [testReport],
      };
    }
    case "report": {
      const deliveryReport = path.posix.join(
        "lib",
        "memory",
        "features",
        state.featureId,
        "delivery-report.md",
      );
      return {
        primaryArtifact: deliveryReport,
        requiredAfterStageWork: [deliveryReport],
        acceptedAdvanceArtifacts: [deliveryReport],
      };
    }
    case "compliance": {
      const complianceResult = path.posix.join(run, "compliance-result.json");
      if (
        event !== "compliance_passes" &&
        event !== "compliance_fails" &&
        event !== "compliance_fails_plan_invalidating" &&
        event !== "compliance_spot_fix"
      ) {
        throw new Error(
          "Compliance stage only supports compliance_passes, compliance_fails, " +
            `compliance_fails_plan_invalidating, or compliance_spot_fix, got ${event}.`,
        );
      }
      return {
        primaryArtifact: complianceResult,
        requiredAfterStageWork: [complianceResult],
        acceptedAdvanceArtifacts: [complianceResult],
      };
    }
    case "ship": {
      const policy = path.posix.join(run, "policy-compliance.json");
      return {
        primaryArtifact: policy,
        requiredAfterStageWork: [policy],
        acceptedAdvanceArtifacts: [policy],
      };
    }
    case "index": {
      const index = path.posix.join("lib", "memory", "features", state.featureId, "index.json");
      return {
        primaryArtifact: index,
        requiredAfterStageWork: [index],
        acceptedAdvanceArtifacts: [index],
      };
    }
    default:
      throw new Error(`No artifact contract for stage ${stage}.`);
  }
}

export function primaryArtifactForEnteringStage(
  state: FeatureDeliveryArtifactState,
  stageId: string,
): string {
  return stageArtifactContract(state, stageId).primaryArtifact;
}

export function requiredArtifactsAfterStageWork(
  state: FeatureDeliveryArtifactState,
  stageId: string,
): readonly string[] {
  return stageArtifactContract(state, stageId).requiredAfterStageWork;
}

const CONTENT_VALIDATED_BASENAMES = new Set([
  "plan.md",
  "implementation-report.md",
  "review.md",
  "test-report.md",
  "compliance-result.json",
  "policy-compliance.json",
]);

export function validateStageCompletionArtifacts(
  repoRoot: string,
  state: FeatureDeliveryArtifactState,
  stageId: string,
): StageArtifactValidation {
  const required = requiredArtifactsAfterStageWork(state, stageId);
  const missing: string[] = [];
  const present: string[] = [];
  const warnings: ArtifactContentWarning[] = [];
  for (const rel of required) {
    if (existsSync(resolveRepoPath(repoRoot, rel))) {
      present.push(rel);
      const base = path.posix.basename(rel);
      if (CONTENT_VALIDATED_BASENAMES.has(base)) {
        const warning = validateArtifactContent(repoRoot, rel);
        if (warning !== null) {
          warnings.push(warning);
        }
      }
    } else {
      missing.push(rel);
    }
  }
  return {
    ok: missing.length === 0,
    missing,
    present,
    warnings,
    warningCount: warnings.length,
  };
}

export function assertAdvanceArtifacts(
  repoRoot: string,
  state: FeatureDeliveryArtifactState,
  stage: string,
  artifact: string,
  event: string,
): void {
  const contract = stageArtifactContract(state, stage, event);
  if (!contract.acceptedAdvanceArtifacts.includes(artifact)) {
    throw new Error(
      `Artifact ${artifact} is not valid for ${stage} on ${event}; expected one of: ${contract.acceptedAdvanceArtifacts.join(", ")}.`,
    );
  }
  for (const required of contract.requiredAfterStageWork) {
    if (!existsSync(resolveRepoPath(repoRoot, required))) {
      throw new Error(`Cannot advance ${stage}; required artifact is missing: ${required}.`);
    }
  }
}

export function defaultAdvanceEventForStage(stage: string): string {
  switch (stage) {
    case "intake":
    case "plan":
      return "human_approval";
    case "implement":
      return "implementation_complete";
    case "review":
      return "review_passes";
    case "test":
      return "qa_passes";
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
