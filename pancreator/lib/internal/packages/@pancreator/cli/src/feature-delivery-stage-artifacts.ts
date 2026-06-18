import { readFileSync } from "node:fs";
import { resolveRepoPath } from "@pancreator/core";
import path from "node:path";
import { existsSync } from "node:fs";

import {
  OPERATOR_VERIFICATION_FILENAME,
  validateOperatorVerificationMarkdown,
} from "./operator-verification.js";

import {
  designAcceptanceCriteriaRel,
  designPlanRel,
  designQaReportRel,
  designStepsEnabled,
  manualQaTestCasesRel,
  productAcceptanceCriteriaRel,
  productPlanRel,
  techAcceptanceCriteriaRel,
  techPlanRel,
  uxSpecRel,
} from "./design-steps.js";
import type { FeatureDeliveryDesignOptions } from "./design-steps.js";
import {
  validateComplianceForAdvance,
  validateDesignQaForAdvance,
  validateHandoffMarkdown,
  validateImplementationReport,
  validatePlanMarkdown,
  validateReviewMarkdownForAdvance,
  validateTestReportForAdvance,
  validateTouchSetJson,
} from "./feature-delivery-gate-validation.js";

/** Minimal state slice for artifact path resolution without importing feature-delivery-run. */
export interface FeatureDeliveryArtifactState {
  featureId: string;
  artifacts: {
    runDir: string;
    handoffFile?: string;
  };
  options?: FeatureDeliveryDesignOptions;
}

function handoffPath(state: FeatureDeliveryArtifactState): string {
  return (
    state.artifacts.handoffFile ??
    path.posix.join(state.artifacts.runDir, "handoff.md")
  );
}

export function durableFeatureCategory(featureId: string): string {
  if (
    featureId.startsWith("command-center-") ||
    featureId.startsWith("surface-opt-p9") ||
    featureId.startsWith("surface-opt-p10") ||
    featureId.startsWith("v0-ui-dashboard")
  ) {
    return "command-center";
  }
  if (
    featureId.startsWith("active-memory") ||
    featureId.includes("token-economy") ||
    featureId.includes("memory")
  ) {
    return "memory-context";
  }
  if (
    featureId.startsWith("pancreator-") ||
    featureId.startsWith("m1-substrate-runtime")
  ) {
    return "platform-substrate";
  }
  if (
    featureId.includes("compliance") ||
    featureId.includes("json-formatting") ||
    featureId.includes("timestamp") ||
    featureId.includes("verification")
  ) {
    return "quality-governance";
  }
  if (
    featureId.includes("pipeline") ||
    featureId.includes("inbox") ||
    featureId.includes("dogfood") ||
    featureId.includes("sdk")
  ) {
    return "delivery-pipeline";
  }
  return "bootstrap-repo-ops";
}

export function durableFeatureIndexRel(featureId: string): string {
  return path.posix.join(
    "lib",
    "memory",
    "features",
    durableFeatureCategory(featureId),
    featureId,
    "index.json",
  );
}

