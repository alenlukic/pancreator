/** The verify stage-output validator and its gate-evidence helpers. */

import path from 'node:path'

import { isRecord, readJson } from '../../io.js'
import {
  runAcceptanceProofs,
  type AcceptanceProof,
} from '../../acceptance-proof.js'
import type { HandlerResult, HandlerInput } from '../../requirements/types.js'
import { loadRepositoryChecks } from '../../repository-checks.js'
import { sharedChildFields, sharedEnum } from './field-contract.js'
import {
  VERIFY_ACCEPTANCE_RULES,
  VERIFY_FINDING_RULES,
  VERIFY_GATE_CITATION_RULES,
  VERIFY_QA_CASE_RULES,
  type VerifyItemRules,
  type VerifyRuleContext,
} from './refusal-registry.js'
import { issue } from './evidence.js'
import { planAcceptanceCriterionIds } from './plan-lookups.js'

/**
 * Check one verify array against its rules, and return the items that carry
 * an identity so the caller can apply the relations between them.
 */
function checkVerifyItems(
  items: unknown[],
  rules: VerifyItemRules,
  context: VerifyRuleContext,
  issues: HandlerResult['issues'],
): { item: Record<string, unknown>; index: number }[] {
  const valid: { item: Record<string, unknown>; index: number }[] = []

  for (const [index, raw] of items.entries()) {
    const item = isRecord(raw) ? raw : {}

    if (!rules.identity.satisfied(item, context)) {
      issues.push(
        issue(
          rules.identity.code,
          rules.identity.message(rules.positionLabel(index)),
        ),
      )
      continue
    }

    const label = rules.itemLabel(item)

    for (const rule of rules.fields) {
      if (!rule.satisfied(item, context)) {
        issues.push(issue(rule.code, rule.message(label)))
      }
    }

    valid.push({ item, index })
  }

  return valid
}

/** The repository-check profile command that free text names, if any. */
export function profileCommandInText(
  root: string,
  text: string,
): { profile: string; command: string } | null {
  let profiles: Record<string, { commands: string[] }>

  try {
    profiles = loadRepositoryChecks(root).profiles
  } catch {
    return null
  }

  const boundary = String.raw`(?:^|[\s\x60'"(;&|])`
  const terminal = String.raw`(?:$|[\s\x60'");&|])`

  for (const [profile, definition] of Object.entries(profiles)) {
    for (const command of definition.commands ?? []) {
      const escaped = command.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')

      if (new RegExp(`${boundary}${escaped}${terminal}`, 'u').test(text)) {
        return { profile, command }
      }
    }

    const literal = new RegExp(
      `${boundary}(?:\\./bin/)?pan repository-check ${profile}${terminal}`,
      'u',
    )

    if (literal.test(text)) {
      return { profile, command: `pan repository-check ${profile}` }
    }
  }

  // The literal form names a profile even when none is configured here. The
  // `validate` subcommand runs no profile.
  const anyProfile = new RegExp(
    `${boundary}(?:\\./bin/)?pan repository-check ([a-z][a-z0-9_-]*)${terminal}`,
    'u',
  ).exec(text)

  if (anyProfile && anyProfile[1] !== 'validate') {
    return {
      profile: anyProfile[1],
      command: `pan repository-check ${anyProfile[1]}`,
    }
  }

  return null
}

function currentGateEvidenceReferences(
  invocation: Record<string, unknown> | undefined,
): { path: string; profile: string; fingerprint: string }[] {
  const inputs =
    isRecord(invocation) && isRecord(invocation.inputs)
      ? invocation.inputs
      : null
  const references = Array.isArray(inputs?.references) ? inputs.references : []
  const current: { path: string; profile: string; fingerprint: string }[] = []

  for (const reference of references) {
    if (!isRecord(reference) || !isRecord(reference.gate_evidence)) {
      continue
    }

    const evidence = reference.gate_evidence

    if (
      evidence.current === true &&
      typeof reference.path === 'string' &&
      typeof evidence.profile === 'string' &&
      typeof evidence.fingerprint === 'string'
    ) {
      current.push({
        path: reference.path,
        profile: evidence.profile,
        fingerprint: evidence.fingerprint,
      })
    }
  }

  return current
}

/**
 * Whether this verify visit ran QA: the card launched a `qa` evidence worker
 * or a scoped return assigned the `qa` dimension. A validation with no card
 * in hand cannot tell, so it keeps the requirement.
 */
