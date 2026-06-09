/**
 * Machine-checkable gate contracts for feature-delivery stage artifacts.
 * Persona prose and CLI stage contracts MUST stay aligned with these validators.
 */

export type SpotFixScope = "artifact-only" | "code-bounded";

export interface SpotFixJustification {
  spotFixable: boolean;
  scope: SpotFixScope | null;
  owner: string | null;
  paths: string[];
  rationale: string | null;
}

const SPOT_FIX_MAX_PATHS = 3;

const ACCEPTANCE_CRITERIA_HEADING = /^##\s+Acceptance criteria\b/imu;
const SHARED_LAYER_HEADING = /^##\s+Shared-layer impact\b/imu;
const VALIDATION_COMMANDS_HEADING = /^##\s+Validation commands\b/imu;
const AUTOMATED_CHECKS_HEADING = /^##\s+Automated checks\b/imu;
const COVERAGE_DELTA_HEADING = /^##\s+Coverage delta\b/imu;

function readMarkdownField(content: string, field: string): string | null {
  const match = content.match(new RegExp(`${field}:\\s*(.+)$`, "imu"));
  return match === null ? null : match[1].trim();
}

function readMarkdownBool(content: string, field: string): boolean | null {
  const value = readMarkdownField(content, field);
  if (value === null) {
    return null;
  }
  if (value.toLowerCase() === "true") {
    return true;
  }
  if (value.toLowerCase() === "false") {
    return false;
  }
  return null;
}

