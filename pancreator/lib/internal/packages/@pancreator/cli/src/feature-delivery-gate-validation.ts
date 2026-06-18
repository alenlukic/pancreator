/**
 * Machine-checkable gate contracts for feature-delivery stage artifacts.
 * Persona prose and CLI stage contracts MUST stay aligned with these validators.
 */

export type SpotFixScope = "artifact-only" | "code-bounded";
export type ScopeAmendmentKind =
  | "paired-test"
  | "paired-fixture"
  | "declared-dir-sibling";

export interface ScopeAmendmentEntry {
  path: string;
  kind: ScopeAmendmentKind;
  reason: string;
  status?: string;
}

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
const SCOPE_AMENDMENT_KINDS: readonly ScopeAmendmentKind[] = [
  "paired-test",
  "paired-fixture",
  "declared-dir-sibling",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeRepoRelativePath(value: string): string {
  return value.replace(/\\/gu, "/").replace(/^\.\//u, "");
}

function readPathEntries(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry === "string" && entry.trim().length > 0) {
      out.push(normalizeRepoRelativePath(entry.trim()));
      continue;
    }
    if (isRecord(entry) && typeof entry.path === "string" && entry.path.trim().length > 0) {
      out.push(normalizeRepoRelativePath(entry.path.trim()));
    }
  }
  return out;
}

function parseScopeAmendmentEntries(raw: unknown): ScopeAmendmentEntry[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: ScopeAmendmentEntry[] = [];
  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry.path !== "string" || typeof entry.kind !== "string") {
      continue;
    }
    if (typeof entry.reason !== "string" || entry.reason.trim().length === 0) {
      continue;
    }
    if (!SCOPE_AMENDMENT_KINDS.includes(entry.kind as ScopeAmendmentKind)) {
      continue;
    }
    out.push({
      path: normalizeRepoRelativePath(entry.path.trim()),
      kind: entry.kind as ScopeAmendmentKind,
      reason: entry.reason.trim(),
      status: typeof entry.status === "string" ? entry.status : undefined,
    });
  }
  return out;
}

