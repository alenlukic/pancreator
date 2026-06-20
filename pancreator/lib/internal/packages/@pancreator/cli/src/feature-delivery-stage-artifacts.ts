import { readFileSync } from "node:fs";
import { resolveRepoPath } from "@pancreator/core";
import path from "node:path";
import { existsSync } from "node:fs";

import { readPanWorkMarkdown } from "./pan-work-artifact.js";
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
  validateHighRiskPersonaTranscriptCompliance,
  validateImplementationReport,
  validatePlanMarkdown,
  validateReviewMarkdownForAdvance,
  validateQaDesignFollowupPair,
  validateTestReportForAdvance,
  validateTouchSetJson,
} from "./feature-delivery-gate-validation.js";
import { workflowHealthRel } from "./workflow-health.js";

export { workflowHealthRel };

export const PASS_PATH_MANIFEST_WARNING_CODES = new Set([
  "output_manifest_missing",
  "output_manifest_incomplete",
  "output_manifest_noncompliant",
]);

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
  "bookkeeping",
  // Legacy post-test stages retained for backward-compatible state parsing.
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
      "PIPE.FEATURE_DELIVERY",
      "DOC.ENG_SOFTWARE",
      "DOC.ENG_TYPESCRIPT",
      "DOC.COMPLIANCE_RUNS",
      "DOC.PERSONA_SPEC",
      "DOC.GLOSSARY",
      "DOC.CONTRACT_STYLE",
    ],
  },
  "review.md": {
    stageContract: "PIPE.FEATURE_DELIVERY.REVIEW",
    requiredDocs: [
      "DOC.AGENTS",
      "DOC.REGISTRY",
      "DOC.PERSONA_CONTRACTS",
      "DOC.OUTPUT_MANIFEST",
      "PIPE.FEATURE_DELIVERY",
      "DOC.ENG_SOFTWARE",
      "DOC.ENG_TYPESCRIPT",
      "DOC.COMPLIANCE_RUNS",
      "DOC.PERSONA_SPEC",
      "DOC.GLOSSARY",
      "DOC.CONTRACT_STYLE",
      "DOC.CONTRACT_FORMAT",
    ],
  },
  "test-report.md": {
    stageContract: "PIPE.FEATURE_DELIVERY.TEST",
    requiredDocs: [
      "DOC.AGENTS",
      "DOC.REGISTRY",
      "DOC.PERSONA_CONTRACTS",
      "DOC.OUTPUT_MANIFEST",
      "PIPE.FEATURE_DELIVERY",
      "DOC.ENG_SOFTWARE",
      "DOC.ENG_TYPESCRIPT",
      "DOC.DESIGN_CRAFT",
      "DOC.COMPLIANCE_RUNS",
      "DOC.PERSONA_SPEC",
      "DOC.GLOSSARY",
      "DOC.CONTRACT_STYLE",
    ],
  },
  "delivery-report.md": {
    stageContract: "PIPE.FEATURE_DELIVERY.REPORT",
    requiredDocs: [
      "DOC.AGENTS",
      "DOC.REGISTRY",
      "DOC.PERSONA_CONTRACTS",
      "DOC.OUTPUT_MANIFEST",
      "PIPE.FEATURE_DELIVERY",
      "DOC.OPERATOR_OUTPUT",
      "DOC.RUN_LOG_SCHEMA",
      "DOC.PERSONA_SPEC",
      "DOC.GLOSSARY",
      "DOC.CONTRACT_STYLE",
      "DOC.DELIVERY_REPORT_TEMPLATE",
    ],
  },
  "compliance-result.json": {
    stageContract: "PIPE.FEATURE_DELIVERY.COMPLIANCE",
    requiredDocs: [
      "DOC.AGENTS",
      "DOC.REGISTRY",
      "DOC.PERSONA_CONTRACTS",
      "DOC.OUTPUT_MANIFEST",
      "PIPE.FEATURE_DELIVERY",
      "DOC.COMPLIANCE_RUNS",
      "DOC.RUN_LOG_SCHEMA",
      "DOC.OPERATOR_OUTPUT",
      "DOC.PERSONA_SPEC",
      "DOC.GLOSSARY",
      "DOC.CONTRACT_STYLE",
      "DOC.CONTRACT_FORMAT",
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

export function validateManifestContractKeys(input: {
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

function stageIdForArtifactBase(base: string): string | null {
  switch (base) {
    case "plan.md":
    case "touch-set.json":
    case "handoff.md":
      return "plan";
    case "implementation-report.md":
      return "implement";
    case "review.md":
      return "review";
    case "test-report.md":
    case "design-qa-report.md":
      return "test";
    case "delivery-report.md":
      return "report";
    case "compliance-result.json":
      return "compliance";
    default:
      return null;
  }
}

interface RequiredDocReceipt {
  enforceManifestConsultedDocs: boolean;
  resolvedDocs: Set<string>;
  openedDocs: Set<string>;
  appliedDocs: Set<string>;
  parseError?: string;
}

function parseRequiredDocList(
  value: unknown,
): Set<string> | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return new Set(
    value.filter((item): item is string => typeof item === "string"),
  );
}

function readRequiredDocReceipt(
  repoRoot: string,
  rel: string,
): RequiredDocReceipt | null {
  const base = path.posix.basename(rel);
  const stageId = stageIdForArtifactBase(base);
  if (stageId === null) {
    return null;
  }
  const runDir = path.posix.dirname(rel);
  const receiptRel = path.posix.join(runDir, "required-doc-receipts", `${stageId}.json`);
  const receiptRaw = readRepoText(repoRoot, receiptRel);
  if (receiptRaw === null) {
    return null;
  }
  try {
    const parsed = JSON.parse(receiptRaw) as Record<string, unknown>;
    const resolvedDocs = parseRequiredDocList(parsed.required_docs_resolved);
    const openedDocs = parseRequiredDocList(parsed.required_docs_opened);
    const appliedDocs = parseRequiredDocList(parsed.required_docs_applied);
    if (resolvedDocs === null || openedDocs === null || appliedDocs === null) {
      return {
        enforceManifestConsultedDocs:
          parsed.enforce_manifest_consulted_docs === true,
        resolvedDocs: resolvedDocs ?? new Set(),
        openedDocs: openedDocs ?? new Set(),
        appliedDocs: appliedDocs ?? new Set(),
        parseError:
          "required-doc receipt must include array fields required_docs_resolved, required_docs_opened, and required_docs_applied.",
      };
    }
    return {
      enforceManifestConsultedDocs:
        parsed.enforce_manifest_consulted_docs === true,
      resolvedDocs,
      openedDocs,
      appliedDocs,
    };
  } catch {
    return {
      enforceManifestConsultedDocs: false,
      resolvedDocs: new Set(),
      openedDocs: new Set(),
      appliedDocs: new Set(),
      parseError: "required-doc receipt must parse as JSON.",
    };
  }
}

function validateRequiredDocReceiptForConsultedDocs(input: {
  repoRoot: string;
  rel: string;
  consultedDocs: string[];
}): ArtifactContentWarning | null {
  const receipt = readRequiredDocReceipt(input.repoRoot, input.rel);
  if (receipt === null) {
    return null;
  }
  if (receipt.parseError !== undefined) {
    return {
      path: input.rel,
      code: "required_doc_receipt_invalid",
      message: `${path.posix.basename(input.rel)} ${receipt.parseError}`,
    };
  }
  if (!receipt.enforceManifestConsultedDocs) {
    return {
      path: input.rel,
      code: "required_doc_receipt_unenforced",
      message: `${path.posix.basename(input.rel)} required-doc receipt must set enforce_manifest_consulted_docs: true.`,
    };
  }
  if (
    receipt.resolvedDocs.size === 0 ||
    receipt.openedDocs.size === 0 ||
    receipt.appliedDocs.size === 0
  ) {
    return {
      path: input.rel,
      code: "required_doc_receipt_empty",
      message: `${path.posix.basename(input.rel)} required-doc receipt must include non-empty required_docs_resolved/opened/applied evidence.`,
    };
  }
  for (const consulted of input.consultedDocs) {
    if (!consulted.startsWith("DOC.")) {
      continue;
    }
    if (
      !receipt.resolvedDocs.has(consulted) ||
      !receipt.openedDocs.has(consulted) ||
      !receipt.appliedDocs.has(consulted)
    ) {
      return {
        path: input.rel,
        code: "required_doc_receipt_mismatch",
        message: `${path.posix.basename(input.rel)} consulted_docs claims ${consulted}, but required-doc receipt evidence does not include it across resolved/opened/applied.`,
      };
    }
  }
  return null;
}

function parseProducedArtifactsFromManifest(raw: string | null): string[] {
  return parseManifestList(raw).map((entry) =>
    entry.replace(/\\/gu, "/").replace(/^\/+/u, "").trim(),
  );
}

function validateProducedArtifactsForManifest(input: {
  repoRoot: string;
  rel: string;
  producedArtifacts: string[];
}): ArtifactContentWarning | null {
  if (input.producedArtifacts.length === 0) {
    return null;
  }
  const relNorm = input.rel.replace(/\\/gu, "/").replace(/^\/+/u, "");
  if (!input.producedArtifacts.includes(relNorm)) {
    return {
      path: input.rel,
      code: "produced_artifact_mismatch",
      message: `${path.posix.basename(input.rel)} output manifest produced_artifacts must include ${relNorm}.`,
    };
  }
  for (const produced of input.producedArtifacts) {
    if (produced.length === 0) {
      continue;
    }
    if (!existsSync(resolveRepoPath(input.repoRoot, produced))) {
      return {
        path: input.rel,
        code: "produced_artifact_missing",
        message: `${path.posix.basename(input.rel)} output manifest references missing produced artifact ${produced}.`,
      };
    }
  }
  return null;
}

function artifactParentDir(rel: string): string {
  return path.posix.basename(path.posix.dirname(rel));
}

function isCompanionDisciplineArtifact(rel: string): boolean {
  const parent = artifactParentDir(rel);
  return parent === "product" || parent === "design" || parent === "tech";
}

export function validateMarkdownOutputManifest(
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

export function validateJsonOutputManifest(
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
  return readBooleanField(reviewMarkdown, "review_passes");
}

function readBooleanField(markdown: string, field: string): boolean | null {
  const match = markdown.match(
    new RegExp(`^\\s*${field}:\\s*(true|false)\\s*$`, "imu"),
  );
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
    coreReentryRequired: readBooleanField(reviewMarkdown, "core_reentry_required") === true,
    scopeAmendmentsRatified:
      readBooleanField(reviewMarkdown, "scope_amendments_ratified") === true,
    spotFixable: readBooleanField(reviewMarkdown, "spot_fixable") === true,
    excludedFromGate: readBooleanField(reviewMarkdown, "excluded_from_gate") === true,
  };
}

function readBooleanFieldInlineFallback(markdown: string, field: string): boolean | null {
  const strict = readBooleanField(markdown, field);
  if (strict !== null) {
    return strict;
  }
  const inline = markdown.match(new RegExp(`\\b${field}:\\s*(true|false)\\b`, "iu"));
  if (inline === null) {
    return null;
  }
  return inline[1]?.toLowerCase() === "true";
}

export function parseQaVerdict(testMarkdown: string): {
  passes: boolean | null;
  planInvalidating: boolean;
  coreReentryRequired: boolean;
  spotFixable: boolean;
  excludedFromGate: boolean;
} {
  const passes = readBooleanFieldInlineFallback(testMarkdown, "qa_passes");
  const inferredExcludedFromGate =
    passes === false &&
    (/browser is already running .*chrome-profile/iu.test(testMarkdown) ||
      /use --isolated to run multiple browser instances/iu.test(testMarkdown) ||
      /locked shared profile/iu.test(testMarkdown));
  return {
    passes,
    planInvalidating:
      !inferredExcludedFromGate &&
      readBooleanFieldInlineFallback(testMarkdown, "plan_invalidating") === true,
    coreReentryRequired:
      !inferredExcludedFromGate &&
      readBooleanFieldInlineFallback(testMarkdown, "core_reentry_required") === true,
    spotFixable:
      !inferredExcludedFromGate &&
      readBooleanFieldInlineFallback(testMarkdown, "spot_fixable") === true,
    excludedFromGate:
      readBooleanFieldInlineFallback(testMarkdown, "excluded_from_gate") === true ||
      inferredExcludedFromGate,
  };
}

function hasDesignQaBrowserProfileLockBlocker(designQaMarkdown: string): boolean {
  return (
    /browser is already running .*chrome-profile/iu.test(designQaMarkdown) ||
    /use --isolated to run multiple browser instances/iu.test(designQaMarkdown)
  );
}

export function parseDesignQaVerdict(designQaMarkdown: string): {
  passes: boolean | null;
  planInvalidating: boolean;
  coreReentryRequired: boolean;
  spotFixable: boolean;
  excludedFromGate: boolean;
} {
  const passes = readBooleanFieldInlineFallback(designQaMarkdown, "design_qa_passes");
  const inferredExcludedFromGate =
    passes === false && hasDesignQaBrowserProfileLockBlocker(designQaMarkdown);
  return {
    passes,
    planInvalidating:
      readBooleanFieldInlineFallback(designQaMarkdown, "plan_invalidating") === true,
    coreReentryRequired:
      readBooleanFieldInlineFallback(designQaMarkdown, "core_reentry_required") === true,
    spotFixable:
      readBooleanFieldInlineFallback(designQaMarkdown, "spot_fixable") === true,
    excludedFromGate:
      readBooleanFieldInlineFallback(designQaMarkdown, "excluded_from_gate") === true ||
      inferredExcludedFromGate,
  };
}

export function isDesignOnlyNonBlockingFollowup(input: {
  qaMarkdown: string;
  designQaMarkdown?: string;
  designSteps: boolean;
}): boolean {
  const qa = parseQaVerdict(input.qaMarkdown);
  if (qa.passes !== true) {
    return false;
  }
  if (!input.designSteps || input.designQaMarkdown === undefined) {
    return false;
  }
  const design = parseDesignQaVerdict(input.designQaMarkdown);
  return (
    design.passes === false &&
    design.excludedFromGate &&
    !design.spotFixable &&
    !design.planInvalidating &&
    !design.coreReentryRequired
  );
}

export function isQaOnlyNonBlockingFollowup(qaMarkdown: string): boolean {
  const qa = parseQaVerdict(qaMarkdown);
  return (
    qa.passes === false &&
    qa.excludedFromGate &&
    !qa.spotFixable &&
    !qa.planInvalidating &&
    !qa.coreReentryRequired
  );
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
  designFollowupOnly: boolean;
} {
  const qa = parseQaVerdict(input.qaMarkdown);
  const designFollowupOnly =
    isQaOnlyNonBlockingFollowup(input.qaMarkdown) || isDesignOnlyNonBlockingFollowup(input);
  const attach = (
    verdict: Omit<
      ReturnType<typeof mergedTestStageVerdict>,
      "designFollowupOnly"
    >,
  ) => ({
    ...verdict,
    designFollowupOnly,
  });
  if (!input.designSteps) {
    return attach(qa);
  }
  if (input.designQaMarkdown === undefined) {
    return attach({ ...qa, passes: qa.passes === true ? null : qa.passes });
  }
  const design = parseDesignQaVerdict(input.designQaMarkdown);
  if (qa.passes === false) {
    return attach(qa);
  }
  if (designFollowupOnly) {
    return attach({
      passes: true,
      planInvalidating: false,
      coreReentryRequired: false,
      spotFixable: false,
      excludedFromGate: false,
    });
  }
  if (design.passes === false) {
    return attach({
      passes: false,
      planInvalidating: design.planInvalidating,
      coreReentryRequired: design.coreReentryRequired,
      spotFixable: design.spotFixable,
      excludedFromGate: design.excludedFromGate,
    });
  }
  if (qa.passes === true && design.passes === true) {
    return attach({
      passes: true,
      planInvalidating: false,
      coreReentryRequired: false,
      spotFixable: false,
      excludedFromGate: false,
    });
  }
  return attach({ ...qa, passes: null });
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

function readMarkdownSectionBody(content: string, heading: string): string | null {
  const lines = content.split(/\r?\n/u);
  const headingRegex = new RegExp(
    `^##\\s+${heading.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\b`,
    "iu",
  );
  const start = lines.findIndex((line) => headingRegex.test(line));
  if (start < 0) {
    return null;
  }
  const bodyLines: string[] = [];
  for (let idx = start + 1; idx < lines.length; idx += 1) {
    if (/^##\s+/u.test(lines[idx] ?? "")) {
      break;
    }
    bodyLines.push(lines[idx] ?? "");
  }
  return bodyLines.join("\n");
}

function resolvePlanCriteriaReferencePaths(planRel: string, criteriaSection: string): string[] {
  const refs = new Set<string>();
  const addRef = (rawRef: string) => {
    const candidate = rawRef.replace(/\\/gu, "/").replace(/^\/+/, "").trim();
    if (candidate.length === 0 || !candidate.endsWith("acceptance-criteria.md")) {
      return;
    }
    if (candidate.startsWith(".pan/") || candidate.startsWith("lib/")) {
      refs.add(path.posix.normalize(candidate));
      return;
    }
    refs.add(path.posix.normalize(path.posix.join(path.posix.dirname(planRel), candidate)));
  };
  for (const match of criteriaSection.matchAll(/`([^`\n]*acceptance-criteria\.md)`/gu)) {
    addRef(match[1] ?? "");
  }
  for (const match of criteriaSection.matchAll(/(?:^|[\s(])([A-Za-z0-9._/-]*acceptance-criteria\.md)\b/gu)) {
    addRef(match[1] ?? "");
  }
  return [...refs];
}

function markdownHasCriteriaList(content: string): boolean {
  return /^\s*(?:\d+\.|-)\s+\S/mu.test(content);
}

function planCriteriaDelegatesToReferences(
  repoRoot: string,
  planRel: string,
  content: string,
): boolean {
  const criteriaSection = readMarkdownSectionBody(content, "Acceptance criteria");
  if (criteriaSection === null) {
    return false;
  }
  const references = resolvePlanCriteriaReferencePaths(planRel, criteriaSection);
  if (references.length === 0) {
    return false;
  }
  for (const rel of references) {
    const referencedRaw = readRepoText(repoRoot, rel);
    if (referencedRaw === null) {
      return false;
    }
    const referencedContent = readPanWorkMarkdown(referencedRaw);
    const beforeManifest =
      referencedContent.split(/^##\s+Output manifest\b/imu)[0] ?? referencedContent;
    if (!markdownHasCriteriaList(beforeManifest)) {
      return false;
    }
  }
  return true;
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
  const rawContent = readRepoText(repoRoot, rel);
  if (rawContent === null) {
    return null;
  }
  const content = rel.endsWith(".json") ? rawContent : readPanWorkMarkdown(rawContent);

  if (base === "plan.md" && !isCompanionDisciplineArtifact(rel)) {
    const planError = validatePlanMarkdown(content);
    const delegatedCriteriaSatisfiesPlanGate =
      planError?.includes("must contain at least one numbered measurable criterion") ===
        true && planCriteriaDelegatesToReferences(repoRoot, rel, content);
    if (planError !== null && !delegatedCriteriaSatisfiesPlanGate) {
      return gateValidationErrorToWarning(rel, planError);
    }
    const manifestWarning =
      validateMarkdownBody(rel, content) ??
      validateMarkdownOutputManifest(rel, base, content)
    if (manifestWarning !== null) {
      return manifestWarning;
    }
    const producedArtifactsWarning = validateProducedArtifactsForManifest({
      repoRoot,
      rel,
      producedArtifacts: parseProducedArtifactsFromManifest(
        readMarkdownManifestField(content, "produced_artifacts"),
      ),
    });
    if (producedArtifactsWarning !== null) {
      return producedArtifactsWarning;
    }
    return validateRequiredDocReceiptForConsultedDocs({
      repoRoot,
      rel,
      consultedDocs: parseManifestList(readMarkdownManifestField(content, "consulted_docs")),
    });
  }

  if (base === "handoff.md") {
    const handoffError = validateHandoffMarkdown(content);
    if (handoffError !== null) {
      return gateValidationErrorToWarning(rel, handoffError);
    }
    const manifestWarning =
      validateMarkdownBody(rel, content) ??
      validateMarkdownOutputManifest(rel, base, content)
    if (manifestWarning !== null) {
      return manifestWarning;
    }
    const producedArtifactsWarning = validateProducedArtifactsForManifest({
      repoRoot,
      rel,
      producedArtifacts: parseProducedArtifactsFromManifest(
        readMarkdownManifestField(content, "produced_artifacts"),
      ),
    });
    if (producedArtifactsWarning !== null) {
      return producedArtifactsWarning;
    }
    return validateRequiredDocReceiptForConsultedDocs({
      repoRoot,
      rel,
      consultedDocs: parseManifestList(readMarkdownManifestField(content, "consulted_docs")),
    });
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
    const manifestWarning =
      validateMarkdownBody(rel, content) ??
      validateVerdictConsistency(rel, content, "implement_gate_passes") ??
      validateMarkdownOutputManifest(rel, base, content)
    if (manifestWarning !== null) {
      return manifestWarning;
    }
    const producedArtifactsWarning = validateProducedArtifactsForManifest({
      repoRoot,
      rel,
      producedArtifacts: parseProducedArtifactsFromManifest(
        readMarkdownManifestField(content, "produced_artifacts"),
      ),
    });
    if (producedArtifactsWarning !== null) {
      return producedArtifactsWarning;
    }
    return validateRequiredDocReceiptForConsultedDocs({
      repoRoot,
      rel,
      consultedDocs: parseManifestList(readMarkdownManifestField(content, "consulted_docs")),
    });
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
    if (readBooleanField(content, "scope_amendments_ratified") === null) {
      return {
        path: rel,
        code: "review_scope_unparseable",
        message:
          "review.md must contain scope_amendments_ratified: true or scope_amendments_ratified: false",
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
    const manifestWarning =
      validateVerdictConsistency(rel, content, "review_passes") ??
      validateMarkdownOutputManifest(rel, base, content)
    if (manifestWarning !== null) {
      return manifestWarning;
    }
    const producedArtifactsWarning = validateProducedArtifactsForManifest({
      repoRoot,
      rel,
      producedArtifacts: parseProducedArtifactsFromManifest(
        readMarkdownManifestField(content, "produced_artifacts"),
      ),
    });
    if (producedArtifactsWarning !== null) {
      return producedArtifactsWarning;
    }
    return validateRequiredDocReceiptForConsultedDocs({
      repoRoot,
      rel,
      consultedDocs: parseManifestList(readMarkdownManifestField(content, "consulted_docs")),
    });
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
    const manifestWarning =
      validateVerdictConsistency(rel, content, "qa_passes") ??
      validateMarkdownOutputManifest(rel, base, content)
    if (manifestWarning !== null) {
      return manifestWarning;
    }
    const producedArtifactsWarning = validateProducedArtifactsForManifest({
      repoRoot,
      rel,
      producedArtifacts: parseProducedArtifactsFromManifest(
        readMarkdownManifestField(content, "produced_artifacts"),
      ),
    });
    if (producedArtifactsWarning !== null) {
      return producedArtifactsWarning;
    }
    return validateRequiredDocReceiptForConsultedDocs({
      repoRoot,
      rel,
      consultedDocs: parseManifestList(readMarkdownManifestField(content, "consulted_docs")),
    });
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
    const manifestWarning =
      validateVerdictConsistency(rel, content, "design_qa_passes") ??
      validateMarkdownOutputManifest(rel, base, content)
    if (manifestWarning !== null) {
      return manifestWarning;
    }
    const producedArtifactsWarning = validateProducedArtifactsForManifest({
      repoRoot,
      rel,
      producedArtifacts: parseProducedArtifactsFromManifest(
        readMarkdownManifestField(content, "produced_artifacts"),
      ),
    });
    if (producedArtifactsWarning !== null) {
      return producedArtifactsWarning;
    }
    return validateRequiredDocReceiptForConsultedDocs({
      repoRoot,
      rel,
      consultedDocs: parseManifestList(readMarkdownManifestField(content, "consulted_docs")),
    });
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

  if (base === "delivery-report.md") {
    if (event !== undefined) {
      const reportAdvanceError = validateReportForAdvance(content, event);
      if (reportAdvanceError !== null) {
        return gateValidationErrorToWarning(rel, reportAdvanceError);
      }
    }
    const manifestWarning =
      validateMarkdownBody(rel, content) ??
      validateMarkdownOutputManifest(rel, base, content)
    if (manifestWarning !== null) {
      return manifestWarning;
    }
    const producedArtifactsWarning = validateProducedArtifactsForManifest({
      repoRoot,
      rel,
      producedArtifacts: parseProducedArtifactsFromManifest(
        readMarkdownManifestField(content, "produced_artifacts"),
      ),
    });
    if (producedArtifactsWarning !== null) {
      return producedArtifactsWarning;
    }
    return validateRequiredDocReceiptForConsultedDocs({
      repoRoot,
      rel,
      consultedDocs: parseManifestList(readMarkdownManifestField(content, "consulted_docs")),
    });
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
    if (
      verdict.passes === true &&
      (verdict.planInvalidating ||
        verdict.coreReentryRequired ||
        verdict.spotFixable ||
        verdict.excludedFromGate ||
        verdict.failingFinalGateCommands.length > 0)
    ) {
      return {
        path: rel,
        code: "verdict_conflict",
        message:
          "compliance-result.json cannot report compliance_passes: true while also flagging blocker/remediation semantics in the same artifact.",
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
      const manifestWarning = validateJsonOutputManifest(rel, parsed);
      if (manifestWarning !== null) {
        return manifestWarning;
      }
      const manifest = parsed.output_manifest;
      const producedArtifacts =
        manifest !== null &&
        typeof manifest === "object" &&
        !Array.isArray(manifest) &&
        Array.isArray((manifest as Record<string, unknown>).produced_artifacts)
          ? ((manifest as Record<string, unknown>).produced_artifacts as unknown[]).filter(
              (value): value is string => typeof value === "string",
            )
          : [];
      const producedArtifactsWarning = validateProducedArtifactsForManifest({
        repoRoot,
        rel,
        producedArtifacts,
      });
      if (producedArtifactsWarning !== null) {
        return producedArtifactsWarning;
      }
      const transcriptEvidenceError =
        validateHighRiskPersonaTranscriptCompliance(parsed);
      if (transcriptEvidenceError !== null) {
        return gateValidationErrorToWarning(rel, transcriptEvidenceError);
      }
      const consultedDocs =
        manifest !== null &&
        typeof manifest === "object" &&
        !Array.isArray(manifest) &&
        Array.isArray((manifest as Record<string, unknown>).consulted_docs)
          ? ((manifest as Record<string, unknown>).consulted_docs as unknown[]).filter(
              (value): value is string => typeof value === "string",
            )
          : [];
      return validateRequiredDocReceiptForConsultedDocs({
        repoRoot,
        rel,
        consultedDocs,
      });
    } catch {
      return null;
    }
  }

  const manifestWarning = validateMarkdownOutputManifest(rel, base, content);
  if (manifestWarning !== null) {
    return manifestWarning;
  }
  const producedArtifactsWarning = validateProducedArtifactsForManifest({
    repoRoot,
    rel,
    producedArtifacts: parseProducedArtifactsFromManifest(
      readMarkdownManifestField(content, "produced_artifacts"),
    ),
  });
  if (producedArtifactsWarning !== null) {
    return producedArtifactsWarning;
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
        event !== "qa_spot_fix" &&
        event !== "qa_design_followup" &&
        event !== "repo_wide_blocker"
      ) {
        throw new Error(
          "Test stage only supports qa_passes, qa_fails, qa_fails_plan_invalidating, " +
            `qa_spot_fix, qa_design_followup, or repo_wide_blocker, got ${event}.`,
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
    case "bookkeeping": {
      const deliveryReport = deliveryReportRel(run);
      const durableIndex = durableFeatureIndexRel(state.featureId);
      if (event !== "bookkeeping_complete" && event !== "repo_wide_blocker") {
        throw new Error(
          `Bookkeeping stage only supports bookkeeping_complete or repo_wide_blocker, got ${event}.`,
        );
      }
      return {
        primaryArtifact: deliveryReport,
        requiredAfterStageWork: [deliveryReport, durableIndex],
        acceptedAdvanceArtifacts: [deliveryReport, durableIndex],
      };
    }
    case "report": {
      const deliveryReport = deliveryReportRel(run);
      if (event !== "report_ready" && event !== "repo_wide_blocker") {
        throw new Error(
          `Report stage only supports report_ready or repo_wide_blocker, got ${event}.`,
        );
      }
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
        event !== "compliance_spot_fix" &&
        event !== "repo_wide_blocker"
      ) {
        throw new Error(
          "Compliance stage only supports compliance_passes, compliance_fails, " +
            `compliance_fails_plan_invalidating, compliance_spot_fix, or repo_wide_blocker, got ${event}.`,
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
  "delivery-report.md",
  "compliance-result.json",
  "ship-ratification.json",
  OPERATOR_VERIFICATION_FILENAME,
]);

export function isPassPathManifestWarning(
  stageId: string,
  event: string,
  warning: ArtifactContentWarning,
): boolean {
  const passEvent =
    (stageId === "bookkeeping" && event === "bookkeeping_complete") ||
    (stageId === "report" && event === "report_ready") ||
    (stageId === "compliance" && event === "compliance_passes");
  if (!passEvent) {
    return false;
  }
  return PASS_PATH_MANIFEST_WARNING_CODES.has(warning.code);
}

function validateReportForAdvance(content: string, event: string): string | null {
  if (event !== "report_ready" && event !== "bookkeeping_complete") {
    return null;
  }
  const manifestWarning = validateMarkdownOutputManifest(
    "delivery-report.md",
    "delivery-report.md",
    content,
  );
  return manifestWarning?.message ?? null;
}

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
  if (stage === "test" && event === "qa_design_followup") {
    const testContent = readRepoText(repoRoot, artifact);
    const designRel = designQaReportRel(state.artifacts.runDir);
    const designContent = readRepoText(repoRoot, designRel) ?? undefined;
    const pairError =
      testContent === null
        ? null
        : validateQaDesignFollowupPair({
            testReportContent: testContent,
            designQaReportContent: designContent,
            designStepsEnabled: designStepsEnabled(state.options),
          });
    if (pairError !== null) {
      throw new Error(`Cannot advance ${stage} on ${event}; ${pairError}`);
    }
    if (designStepsEnabled(state.options)) {
      advanceArtifacts.push(designRel);
    }
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
  if (
    stage === "plan" &&
    (event === "human_approval" || event === "sdk_artifact_validation")
  ) {
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