function parsePathsList(raw: string | null): string[] {
  if (raw === null || raw.trim().length === 0 || raw.trim().toLowerCase() === "none") {
    return [];
  }
  return raw
    .split(",")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

export function parseSpotFixJustificationFromMarkdown(content: string): SpotFixJustification {
  return {
    spotFixable: readMarkdownBool(content, "spot_fixable") ?? false,
    scope: readMarkdownField(content, "spot_fix_scope") as SpotFixScope | null,
    owner: readMarkdownField(content, "spot_fix_owner"),
    paths: parsePathsList(readMarkdownField(content, "spot_fix_paths")),
    rationale: readMarkdownField(content, "spot_fix_rationale"),
  };
}

export function parseSpotFixJustificationFromRecord(record: Record<string, unknown>): SpotFixJustification {
  const pathsRaw = record.spot_fix_paths;
  let paths: string[] = [];
  if (Array.isArray(pathsRaw)) {
    paths = pathsRaw.filter((item): item is string => typeof item === "string");
  } else if (typeof pathsRaw === "string") {
    paths = parsePathsList(pathsRaw);
  }
  const scopeRaw = record.spot_fix_scope;
  const scope =
    scopeRaw === "artifact-only" || scopeRaw === "code-bounded" ? (scopeRaw as SpotFixScope) : null;
  return {
    spotFixable: record.spot_fixable === true,
    scope,
    owner: typeof record.spot_fix_owner === "string" ? record.spot_fix_owner : null,
    paths,
    rationale: typeof record.spot_fix_rationale === "string" ? record.spot_fix_rationale : null,
  };
}

export function validateSpotFixJustification(
  event: "review_spot_fix" | "qa_spot_fix" | "compliance_spot_fix",
  justification: SpotFixJustification,
): string | null {
  if (!justification.spotFixable) {
    return `${event} requires spot_fixable: true in the stage artifact.`;
  }
  if (justification.scope === null) {
    return `${event} requires spot_fix_scope: artifact-only or code-bounded.`;
  }
  if (event === "review_spot_fix" && justification.scope !== "artifact-only") {
    return "review_spot_fix requires spot_fix_scope: artifact-only because reviewer is read-only on code.";
  }
  if (event !== "review_spot_fix" && justification.scope !== "code-bounded") {
    return `${event} requires spot_fix_scope: code-bounded.`;
  }
  if (justification.paths.length === 0) {
    return `${event} requires spot_fix_paths listing at most ${SPOT_FIX_MAX_PATHS} affected paths.`;
  }
  if (justification.paths.length > SPOT_FIX_MAX_PATHS) {
    return `${event} allows at most ${SPOT_FIX_MAX_PATHS} spot_fix_paths entries.`;
  }
  if (justification.rationale === null || justification.rationale.length === 0) {
    return `${event} requires spot_fix_rationale with a one-sentence bounded-remediation justification.`;
  }
  if (event === "review_spot_fix") {
    const invalid = justification.paths.find(
      (rel) => !rel.startsWith(".pan/work/") && !rel.startsWith("lib/memory/"),
    );
    if (invalid !== undefined) {
      return `review_spot_fix paths must stay under .pan/work/ or lib/memory/; got ${invalid}.`;
    }
  }
  return null;
}

export function validatePlanMarkdown(content: string): string | null {
  if (!ACCEPTANCE_CRITERIA_HEADING.test(content)) {
    return "plan.md must include a ## Acceptance criteria section with quantified, testable criteria.";
  }
  if (!SHARED_LAYER_HEADING.test(content)) {
    return "plan.md must include a ## Shared-layer impact section naming shared paths or none.";
  }
  const criteriaBody = content.split(ACCEPTANCE_CRITERIA_HEADING)[1]?.split(/^##\s/mu)[0] ?? "";
  const numbered = criteriaBody.match(/^\s*\d+\.\s+\S/mu);
  if (numbered === null) {
    return "plan.md ## Acceptance criteria must contain at least one numbered measurable criterion.";
  }
  return null;
}

export function validateHandoffMarkdown(content: string): string | null {
  if (!VALIDATION_COMMANDS_HEADING.test(content)) {
    return "handoff.md must include a ## Validation commands section naming gate commands and owners.";
  }
  return null;
}

export function validateTouchSetJson(content: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return "touch-set.json must parse as JSON.";
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return "touch-set.json must be a JSON object.";
  }
  const record = parsed as Record<string, unknown>;
  if (!Array.isArray(record.paths)) {
    return "touch-set.json must include a paths array.";
  }
  if (!Array.isArray(record.tests)) {
    return "touch-set.json must include a tests array.";
  }
  if (!Array.isArray(record.shared_paths)) {
    return "touch-set.json must include a shared_paths array (use [] when none).";
  }
  if (!Array.isArray(record.integration_prerequisites)) {
    return "touch-set.json must include an integration_prerequisites array (use [] when none).";
  }
  if (!Array.isArray(record.acceptance_criteria)) {
    return "touch-set.json must include an acceptance_criteria array with measurable ids.";
  }
  return null;
}

export function validateImplementationReport(content: string): string | null {
  const gatePasses = readMarkdownBool(content, "implement_gate_passes");
  if (gatePasses === null) {
    return "implementation-report.md must declare implement_gate_passes: true or false.";
  }
  if (!AUTOMATED_CHECKS_HEADING.test(content)) {
    return "implementation-report.md must include a ## Automated checks table.";
  }
  if (!COVERAGE_DELTA_HEADING.test(content)) {
    return "implementation-report.md must include a ## Coverage delta section with threshold figures.";
  }
  const checksBody = content.split(AUTOMATED_CHECKS_HEADING)[1]?.split(/^##\s/mu)[0] ?? "";
  for (const check of ["lint", "typecheck", "test"] as const) {
    if (!implementationReportRecordsCheck(checksBody, check)) {
      return `implementation-report.md ## Automated checks must record pnpm ${check} (repo-wide or --filter scoped).`;
    }
  }
  return null;
}

function implementationReportRecordsCheck(checksBody: string, check: "lint" | "typecheck" | "test"): boolean {
  if (checksBody.includes(`pnpm ${check}`)) {
    return true;
  }
  return new RegExp(`pnpm\\s+--filter\\s+\\S+\\s+${check}\\b`).test(checksBody);
}

export function validateReviewMarkdownForAdvance(content: string, event: string): string | null {
  if (event === "review_spot_fix") {
    return validateSpotFixJustification("review_spot_fix", parseSpotFixJustificationFromMarkdown(content));
  }
  if (event === "review_passes") {
    const passes = readMarkdownBool(content, "review_passes");
    if (passes !== true) {
      return "review_passes advance requires review_passes: true in review.md.";
    }
    const repoWide = readMarkdownBool(content, "repo_wide_tests_pass");
    if (repoWide !== true) {
      return "review_passes advance requires repo_wide_tests_pass: true after repo-wide pnpm test and node --test tests/*.test.mjs.";
    }
  }
  return null;
}

export function validateTestReportForAdvance(content: string, event: string): string | null {
  if (event === "qa_spot_fix") {
    return validateSpotFixJustification("qa_spot_fix", parseSpotFixJustificationFromMarkdown(content));
  }
  if (event === "qa_passes") {
    const passes = readMarkdownBool(content, "qa_passes");
    if (passes !== true) {
      return "qa_passes advance requires qa_passes: true in test-report.md.";
    }
  }
  return null;
}

export function validateDesignQaForAdvance(content: string, event: string): string | null {
  if (event === "qa_spot_fix") {
    return validateSpotFixJustification("qa_spot_fix", parseSpotFixJustificationFromMarkdown(content));
  }
  if (event === "qa_passes") {
    const passes = readMarkdownBool(content, "design_qa_passes");
    if (passes !== true) {
      return "qa_passes advance with design steps requires design_qa_passes: true in design-qa-report.md.";
    }
  }
  return null;
}

export function validateComplianceForAdvance(content: string, event: string): string | null {
  let record: Record<string, unknown>;
  try {
    const parsed = JSON.parse(content) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return "compliance-result.json must be a JSON object.";
    }
    record = parsed as Record<string, unknown>;
  } catch {
    return "compliance-result.json must parse as JSON.";
  }
  if (event === "compliance_spot_fix") {
    return validateSpotFixJustification(
      "compliance_spot_fix",
      parseSpotFixJustificationFromRecord(record),
    );
  }
  if (event === "compliance_passes") {
    if (record.compliance_passes !== true) {
      return "compliance_passes advance requires compliance_passes: true in compliance-result.json.";
    }
  }
  return null;
}

export function touchSetAllowsPath(touchSetContent: string, changedPath: string): {
  allowed: boolean;
  category: "paths" | "shared_paths" | "undeclared";
} {
  try {
    const parsed = JSON.parse(touchSetContent) as Record<string, unknown>;
    const paths = Array.isArray(parsed.paths) ? (parsed.paths as string[]) : [];
    const shared = Array.isArray(parsed.shared_paths) ? (parsed.shared_paths as string[]) : [];
    const normalized = changedPath.replace(/^\.\//u, "");
    const inPaths = paths.some((entry) => normalized === entry || normalized.startsWith(`${entry}/`));
    if (inPaths) {
      return { allowed: true, category: "paths" };
    }
    const inShared = shared.some((entry) => normalized === entry || normalized.startsWith(`${entry}/`));
    if (inShared) {
      return { allowed: true, category: "shared_paths" };
    }
    return { allowed: false, category: "undeclared" };
  } catch {
    return { allowed: false, category: "undeclared" };
  }
}