function parseTouchSetRecord(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export interface ParsedTouchSetPaths {
  paths: string[];
  sharedPaths: string[];
  amendments: ScopeAmendmentEntry[];
}

export function parseTouchSetPaths(content: string): ParsedTouchSetPaths {
  const parsed = parseTouchSetRecord(content);
  if (parsed === null) {
    return { paths: [], sharedPaths: [], amendments: [] };
  }
  return {
    paths: readPathEntries(parsed.paths),
    sharedPaths: readPathEntries(parsed.shared_paths),
    amendments: parseScopeAmendmentEntries(parsed.amendments),
  };
}

function isAllowedPrefixMatch(changedPath: string, declaredPath: string): boolean {
  return changedPath === declaredPath || changedPath.startsWith(`${declaredPath}/`);
}

function readMarkdownScopeAmendments(content: string): {
  raw: string | null;
  entries: ScopeAmendmentEntry[];
  error: string | null;
} {
  const raw = readMarkdownField(content, "scope_amendments");
  if (raw === null) {
    return {
      raw,
      entries: [],
      error:
        "implementation-report.md must declare scope_amendments: none or comma-separated path(kind:reason) entries.",
    };
  }
  if (raw.trim().toLowerCase() === "none") {
    return { raw, entries: [], error: null };
  }
  const entries: ScopeAmendmentEntry[] = [];
  for (const segment of raw.split(",")) {
    const item = segment.trim();
    if (item.length === 0) {
      continue;
    }
    const match = item.match(
      /^(.+?)\((paired-test|paired-fixture|declared-dir-sibling):(.+)\)$/u,
    );
    if (match === null) {
      return {
        raw,
        entries: [],
        error:
          "scope_amendments entries must use path(kind:reason) with an allowed amendment kind.",
      };
    }
    entries.push({
      path: normalizeRepoRelativePath(match[1].trim()),
      kind: match[2] as ScopeAmendmentKind,
      reason: match[3].trim(),
    });
  }
  return { raw, entries, error: null };
}

function dirnameSet(paths: readonly string[]): Set<string> {
  return new Set(paths.map((entry) => normalizeRepoRelativePath(entry)).map((entry) => entry.split("/").slice(0, -1).join("/")));
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

function amendmentMatchesDeclaredScope(
  amendment: ScopeAmendmentEntry,
  declaredPaths: readonly string[],
  sharedPaths: readonly string[],
): boolean {
  const allDeclared = [...declaredPaths, ...sharedPaths];
  const targetDir = amendment.path.split("/").slice(0, -1).join("/");
  const declaredDirs = dirnameSet(allDeclared);
  switch (amendment.kind) {
    case "paired-test":
      if (!/(?:^|\/)__tests__\/|(?:^|\/)[^/]+\.(?:test|spec)\.[^/]+$/u.test(amendment.path)) {
        return false;
      }
      return (
        declaredDirs.has(targetDir) ||
        declaredDirs.has(targetDir.split("/").slice(0, -1).join("/"))
      );
    case "paired-fixture":
      if (!/(?:^|\/)__fixtures__\/|(?:^|\/)[^/]+\.fixture\.[^/]+$/u.test(amendment.path)) {
        return false;
      }
      return (
        declaredDirs.has(targetDir) ||
        declaredDirs.has(targetDir.split("/").slice(0, -1).join("/"))
      );
    case "declared-dir-sibling":
      return declaredDirs.has(targetDir);
    default:
      return false;
  }
}

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
  const parsed = parseTouchSetRecord(content);
  if (parsed === null) {
    return "touch-set.json must parse as JSON.";
  }
  if (!Array.isArray(parsed.paths)) {
    return "touch-set.json must include a paths array.";
  }
  if (!Array.isArray(parsed.tests)) {
    return "touch-set.json must include a tests array.";
  }
  if (!Array.isArray(parsed.shared_paths)) {
    return "touch-set.json must include a shared_paths array (use [] when none).";
  }
  if (!Array.isArray(parsed.integration_prerequisites)) {
    return "touch-set.json must include an integration_prerequisites array (use [] when none).";
  }
  if (!Array.isArray(parsed.acceptance_criteria)) {
    return "touch-set.json must include an acceptance_criteria array with measurable ids.";
  }
  if (!Array.isArray(parsed.manual_qa_test_cases)) {
    return "touch-set.json must include a manual_qa_test_cases array (use [] when none).";
  }
  if (readPathEntries(parsed.paths).length !== parsed.paths.length) {
    return "touch-set.json paths entries must be strings or objects with a non-empty path.";
  }
  if (readPathEntries(parsed.shared_paths).length !== parsed.shared_paths.length) {
    return "touch-set.json shared_paths entries must be strings or objects with a non-empty path.";
  }
  if (parsed.amendments !== undefined) {
    if (!Array.isArray(parsed.amendments)) {
      return "touch-set.json amendments must be an array when present.";
    }
    if (parseScopeAmendmentEntries(parsed.amendments).length !== parsed.amendments.length) {
      return "touch-set.json amendments entries must include path, kind, and reason with an allowed amendment kind.";
    }
  }
  return null;
}

export function validateImplementationReport(content: string): string | null {
  const gatePasses = readMarkdownBool(content, "implement_gate_passes");
  if (gatePasses === null) {
    return "implementation-report.md must declare implement_gate_passes: true or false.";
  }
  const scopeAmendments = readMarkdownScopeAmendments(content);
  if (scopeAmendments.error !== null) {
    return scopeAmendments.error;
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
  if (event === "review_core_reentry") {
    const amendmentsRatified = readMarkdownBool(content, "scope_amendments_ratified");
    if (amendmentsRatified === null) {
      return "review.md must declare scope_amendments_ratified: true or false.";
    }
    const reentryRequired = readMarkdownBool(content, "core_reentry_required");
    if (reentryRequired !== true) {
      return "review_core_reentry advance requires core_reentry_required: true in review.md.";
    }
    return null;
  }
  if (event === "review_passes") {
    const amendmentsRatified = readMarkdownBool(content, "scope_amendments_ratified");
    if (amendmentsRatified === null) {
      return "review.md must declare scope_amendments_ratified: true or false.";
    }
    const passes = readMarkdownBool(content, "review_passes");
    if (passes !== true) {
      return "review_passes advance requires review_passes: true in review.md.";
    }
    const repoWide = readMarkdownBool(content, "repo_wide_tests_pass");
    if (repoWide !== true) {
      return "review_passes advance requires repo_wide_tests_pass: true after repo-wide pnpm test and node --test tests/*.test.mjs.";
    }
    if (amendmentsRatified !== true) {
      return "review_passes advance requires scope_amendments_ratified: true in review.md.";
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
  category: "paths" | "shared_paths" | "amendments" | "undeclared";
} {
  const parsed = parseTouchSetPaths(touchSetContent);
  const normalized = normalizeRepoRelativePath(changedPath);
  const inAmendments = parsed.amendments.some((entry) =>
    isAllowedPrefixMatch(normalized, entry.path),
  );
  if (inAmendments) {
    return { allowed: true, category: "amendments" };
  }
  const inPaths = parsed.paths.some((entry) => isAllowedPrefixMatch(normalized, entry));
  if (inPaths) {
    return { allowed: true, category: "paths" };
  }
  const inShared = parsed.sharedPaths.some((entry) =>
    isAllowedPrefixMatch(normalized, entry),
  );
  if (inShared) {
    return { allowed: true, category: "shared_paths" };
  }
  return { allowed: false, category: "undeclared" };
}

export function validateScopeAmendments(
  touchSetContent: string,
  changedPaths: readonly string[],
): string | null {
  const parsed = parseTouchSetPaths(touchSetContent);
  for (const amendment of parsed.amendments) {
    if (isChangeControlledPath(amendment.path)) {
      return `touch-set amendment ${amendment.path} targets a change-controlled governance path and must route to tech-lead instead.`;
    }
    if (!amendmentMatchesDeclaredScope(amendment, parsed.paths, parsed.sharedPaths)) {
      return `touch-set amendment ${amendment.path} does not satisfy the bounded ${amendment.kind} policy.`;
    }
  }
  for (const changedPath of changedPaths) {
    const allowed = touchSetAllowsPath(touchSetContent, changedPath);
    if (!allowed.allowed) {
      return `changed path ${normalizeRepoRelativePath(changedPath)} is absent from touch-set.json paths, shared_paths, and amendments.`;
    }
  }
  return null;
}

export function validateImplementationScopeAmendments(
  touchSetContent: string,
  implementationReportContent: string,
  changedPaths: readonly string[],
): string | null {
  const amendmentError = validateScopeAmendments(touchSetContent, changedPaths);
  if (amendmentError !== null) {
    return amendmentError;
  }
  const report = readMarkdownScopeAmendments(implementationReportContent);
  if (report.error !== null) {
    return report.error;
  }
  const touchSetAmendments = parseTouchSetPaths(touchSetContent).amendments.map(
    (entry) => `${entry.path}|${entry.kind}|${entry.reason}`,
  );
  const reportAmendments = report.entries.map(
    (entry) => `${entry.path}|${entry.kind}|${entry.reason}`,
  );
  if (touchSetAmendments.length !== reportAmendments.length) {
    return "implementation-report.md scope_amendments must echo the same bounded amendments recorded in touch-set.json.";
  }
  for (const amendment of touchSetAmendments) {
    if (!reportAmendments.includes(amendment)) {
      return "implementation-report.md scope_amendments must echo the same bounded amendments recorded in touch-set.json.";
    }
  }
  return null;
}
