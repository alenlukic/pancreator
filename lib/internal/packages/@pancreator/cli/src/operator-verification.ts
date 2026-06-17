import { resolveRepoPath } from "@pancreator/core";
import { rfc3339UtcMs } from "@pancreator/run-logger";
import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";

export const OPERATOR_VERIFICATION_FILENAME = "operator-verification.md";

export interface OperatorVerificationState {
  taskId: string;
  featureId: string;
  artifacts: { runDir: string };
}

export interface OperatorVerificationValidation {
  ok: boolean;
  warnings: string[];
}

export function operatorVerificationRel(state: Pick<OperatorVerificationState, "artifacts">): string {
  return path.posix.join(state.artifacts.runDir, OPERATOR_VERIFICATION_FILENAME);
}

function readOptionalFile(repoRoot: string, rel: string): string | null {
  const abs = resolveRepoPath(repoRoot, rel);
  if (!existsSync(abs)) {
    return null;
  }
  try {
    return readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

function extractSpecAcceptanceBullets(specMarkdown: string | null): string[] {
  if (specMarkdown === null) {
    return [];
  }
  const bullets: string[] = [];
  const acSection = specMarkdown.match(/##\s+Acceptance criteria[\s\S]*?(?=^##\s|$)/imu);
  const source = acSection?.[0] ?? specMarkdown;
  for (const match of source.matchAll(/^-\s+(?:\[[ x]\]\s+)?(.+)$/gmu)) {
    const line = match[1]?.trim();
    if (line !== undefined && line.length > 0) {
      bullets.push(line);
    }
  }
  return bullets.slice(0, 8);
}

function extractTouchSetAcceptanceBullets(touchSetJson: string | null): string[] {
  if (touchSetJson === null) {
    return [];
  }
  try {
    const parsed = JSON.parse(touchSetJson) as Record<string, unknown>;
    const criteria = parsed.acceptance_criteria;
    if (!Array.isArray(criteria)) {
      return [];
    }
    return criteria
      .map((entry) => {
        if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
          return null;
        }
        const record = entry as Record<string, unknown>;
        const id = typeof record.id === "string" ? record.id.trim() : "";
        const criterion = typeof record.criterion === "string" ? record.criterion.trim() : "";
        if (criterion.length === 0) {
          return null;
        }
        return id.length > 0 ? `${id}: ${criterion}` : criterion;
      })
      .filter((value): value is string => value !== null)
      .slice(0, 8);
  } catch {
    return [];
  }
}

function extractManualVerificationBullets(testReport: string | null): string[] {
  if (testReport === null) {
    return [];
  }
  const section = testReport.match(/##\s+Manual verification[\s\S]*?(?=^##\s|$)/imu);
  if (section === null) {
    return [];
  }
  const bullets: string[] = [];
  for (const match of section[0].matchAll(/^-\s+(.+)$/gmu)) {
    const line = match[1]?.trim();
    if (line !== undefined && line.length > 0) {
      bullets.push(line);
    }
  }
  return bullets.slice(0, 6);
}

function extractTouchSetManualQaBullets(touchSetJson: string | null): string[] {
  if (touchSetJson === null) {
    return [];
  }
  try {
    const parsed = JSON.parse(touchSetJson) as Record<string, unknown>;
    const cases = parsed.manual_qa_test_cases;
    if (!Array.isArray(cases)) {
      return [];
    }
    return cases
      .map((entry) => {
        if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
          return null;
        }
        const record = entry as Record<string, unknown>;
        const id = typeof record.id === "string" ? record.id.trim() : "";
        const expected = typeof record.expected === "string" ? record.expected.trim() : "";
        const steps = Array.isArray(record.steps)
          ? record.steps.filter((step): step is string => typeof step === "string" && step.trim().length > 0)
          : [];
        if (id.length === 0 && steps.length === 0 && expected.length === 0) {
          return null;
        }
        const parts = [
          id.length > 0 ? id : null,
          steps[0] ?? null,
          expected.length > 0 ? `Expected: ${expected}` : null,
        ].filter((value): value is string => value !== null);
        return parts.join(" — ");
      })
      .filter((value): value is string => value !== null)
      .slice(0, 6);
  } catch {
    return [];
  }
}

export function renderOperatorVerificationScaffold(
  state: OperatorVerificationState,
  repoRoot: string,
  now: Date,
): string {
  const specRel = path.posix.join(state.artifacts.runDir, "spec.md");
  const deliveryRel = path.posix.join(state.artifacts.runDir, "delivery-report.md");
  const testReportRel = path.posix.join(state.artifacts.runDir, "test-report.md");
  const touchSetRel = path.posix.join(state.artifacts.runDir, "touch-set.json");
  const touchSetContent = readOptionalFile(repoRoot, touchSetRel);
  const touchSetCriteria = extractTouchSetAcceptanceBullets(touchSetContent);
  const touchSetManual = extractTouchSetManualQaBullets(touchSetContent);

  const specBullets =
    touchSetCriteria.length > 0
      ? touchSetCriteria
      : extractSpecAcceptanceBullets(readOptionalFile(repoRoot, specRel));
  const manualBullets =
    touchSetManual.length > 0
      ? touchSetManual
      : extractManualVerificationBullets(readOptionalFile(repoRoot, testReportRel));
  const hasDelivery = existsSync(resolveRepoPath(repoRoot, deliveryRel));
  const hasTouchSet = existsSync(resolveRepoPath(repoRoot, touchSetRel));

  const criteriaLines =
    specBullets.length > 0
      ? specBullets.map((item, index) => `- [ ] AC${index + 1}: ${item}`).join("\n")
      : [
          "- [ ] AC1: Replace with one observable pass/fail behavior from the shipped change.",
          "- [ ] AC2: Replace with one operator-visible outcome tied to the delivery report.",
        ].join("\n");

  const manualSeed =
    manualBullets.length > 0
      ? manualBullets.map((item) => `- Derived from qa-tester manual verification: ${item}`).join("\n")
      : "- No qa-tester manual verification bullets were found; author flows from the touch-set and delivery report.";

  return `# Operator verification — ${state.featureId}

- Task id: \`${state.taskId}\`
- Feature id: \`${state.featureId}\`
- Run directory: \`${state.artifacts.runDir}\`
- Generated at (UTC): \`${rfc3339UtcMs(now)}\`

## Acceptance criteria

${criteriaLines}

## Manual test flows

### Flow 1 — Smoke verification

**Preconditions:** Local repository at the post-ship revision; read \`${deliveryRel}\`${hasDelivery ? "" : " (missing — author from diff)"} and \`${touchSetRel}\`${hasTouchSet ? "" : " (missing — author from handoff)"}.

**Steps:**

1. Read-only: inspect the local diff and confirm the shipped scope matches the feature spec.
2. Execute one primary operator command or UI path documented in the delivery report.
3. Record pass/fail for each acceptance criterion above.

**Expected result:** Every acceptance criterion passes without unexpected regressions.

### Flow 2 — Residual and edge checks

**Preconditions:** Flow 1 complete.

**Steps:**

1. Re-run one validation command from \`${testReportRel}\` Automated checks (if present).
2. Exercise one edge case named in the delivery report or spec.

**Expected result:** Documented edge behavior matches expectation; note any residual issues for reopen.

## qa-tester manual verification seed

${manualSeed}

## Sign-off

When any criterion or flow fails, reopen the task:

\`\`\`bash
pnpm -w exec pan reopen ${state.taskId} --reason "Operator verification failed: describe criterion or flow"
\`\`\`

When satisfied, no further action is required beyond the archival record.
`;
}

export function validateOperatorVerificationMarkdown(content: string): OperatorVerificationValidation {
  const warnings: string[] = [];
  if (!/^#\s+Operator verification/mu.test(content)) {
    warnings.push("missing level-1 Operator verification heading");
  }
  if (!/^##\s+Acceptance criteria/mu.test(content)) {
    warnings.push("missing ## Acceptance criteria section");
  }
  if (!/^##\s+Manual test flows/mu.test(content)) {
    warnings.push("missing ## Manual test flows section");
  }
  const criteriaCount = (content.match(/^-\s+\[\s\]/gmu) ?? []).length;
  if (criteriaCount < 1) {
    warnings.push("Acceptance criteria MUST include at least one unchecked checkbox item");
  }
  if (!/^###\s+Flow/mu.test(content)) {
    warnings.push("Manual test flows MUST include at least one ### Flow subsection");
  }
  if (!/^\*\*Steps:\*\*/mu.test(content)) {
    warnings.push("Manual test flows MUST include Steps blocks");
  }
  if (!/^\*\*Expected result:\*\*/mu.test(content)) {
    warnings.push("Manual test flows MUST include Expected result blocks");
  }
  return { ok: warnings.length === 0, warnings };
}

export async function ensureOperatorVerificationDoc(
  repoRoot: string,
  state: OperatorVerificationState,
  now: Date,
): Promise<string> {
  const rel = operatorVerificationRel(state);
  const abs = resolveRepoPath(repoRoot, rel);
  if (existsSync(abs)) {
    return rel;
  }
  await writeFile(abs, renderOperatorVerificationScaffold(state, repoRoot, now), "utf8");
  return rel;
}