function verifyQaRan(invocation: Record<string, unknown> | undefined): boolean {
  if (!invocation) {
    return true
  }

  const roles = [
    ...(Array.isArray(invocation.evidence_workers)
      ? invocation.evidence_workers
      : []),
    ...(isRecord(invocation.scoped_return) &&
    Array.isArray(invocation.scoped_return.dimensions)
      ? invocation.scoped_return.dimensions
      : []),
  ].flatMap((entry) =>
    isRecord(entry) && typeof entry.role === 'string' ? [entry.role] : [],
  )

  return roles.includes('qa')
}

/**
 * Joint verification output for the delivery workflow's verify stage. One
 * stage carries both the review findings and the QA evidence, and one verdict
 * routes the run: pass and pass_with_warnings advance, fail_remedial and
 * fail_severe route to remediation. The demotion rule is deterministic here:
 * a passing verdict cannot coexist with a blocker finding, a failed
 * acceptance criterion, or a failed QA case, and a failing verdict must carry
 * reproducible remediation guidance because that guidance is the remediation
 * stage's primary input.
 */
export function validateVerifyOutput(input: HandlerInput): HandlerResult {
  const issues: HandlerResult['issues'] = []
  const value = readJson(path.join(input.root, input.targetPath)) as Record<
    string,
    unknown
  >

  if (value.result === 'blocked') {
    const data = isRecord(value.data) ? value.data : {}
    const verify = isRecord(data.verify) ? data.verify : null

    if (!verify) {
      return {
        status: 'failed',
        issues: [issue('verify.missing', 'data.verify is required')],
      }
    }

    const blockingReason =
      typeof verify.blocking_reason === 'string'
        ? verify.blocking_reason.trim()
        : ''

    if (blockingReason.length === 0) {
      issues.push(
        issue(
          'verify.blocking_reason',
          'blocked verify output MUST include a non-empty blocking_reason',
        ),
      )
    }

    const missingPaths = Array.isArray(verify.missing_evidence_paths)
      ? verify.missing_evidence_paths
      : []

    if (
      missingPaths.length === 0 ||
      !missingPaths.every(
        (entry) => typeof entry === 'string' && entry.trim().length > 0,
      )
    ) {
      issues.push(
        issue(
          'verify.missing_evidence',
          'blocked verify output MUST include non-empty missing_evidence_paths',
        ),
      )
    }

    const forbiddenFields = [
      'verdict',
      'findings',
      'qa_cases',
      'acceptance_results',
      'gate_evidence_citations',
      'remediation_guidance',
      'severity_rationale',
    ] as const

    for (const field of forbiddenFields) {
      if (verify[field] !== undefined) {
        issues.push(
          issue(
            'verify.blocked_forbidden_field',
            `blocked verify output MUST NOT include data.verify.${field}`,
          ),
        )
      }
    }

    return { status: issues.length === 0 ? 'passed' : 'failed', issues }
  }

  const data = isRecord(value.data) ? value.data : {}
  const verify = isRecord(data.verify) ? data.verify : null

  if (!verify) {
    return {
      status: 'failed',
      issues: [issue('verify.missing', 'data.verify is required')],
    }
  }

  const verdicts = sharedEnum(input.root, 'verify', 'data.verify.verdict')
  const verdict = typeof verify.verdict === 'string' ? verify.verdict : ''

  if (!verdicts.has(verdict)) {
    issues.push(
      issue('verify.verdict', 'data.verify.verdict MUST use an allowed value'),
    )
  }

  const severities = sharedEnum(
    input.root,
    'verify',
    'data.verify.findings[].severity',
  )
  const sources = sharedEnum(
    input.root,
    'verify',
    'data.verify.findings[].source',
  )
  const findings = Array.isArray(verify.findings) ? verify.findings : []

  const ruleContext: VerifyRuleContext = { severities, sources }

  checkVerifyItems(findings, VERIFY_FINDING_RULES, ruleContext, issues)

  const caseFields = sharedChildFields(
    input.root,
    'verify',
    'data.verify.qa_cases[].',
  )
  const qaCases = Array.isArray(verify.qa_cases) ? verify.qa_cases : []

  // VERIFY-001: QA runs only for a live criterion, so the cases are owed only
  // on a visit whose card ran the QA worker or assigned its dimension.
  if (qaCases.length === 0 && verifyQaRan(input.invocation)) {
    issues.push(issue('verify.qa_cases_missing', 'verify.qa_cases is required'))
  }

  for (const { item: qaCase } of checkVerifyItems(
    qaCases,
    VERIFY_QA_CASE_RULES,
    ruleContext,
    issues,
  )) {
    for (const field of caseFields) {
      if (
        typeof qaCase[field] !== 'string' ||
        (qaCase[field] as string).trim().length === 0
      ) {
        issues.push(
          issue(
            'verify.case_field',
            `QA case ${qaCase.id as string} MUST include ${field}`,
          ),
        )
      }
    }

    const rerun =
      typeof qaCase.steps === 'string'
        ? profileCommandInText(input.root, qaCase.steps)
        : null

    if (rerun) {
      issues.push(
        issue(
          'verify.case_reruns_profile',
          `QA case ${qaCase.id as string} runs \`${rerun.command}\`, the ` +
            `\`${rerun.profile}\` profile; cite the gate evidence for that ` +
            'profile instead',
        ),
      )
    }
  }

  // VERIFY-001: the output must cite every current gate-evidence reference.
  const citations = Array.isArray(verify.gate_evidence_citations)
    ? verify.gate_evidence_citations
    : []
  const citedKeys = new Set<string>()

  for (const { item: citation } of checkVerifyItems(
    citations,
    VERIFY_GATE_CITATION_RULES,
    ruleContext,
    issues,
  )) {
    citedKeys.add(
      `${citation.profile as string}\u0000${citation.fingerprint as string}` +
        `\u0000${citation.evidence_path as string}`,
    )
  }

  for (const reference of currentGateEvidenceReferences(input.invocation)) {
    const key = `${reference.profile}\u0000${reference.fingerprint}\u0000${reference.path}`

    if (!citedKeys.has(key)) {
      issues.push(
        issue(
          'verify.gate_citation_missing',
          `gate_evidence_citations MUST cite the \`${reference.profile}\` gate ` +
            `evidence at fingerprint \`${reference.fingerprint}\` (${reference.path})`,
        ),
      )
    }
  }

  const acceptanceResults = Array.isArray(verify.acceptance_results)
    ? verify.acceptance_results
    : []

  if (acceptanceResults.length === 0) {
    issues.push(
      issue(
        'verify.acceptance_missing',
        'verify.acceptance_results is required',
      ),
    )
  }

  const reportedIds = new Set<string>()
  // An `observe` result defers the criterion to a signal after ship, so it is
  // accepted only for a criterion whose proof is `observe`, and an `observe`
  // criterion accepts no other result: ship owes an observation for each one,
  // and a graded result would drop it silently. A proof no source declares
  // cannot be checked, and the result stands on the verifier's word.
  const proofs =
    acceptanceResults.length > 0
      ? runAcceptanceProofs(input.root, input.runState)
      : new Map<string, AcceptanceProof | null>()

  for (const { item } of checkVerifyItems(
    acceptanceResults,
    VERIFY_ACCEPTANCE_RULES,
    ruleContext,
    issues,
  )) {
    const id = item.id as string

    if (reportedIds.has(id)) {
      issues.push(
        issue('verify.acceptance_duplicate', `Duplicate acceptance id: ${id}`),
      )
    }

    reportedIds.add(id)

    const proof = proofs.get(id)

    if (
      item.result === 'observe' &&
      proof !== undefined &&
      proof !== null &&
      proof !== 'observe'
    ) {
      issues.push(
        issue(
          'verify.acceptance_observe_unproven',
          `Acceptance ${id} has proof ${proof}, so its result MUST NOT be ` +
            'observe. Only an observe criterion defers to a signal after ship',
        ),
      )
    }

    if (proof === 'observe' && item.result !== 'observe') {
      issues.push(
        issue(
          'verify.acceptance_observe_required',
          `Acceptance ${id} has proof observe, so its result MUST be ` +
            `observe, not ${String(item.result)}. Ship records a post-ship ` +
            'observation for it',
        ),
      )
    }
  }

  const expectedIds = planAcceptanceCriterionIds(
    input.root,
    input.targetPath,
    input.runState,
  )

  if (expectedIds.length > 0) {
    const expectedSet = new Set(expectedIds)

    for (const id of expectedIds) {
      if (!reportedIds.has(id)) {
        issues.push(
          issue(
            'verify.acceptance_missing',
            `Verify MUST report acceptance result for ${id}`,
          ),
        )
      }
    }

    for (const id of reportedIds) {
      if (!expectedSet.has(id)) {
        issues.push(
          issue(
            'verify.acceptance_unknown',
            `Unknown acceptance id not in plan: ${id}`,
          ),
        )
      }
    }
  }

  // A scoped return visit ran no evidence worker, so each dimension the card
  // assigned is a section of this output instead of a separate report.
  const scoped = isRecord(input.invocation?.scoped_return)
    ? input.invocation.scoped_return
    : null

  if (scoped) {
    const roles = (
      Array.isArray(scoped.dimensions) ? scoped.dimensions : []
    ).flatMap((dimension) =>
      isRecord(dimension) && typeof dimension.role === 'string'
        ? [dimension.role]
        : [],
    )
    const dimensions = isRecord(verify.dimensions) ? verify.dimensions : {}

    for (const role of roles) {
      const section = dimensions[role]

      if (!isRecord(section)) {
        issues.push(
          issue(
            'verify.dimension_missing',
            `scoped return visit MUST record data.verify.dimensions.${role}`,
          ),
        )
        continue
      }

      if (
        typeof section.summary !== 'string' ||
        section.summary.trim().length === 0
      ) {
        issues.push(
          issue(
            'verify.dimension_field',
            `data.verify.dimensions.${role}.summary MUST be a non-empty string`,
          ),
        )
      }

      if (
        !Array.isArray(section.evidence) ||
        section.evidence.length === 0 ||
        !section.evidence.every(
          (entry) => typeof entry === 'string' && entry.trim().length > 0,
        )
      ) {
        issues.push(
          issue(
            'verify.dimension_field',
            `data.verify.dimensions.${role}.evidence MUST be a non-empty ` +
              'array of non-empty strings',
          ),
        )
      }
    }

    for (const finding of findings) {
      if (
        isRecord(finding) &&
        typeof finding.source === 'string' &&
        !roles.includes(finding.source)
      ) {
        issues.push(
          issue(
            'verify.dimension_source',
            `finding ${String(finding.id)} names source '${finding.source}', ` +
              `which this scoped visit does not cover (${roles.join(', ')})`,
          ),
        )
      }
    }
  }

  const blockerFinding = findings.some(
    (item) => isRecord(item) && item.severity === 'blocker',
  )
  const warningFinding = findings.some(
    (item) => isRecord(item) && item.severity !== 'blocker',
  )
  const failedAcceptance = acceptanceResults.some(
    (item) => isRecord(item) && item.result === 'fail',
  )
  const failedCase = qaCases.some(
    (item) => isRecord(item) && item.result === 'fail',
  )

  const failingEvidence = blockerFinding || failedAcceptance || failedCase
  const passingVerdict = verdict === 'pass' || verdict === 'pass_with_warnings'
  const failingVerdict =
    verdict === 'fail_remedial' || verdict === 'fail_severe'

  if (passingVerdict && failingEvidence) {
    issues.push(
      issue(
        'verify.verdict_inconsistent',
        'passing verdict inconsistent with a blocker finding, failed acceptance criterion, or failed QA case',
      ),
    )
  }

  if (verdict === 'pass' && warningFinding) {
    issues.push(
      issue(
        'verify.verdict_inconsistent',
        'pass verdict with open findings MUST be pass_with_warnings',
      ),
    )
  }

  if (verdict === 'pass_with_warnings' && !warningFinding) {
    issues.push(
      issue(
        'verify.verdict_inconsistent',
        'pass_with_warnings requires at least one non-blocker finding',
      ),
    )
  }

  if (failingVerdict && !failingEvidence) {
    issues.push(
      issue(
        'verify.verdict_inconsistent',
        'failing verdict requires a blocker finding, failed acceptance criterion, or failed QA case',
      ),
    )
  }

  if (failingVerdict) {
    const guidance =
      typeof verify.remediation_guidance === 'string'
        ? verify.remediation_guidance.trim()
        : ''

    if (guidance.length === 0) {
      issues.push(
        issue(
          'verify.remediation_guidance',
          'failing verdict MUST include reproducible remediation_guidance',
        ),
      )
    }
  }

  if (verdict === 'fail_severe') {
    const rationale =
      typeof verify.severity_rationale === 'string'
        ? verify.severity_rationale.trim()
        : ''

    if (rationale.length === 0) {
      issues.push(
        issue(
          'verify.severity_rationale',
          'fail_severe MUST justify why the failure is fundamental in severity_rationale',
        ),
      )
    }
  }

  if (value.result === 'success' && failingVerdict) {
    issues.push(
      issue(
        'verify.result_inconsistent',
        'result success inconsistent with a failing verdict',
      ),
    )
  }

  if (value.result === 'failure' && passingVerdict) {
    issues.push(
      issue(
        'verify.result_inconsistent',
        'result failure inconsistent with a passing verdict',
      ),
    )
  }

  return { status: issues.length === 0 ? 'passed' : 'failed', issues }
}