export function deliveryReportRel(runDir: string): string {
  return path.posix.join(runDir, "delivery-report.md");
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

interface OutputManifestExpectation {
  stageContract?: string;
  requiredDocs?: readonly string[];
}

const STAGE_IDS = [
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

const SHIP_RATIFICATION_REQUIRED_KEYS = [
  "task_id",
  "human_ratified_diff",
] as const;

export const COMPLIANCE_STAGE_EXIT_COMMANDS = [
  "pnpm lint",
  "pnpm typecheck",
  "pnpm test",
  "node --test tests/*.test.mjs",
] as const;

const MARKDOWN_OUTPUT_MANIFEST_REQUIRED_BASENAMES = new Set([
  "plan.md",
  "acceptance-criteria.md",
  "manual-qa-test-cases.md",
  "adr-draft.md",
  "handoff.md",
  "implementation-report.md",
  "review.md",
  "test-report.md",
  "design-qa-report.md",
  "ux-spec.md",
  "delivery-report.md",
]);

const OUTPUT_MANIFEST_REQUIRED_FIELDS = [
  "persona_contract",
  "stage_contract",
  "required_docs",
  "consulted_docs",
  "produced_artifacts",
  "scope_amendments",
  "validation",
  "definition_of_done",
  "gate_decision",
  "remediation_route",
] as const;

const CONTRACT_KEY_PATTERN = /^(DOC|PIPE|PERSONA)\.[A-Z0-9_]+(?:\.[A-Z0-9_]+)*$/u;

const OUTPUT_MANIFEST_EXPECTATIONS: Record<string, OutputManifestExpectation> = {
  "implementation-report.md": {
    stageContract: "PIPE.FEATURE_DELIVERY.IMPLEMENT",
    requiredDocs: [
      "DOC.AGENTS",
      "DOC.REGISTRY",
      "DOC.PERSONA_CONTRACTS",
      "DOC.OUTPUT_MANIFEST",
      "DOC.PIPELINE_STATE",
      "DOC.ENG_SOFTWARE",
      "DOC.ENG_TYPESCRIPT",
      "DOC.COMPLIANCE_RUNS",
    ],
  },
  "review.md": {
    stageContract: "PIPE.FEATURE_DELIVERY.REVIEW",
    requiredDocs: [
      "DOC.AGENTS",
      "DOC.REGISTRY",
      "DOC.PERSONA_CONTRACTS",
      "DOC.OUTPUT_MANIFEST",
      "DOC.PIPELINE_STATE",
      "DOC.ENG_SOFTWARE",
      "DOC.ENG_TYPESCRIPT",
      "DOC.COMPLIANCE_RUNS",
    ],
  },
  "test-report.md": {
    stageContract: "PIPE.FEATURE_DELIVERY.TEST",
    requiredDocs: [
      "DOC.AGENTS",
      "DOC.REGISTRY",
      "DOC.PERSONA_CONTRACTS",
      "DOC.OUTPUT_MANIFEST",
      "DOC.PIPELINE_STATE",
      "DOC.ENG_SOFTWARE",
      "DOC.ENG_TYPESCRIPT",
      "DOC.DESIGN_CRAFT",
      "DOC.COMPLIANCE_RUNS",
    ],
  },
  "delivery-report.md": {
    stageContract: "PIPE.FEATURE_DELIVERY.REPORT",
    requiredDocs: [
      "DOC.AGENTS",
      "DOC.REGISTRY",
      "DOC.PERSONA_CONTRACTS",
      "DOC.OUTPUT_MANIFEST",
      "DOC.OPERATOR_OUTPUT",
      "DOC.RUN_LOG_SCHEMA",
    ],
  },
  "compliance-result.json": {
    stageContract: "PIPE.FEATURE_DELIVERY.COMPLIANCE",
    requiredDocs: [
      "DOC.AGENTS",
      "DOC.REGISTRY",
      "DOC.PERSONA_CONTRACTS",
      "DOC.OUTPUT_MANIFEST",
      "DOC.PIPELINE_STATE",
      "DOC.COMPLIANCE_RUNS",
      "DOC.RUN_LOG_SCHEMA",
    ],
  },
};

function parseManifestList(raw: string | null): string[] {
  if (raw === null) {
    return [];
  }
  if (raw.trim().toLowerCase() === "none") {
    return [];
  }
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function isContractKey(value: string): boolean {
  return CONTRACT_KEY_PATTERN.test(value);
}

function outputManifestExpectation(base: string): OutputManifestExpectation | null {
  return OUTPUT_MANIFEST_EXPECTATIONS[base] ?? null;
}

function validateManifestContractKeys(input: {
  rel: string;
  base: string;
  stageContract: string | null;
  requiredDocs: string[];
  consultedDocs: string[];
}): ArtifactContentWarning | null {
  if (input.requiredDocs.some((value) => !isContractKey(value))) {
    return {
      path: input.rel,
      code: "output_manifest_noncompliant",
      message: `${input.base} output manifest required_docs must use DOC.*/PIPE.*/PERSONA.* keys only.`,
    };
  }
  if (input.consultedDocs.some((value) => !isContractKey(value))) {
    return {
      path: input.rel,
      code: "output_manifest_noncompliant",
      message: `${input.base} output manifest consulted_docs must use DOC.*/PIPE.*/PERSONA.* keys only.`,
    };
  }
  if (!input.consultedDocs.includes("DOC.OUTPUT_MANIFEST")) {
    return {
      path: input.rel,
      code: "output_manifest_noncompliant",
      message: `${input.base} output manifest consulted_docs must include DOC.OUTPUT_MANIFEST.`,
    };
  }
  for (const required of input.requiredDocs) {
    if (!input.consultedDocs.includes(required)) {
      return {
        path: input.rel,
        code: "output_manifest_noncompliant",
        message: `${input.base} output manifest consulted_docs must cover required_docs including ${required}.`,
      };
    }
  }
  const expectation = outputManifestExpectation(input.base);
  if (expectation?.stageContract !== undefined && input.stageContract !== expectation.stageContract) {
    return {
      path: input.rel,
      code: "output_manifest_noncompliant",
      message: `${input.base} output manifest stage_contract must be ${expectation.stageContract}.`,
    };
  }
  for (const required of expectation?.requiredDocs ?? []) {
    if (!input.requiredDocs.includes(required)) {
      return {
        path: input.rel,
        code: "output_manifest_noncompliant",
        message: `${input.base} output manifest required_docs must include ${required}.`,
      };
    }
  }
  return null;
}

function readMarkdownManifestField(content: string, field: string): string | null {
  const match = content.match(new RegExp(`^-\\s*${field}:\\s*(.+)$`, "imu"));
  return match === null ? null : match[1].trim();
}

function artifactParentDir(rel: string): string {
  return path.posix.basename(path.posix.dirname(rel));
}

function isCompanionDisciplineArtifact(rel: string): boolean {
  const parent = artifactParentDir(rel);
  return parent === "product" || parent === "design" || parent === "tech";
}

function validateMarkdownOutputManifest(
  rel: string,
  base: string,
  content: string,
): ArtifactContentWarning | null {
  if (!MARKDOWN_OUTPUT_MANIFEST_REQUIRED_BASENAMES.has(base)) {
    return null;
  }
  if (!/^##\s+Output manifest\b/imu.test(content)) {
    return {
      path: rel,
      code: "output_manifest_missing",
      message: `${base} must include ## Output manifest per DOC.OUTPUT_MANIFEST.`,
    };
  }
  for (const field of OUTPUT_MANIFEST_REQUIRED_FIELDS) {
    if (!new RegExp(`^-\\s*${field}:`, "imu").test(content)) {
      return {
        path: rel,
        code: "output_manifest_incomplete",
        message: `${base} ## Output manifest must include ${field}.`,
      };
    }
  }
  return validateManifestContractKeys({
    rel,
    base,
    stageContract: readMarkdownManifestField(content, "stage_contract"),
    requiredDocs: parseManifestList(readMarkdownManifestField(content, "required_docs")),
    consultedDocs: parseManifestList(readMarkdownManifestField(content, "consulted_docs")),
  });
}

function validateJsonOutputManifest(
  rel: string,
  record: Record<string, unknown>,
): ArtifactContentWarning | null {
  const manifest = record.output_manifest;
  if (
    manifest === null ||
    typeof manifest !== "object" ||
    Array.isArray(manifest)
  ) {
    return {
      path: rel,
      code: "output_manifest_missing",
      message: `${path.posix.basename(rel)} must include top-level output_manifest per DOC.OUTPUT_MANIFEST.`,
    };
  }
  const manifestRecord = manifest as Record<string, unknown>;
  for (const field of OUTPUT_MANIFEST_REQUIRED_FIELDS) {
    if (!(field in manifestRecord)) {
      return {
        path: rel,
        code: "output_manifest_incomplete",
        message: `${path.posix.basename(rel)} output_manifest must include ${field}.`,
      };
    }
  }
  return validateManifestContractKeys({
    rel,
    base: path.posix.basename(rel),
    stageContract:
      typeof manifestRecord.stage_contract === "string"
        ? manifestRecord.stage_contract.trim()
        : null,
    requiredDocs: Array.isArray(manifestRecord.required_docs)
      ? manifestRecord.required_docs.filter(
          (value): value is string => typeof value === "string" && value.trim().length > 0,
        )
      : [],
    consultedDocs: Array.isArray(manifestRecord.consulted_docs)
      ? manifestRecord.consulted_docs.filter(
          (value): value is string => typeof value === "string" && value.trim().length > 0,
        )
      : [],
  });
}

export function isFeatureDeliveryStageId(
  stage: string,
): stage is FeatureDeliveryStageId {
  return (STAGE_IDS as readonly string[]).includes(stage);
}

export function parseReviewPassesVerdict(
  reviewMarkdown: string,
): boolean | null {
  const match = reviewMarkdown.match(/review_passes:\s*(true|false)/iu);
  if (match === null) {
    return null;
  }
  return match[1].toLowerCase() === "true";
}

export function parseReviewGateOutcome(reviewMarkdown: string): {
  passes: boolean | null;
  coreReentryRequired: boolean;
  scopeAmendmentsRatified: boolean;
  spotFixable: boolean;
  excludedFromGate: boolean;
} {
  return {
    passes: parseReviewPassesVerdict(reviewMarkdown),
    coreReentryRequired: /core_reentry_required:\s*true/iu.test(reviewMarkdown),
    scopeAmendmentsRatified: /scope_amendments_ratified:\s*true/iu.test(
      reviewMarkdown,
    ),
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
    planInvalidating:
      planMatch !== null && planMatch[1].toLowerCase() === "true",
    coreReentryRequired: /core_reentry_required:\s*true/iu.test(testMarkdown),
    spotFixable: /spot_fixable:\s*true/iu.test(testMarkdown),
    excludedFromGate: /excluded_from_gate:\s*true/iu.test(testMarkdown),
  };
}

export function parseDesignQaVerdict(designQaMarkdown: string): {
  passes: boolean | null;
  planInvalidating: boolean;
  coreReentryRequired: boolean;
  spotFixable: boolean;
  excludedFromGate: boolean;
} {
  const passMatch = designQaMarkdown.match(
    /design_qa_passes:\s*(true|false)/iu,
  );
  const planMatch = designQaMarkdown.match(
    /plan_invalidating:\s*(true|false)/iu,
  );
  return {
    passes: passMatch === null ? null : passMatch[1].toLowerCase() === "true",
    planInvalidating:
      planMatch !== null && planMatch[1].toLowerCase() === "true",
    coreReentryRequired: /core_reentry_required:\s*true/iu.test(
      designQaMarkdown,
    ),
    spotFixable: /spot_fixable:\s*true/iu.test(designQaMarkdown),
    excludedFromGate: /excluded_from_gate:\s*true/iu.test(designQaMarkdown),
  };
}

export function mergedTestStageVerdict(input: {
  qaMarkdown: string;
  designQaMarkdown?: string;
  designSteps: boolean;
}): {
  passes: boolean | null;
  planInvalidating: boolean;
  coreReentryRequired: boolean;
  spotFixable: boolean;
  excludedFromGate: boolean;
} {
  const qa = parseQaVerdict(input.qaMarkdown);
  if (!input.designSteps) {
    return qa;
  }
  if (input.designQaMarkdown === undefined) {
    return { ...qa, passes: qa.passes === true ? null : qa.passes };
  }
  const design = parseDesignQaVerdict(input.designQaMarkdown);
  if (qa.passes === false) {
    return qa;
  }
  if (design.passes === false) {
    return {
      passes: false,
      planInvalidating: design.planInvalidating,
      coreReentryRequired: design.coreReentryRequired,
      spotFixable: design.spotFixable,
      excludedFromGate: design.excludedFromGate,
    };
  }
  if (qa.passes === true && design.passes === true) {
    return {
      passes: true,
      planInvalidating: false,
      coreReentryRequired: false,
      spotFixable: false,
      excludedFromGate: false,
    };
  }
  return { ...qa, passes: null };
}

function readBool(
  record: Record<string, unknown>,
  key: string,
): boolean | null {
  const value = record[key];
  return typeof value === "boolean" ? value : null;
}

function parseFinalGateExitCodes(value: unknown): {
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
  const failingFinalGateCommands = COMPLIANCE_STAGE_EXIT_COMMANDS.filter(
    (command) => {
      const exitCode = finalGate.exitCodes.get(command);
      return typeof exitCode === "number" && exitCode !== 0;
    },
  );
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
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
    ) {
      return parseComplianceVerdictFromRecord(
        parsed as Record<string, unknown>,
      );
    }
  } catch {
    // markdown fallback below
  }
  const passMatch = complianceContent.match(
    /compliance_passes:\s*(true|false)/iu,
  );
  return {
    passes: passMatch === null ? null : passMatch[1].toLowerCase() === "true",
    planInvalidating: /plan_invalidating:\s*true/iu.test(complianceContent),
    coreReentryRequired: /core_reentry_required:\s*true/iu.test(
      complianceContent,
    ),
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
    return {
      path: rel,
      code: "missing_h2",
      message: "markdown must include at least one ## heading",
    };
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

function readMarkdownBoolSeries(content: string, field: string): boolean[] {
  const matches = content.matchAll(new RegExp(`${field}:\\s*(true|false)`, "giu"));
  const values: boolean[] = [];
  for (const match of matches) {
    values.push(match[1]?.toLowerCase() === "true");
  }
  return values;
}

function validateVerdictConsistency(
  rel: string,
  content: string,
  verdictField: string,
): ArtifactContentWarning | null {
  const values = readMarkdownBoolSeries(content, verdictField);
  if (values.length > 1 && values.some((value) => value !== values[0])) {
    return {
      path: rel,
      code: "verdict_conflict",
      message: `${path.posix.basename(rel)} contains conflicting ${verdictField} verdicts.`,
    };
  }
  if (values[0] !== true) {
    return null;
  }
  const gateDecision = readMarkdownManifestField(content, "gate_decision")?.toLowerCase() ?? null;
  const remediationRoute =
    readMarkdownManifestField(content, "remediation_route")?.toLowerCase() ?? null;
  if (gateDecision === "remediate") {
    return {
      path: rel,
      code: "verdict_conflict",
      message: `${path.posix.basename(rel)} cannot pair ${verdictField}: true with gate_decision: remediate.`,
    };
  }
  if (remediationRoute !== null && remediationRoute !== "none") {
    return {
      path: rel,
      code: "verdict_conflict",
      message: `${path.posix.basename(rel)} cannot pair ${verdictField}: true with remediation_route: ${remediationRoute}.`,
    };
  }
  if (/\bP1\b/u.test(content)) {
    return {
      path: rel,
      code: "verdict_conflict",
      message: `${path.posix.basename(rel)} cannot pair ${verdictField}: true with unresolved P1 findings.`,
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

function gateValidationErrorToWarning(
  rel: string,
  message: string,
): ArtifactContentWarning {
  return { path: rel, code: "gate_contract_violation", message };
}

function validateArtifactContent(
  repoRoot: string,
  rel: string,
  event?: string,
): ArtifactContentWarning | null {
  const base = path.posix.basename(rel);
  const content = readRepoText(repoRoot, rel);
  if (content === null) {
    return null;
  }

  if (base === "plan.md" && !isCompanionDisciplineArtifact(rel)) {
    const planError = validatePlanMarkdown(content);
    if (planError !== null) {
      return gateValidationErrorToWarning(rel, planError);
    }
    return (
      validateMarkdownBody(rel, content) ??
      validateMarkdownOutputManifest(rel, base, content)
    );
  }

  if (base === "handoff.md") {
    const handoffError = validateHandoffMarkdown(content);
    if (handoffError !== null) {
      return gateValidationErrorToWarning(rel, handoffError);
    }
    return (
      validateMarkdownBody(rel, content) ??
      validateMarkdownOutputManifest(rel, base, content)
    );
  }

  if (base === "touch-set.json") {
    const touchSetError = validateTouchSetJson(content);
    if (touchSetError !== null) {
      return gateValidationErrorToWarning(rel, touchSetError);
    }
    return null;
  }

  if (base === "implementation-report.md") {
    const implementError = validateImplementationReport(content);
    if (implementError !== null) {
      return gateValidationErrorToWarning(rel, implementError);
    }
    return (
      validateMarkdownBody(rel, content) ??
      validateVerdictConsistency(rel, content, "implement_gate_passes") ??
      validateMarkdownOutputManifest(rel, base, content)
    );
  }

  if (base === "review.md") {
    if (parseReviewPassesVerdict(content) === null) {
      return {
        path: rel,
        code: "review_passes_unparseable",
        message:
          "review.md must contain review_passes: true or review_passes: false",
      };
    }
    if (event !== undefined) {
      const reviewAdvanceError = validateReviewMarkdownForAdvance(
        content,
        event,
      );
      if (reviewAdvanceError !== null) {
        return gateValidationErrorToWarning(rel, reviewAdvanceError);
      }
    }
    return (
      validateVerdictConsistency(rel, content, "review_passes") ??
      validateMarkdownOutputManifest(rel, base, content)
    );
  }

  if (base === "test-report.md") {
    if (parseQaVerdict(content).passes === null) {
      return {
        path: rel,
        code: "qa_passes_unparseable",
        message:
          "test-report.md must contain qa_passes: true or qa_passes: false",
      };
    }
    if (event !== undefined) {
      const testAdvanceError = validateTestReportForAdvance(content, event);
      if (testAdvanceError !== null) {
        return gateValidationErrorToWarning(rel, testAdvanceError);
      }
    }
    return (
      validateVerdictConsistency(rel, content, "qa_passes") ??
      validateMarkdownOutputManifest(rel, base, content)
    );
  }

  if (base === "design-qa-report.md") {
    if (parseDesignQaVerdict(content).passes === null) {
      return {
        path: rel,
        code: "design_qa_passes_unparseable",
        message:
          "design-qa-report.md must contain design_qa_passes: true or design_qa_passes: false",
      };
    }
    if (event !== undefined) {
      const designAdvanceError = validateDesignQaForAdvance(content, event);
      if (designAdvanceError !== null) {
        return gateValidationErrorToWarning(rel, designAdvanceError);
      }
    }
    return (
      validateVerdictConsistency(rel, content, "design_qa_passes") ??
      validateMarkdownOutputManifest(rel, base, content)
    );
  }

  if (base === "ux-spec.md") {
    return (
      validateMarkdownBody(rel, content) ??
      validateMarkdownOutputManifest(rel, base, content)
    );
  }

  if (base === "ship-ratification.json") {
    try {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      for (const key of SHIP_RATIFICATION_REQUIRED_KEYS) {
        if (!(key in parsed)) {
          return {
            path: rel,
            code: "ship_ratification_missing_key",
            message: `ship-ratification.json must include top-level key ${key}`,
          };
        }
      }
      if (parsed.human_ratified_diff !== true) {
        return {
          path: rel,
          code: "ship_ratification_not_ratified",
          message:
            "ship-ratification.json must set human_ratified_diff to true",
        };
      }
    } catch {
      return {
        path: rel,
        code: "ship_ratification_invalid_json",
        message: "ship-ratification.json must parse as JSON",
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
        message:
          "compliance-result.json must include compliance_passes: true or compliance_passes: false",
      };
    }
    if (!verdict.finalGateObserved) {
      return {
        path: rel,
        code: "compliance_final_gate_missing",
        message:
          "compliance-result.json must include final_gate results for the compliance exit bundle",
      };
    }
    if (event !== undefined) {
      const complianceAdvanceError = validateComplianceForAdvance(
        content,
        event,
      );
      if (complianceAdvanceError !== null) {
        return gateValidationErrorToWarning(rel, complianceAdvanceError);
      }
    }
    try {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      return validateJsonOutputManifest(rel, parsed);
    } catch {
      return null;
    }
  }

  const manifestWarning = validateMarkdownOutputManifest(rel, base, content);
  if (manifestWarning !== null) {
    return manifestWarning;
  }

  if (base === OPERATOR_VERIFICATION_FILENAME) {
    const shape = validateOperatorVerificationMarkdown(content);
    if (!shape.ok) {
      return {
        path: rel,
        code: "operator_verification_shape",
        message: shape.warnings.join("; "),
      };
    }
    return null;
  }

  if (base === "ux-spec.md") {
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
    case "plan": {
      const plan = path.posix.join(run, "plan.md");
      const adr = path.posix.join(run, "adr-draft.md");
      const touchSet = path.posix.join(run, "touch-set.json");
      const handoff = handoffPath(state);
      const requiredAfterStageWork = [
        productPlanRel(run),
        productAcceptanceCriteriaRel(run),
        techPlanRel(run),
        techAcceptanceCriteriaRel(run),
        manualQaTestCasesRel(run),
        plan,
        adr,
        touchSet,
        handoff,
        ...(designStepsEnabled(state.options)
          ? [
              designPlanRel(run),
              designAcceptanceCriteriaRel(run),
              uxSpecRel(run),
            ]
          : []),
      ];
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
      if (
        event !== "review_passes" &&
        event !== "must_fix" &&
        event !== "review_spot_fix" &&
        event !== "review_core_reentry"
      ) {
        throw new Error(
          `Review stage only supports review_passes, must_fix, review_spot_fix, or review_core_reentry, got ${event}.`,
        );
      }
      return {
        primaryArtifact: review,
        requiredAfterStageWork: [review],
        acceptedAdvanceArtifacts: [review],
      };
    }
    case "test": {
      const testReport = path.posix.join(run, "test-report.md");
      const designReport = designQaReportRel(run);
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
      const requiredAfterStageWork = designStepsEnabled(state.options)
        ? [testReport, designReport]
        : [testReport];
      return {
        primaryArtifact: testReport,
        requiredAfterStageWork,
        acceptedAdvanceArtifacts: [testReport],
      };
    }
    case "report": {
      const deliveryReport = deliveryReportRel(run);
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
      const ratification = path.posix.join(run, "ship-ratification.json");
      return {
        primaryArtifact: ratification,
        requiredAfterStageWork: [ratification],
        acceptedAdvanceArtifacts: [ratification],
      };
    }
    case "index": {
      const index = durableFeatureIndexRel(state.featureId);
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
  "acceptance-criteria.md",
  "manual-qa-test-cases.md",
  "handoff.md",
  "touch-set.json",
  "implementation-report.md",
  "review.md",
  "test-report.md",
  "design-qa-report.md",
  "ux-spec.md",
  "compliance-result.json",
  "ship-ratification.json",
  OPERATOR_VERIFICATION_FILENAME,
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

function assertAdvanceGateContent(
  repoRoot: string,
  state: FeatureDeliveryArtifactState,
  stage: string,
  artifact: string,
  event: string,
): void {
  const advanceArtifacts = [artifact];
  if (
    stage === "test" &&
    event === "qa_passes" &&
    designStepsEnabled(state.options)
  ) {
    advanceArtifacts.push(designQaReportRel(state.artifacts.runDir));
  }
  for (const rel of advanceArtifacts) {
    const warning = validateArtifactContent(repoRoot, rel, event);
    if (warning !== null) {
      throw new Error(
        `Cannot advance ${stage} on ${event}; ${warning.message}`,
      );
    }
  }
  if (stage === "implement" && event === "implementation_complete") {
    const reportRel = path.posix.join(
      state.artifacts.runDir,
      "implementation-report.md",
    );
    const content = readRepoText(repoRoot, reportRel);
    if (content !== null && !/implement_gate_passes:\s*true/iu.test(content)) {
      throw new Error(
        "Cannot advance implement; implementation-report.md must record implement_gate_passes: true before review handoff.",
      );
    }
  }
  if (stage === "plan" && event === "human_approval") {
    for (const rel of contractPlanGateArtifacts(state)) {
      const warning = validateArtifactContent(repoRoot, rel, event);
      if (warning !== null) {
        throw new Error(`Cannot advance plan; ${warning.message}`);
      }
    }
  }
}

function contractPlanGateArtifacts(
  state: FeatureDeliveryArtifactState,
): string[] {
  return [...stageArtifactContract(state, "plan").requiredAfterStageWork];
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
      throw new Error(
        `Cannot advance ${stage}; required artifact is missing: ${required}.`,
      );
    }
  }
  assertAdvanceGateContent(repoRoot, state, stage, artifact, event);
}

export function defaultAdvanceEventForStage(stage: string): string {
  switch (stage) {
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
