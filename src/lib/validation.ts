import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'

import { errorMessage, isNodeError } from './errors.js'
import {
  ensureDir,
  fileExists,
  isRecord,
  lastEvidenceLine,
  readJson,
  readText,
  resolveInside,
  sha256,
  toRepoRelative,
  writeTextAtomic,
} from './io.js'
import { loadPipelineConfig, resolveConfigPersonas } from './pipeline-config.js'
import {
  assertRepositoryChecksValid,
  commandFailureDiagnostics,
  compareRepositoryCheckToBaseline,
  repositoryCheckProfileName,
  runRepositoryCheck,
} from './repository-checks.js'
import type {
  RepositoryCheckBaselineArtifact,
  RepositoryCheckResult,
} from './repository-checks.js'
import type { LoadedPipelineConfig } from './pipeline-config.js'
import { auditDirectives } from './governance/audit-directives.js'
import { HANDLER_IDS } from './requirements/handlers.js'
import { resolveRunLayout } from './run-layout.js'
import { loadRegistry, validateRegistry } from './requirements/registry.js'
import {
  resolveRequirements,
  validatePolicyRequirements,
} from './requirements/resolve.js'
import { validateProjectionDrift } from './projection.js'
import {
  loadPolicyCatalog,
  readPolicyLookupTable,
  resolvePolicies,
} from './policies.js'
import {
  guidanceDigestToken,
  guidanceInlineHeading,
  guidanceReferenceHeading,
  guidanceSelectedRange,
  renderGuidanceBlock,
} from './policy-guidance.js'
import {
  isTargetInstallation,
  isSelfDevelopmentInstallation,
} from './project-config.js'
import {
  gateCacheKey,
  gateCacheLookup,
  gateCacheStore,
  gateCacheableSnapshot,
} from './gate-cache.js'
import {
  gitWorkspaceSnapshot,
  workspaceChangedPathsFromSnapshots,
} from './git.js'
import { listWorkflowSlugs, loadWorkflow } from './workflow.js'
import {
  applyOperatorInvolvement,
  loadOperatorInvolvementFile,
} from './operator-involvement.js'
import { activeOperatorGateWaivers } from './waivers.js'
import { isReleaseMetadataPath, validateReleaseMetadata } from './versioning.js'
import type {
  ArtifactReference,
  Criterion,
  CriterionEvaluation,
  DeterministicResult,
  ExternalDelegationRecord,
  Invocation,
  InvocationContractManifest,
  InvocationDeliveryMode,
  JsonTypeName,
  OperatorInvolvementFile,
  OperatorInvolvementProfile,
  Policy,
  PolicyGuidance,
  PolicyLookupRow,
  PolicyLookupTable,
  RepositoryValidationResult,
  RunState,
  StageDefinition,
  StageHistoryItem,
  StageOutput,
  StageOutcome,
  WorkspaceSnapshot,
} from './types.js'

export const POLICIES_HEADING = '## 📜 Policies in force'
export const PRIOR_FAILURE_HEADING = '## ⛔ Why the previous attempt failed'

/** Head and tail bytes preserved per stream in a deterministic-gate evidence log. */
const EVIDENCE_STREAM_HEAD_BYTES = 64 * 1024
const EVIDENCE_STREAM_TAIL_BYTES = 16 * 1024

function boundEvidenceStream(value: string): string {
  const budget = EVIDENCE_STREAM_HEAD_BYTES + EVIDENCE_STREAM_TAIL_BYTES

  if (value.length <= budget) {
    return value
  }

  return [
    value.slice(0, EVIDENCE_STREAM_HEAD_BYTES),
    `\n…[${value.length - budget} bytes elided; see the full log beside this one]…\n`,
    value.slice(value.length - EVIDENCE_STREAM_TAIL_BYTES),
  ].join('')
}
export const DELEGATION_HEADING = '## 🧭 Supervisor delivery procedure'
export const AGENT_REQUIREMENTS_HEADING = '## ✅ Agent validation requirements'
export const HARNESS_REQUIREMENTS_HEADING = '## 🧰 Harness-owned checks'

export interface ValidationCheck {
  id: string
  passed: boolean
  message: string
}

export interface ValidationResultArtifact {
  schema_version: 1
  run_id: string
  invocation_id: string
  kind: 'invocation' | 'delegation' | 'attestation'
  status: 'pass' | 'fail'
  summary: string
  checks: ValidationCheck[]
  validated_at: string
  artifact_path: string
}

export type ValidationArtifactLoad =
  | ValidationResultArtifact
  | { state: 'missing' }
  | { state: 'malformed'; reason: string }

export interface InvocationValidationStatus {
  invocation: ValidationArtifactLoad
  delegation: ValidationArtifactLoad
  invocation_validation_path: string
  delegation_validation_path: string
  delegation_path: string
}

export function normalizeMarkdownContent(content: string): string {
  return content.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
}

function normalizeDelegationContent(content: string): string {
  const normalized = normalizeMarkdownContent(content)
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/u, ''))
    .join('\n')
    .trimEnd()

  return `${normalized}\n`
}

/**
 * Layout v2 collects per-invocation validation artifacts under the run's
 * `validations/` directory. A layout-v1 run keeps them beside the invocation,
 * because its earlier stages already wrote them there.
 */
function invocationValidationArtifactPath(
  runId: string,
  invocationId: string,
  extension: string,
  root?: string,
): string {
  if (!root) {
    return `runtime/logs/workflows/${runId}/invocations/${invocationId}${extension}`
  }

  const layout = resolveRunLayout(root, runId)

  return layout.version === 'v2'
    ? layout.validation(`${invocationId}${extension}`).relative
    : layout.invocation(invocationId, extension).relative
}

export function invocationValidationPath(
  runId: string,
  invocationId: string,
  root?: string,
): string {
  return invocationValidationArtifactPath(
    runId,
    invocationId,
    '.invocation-validation.json',
    root,
  )
}

export function delegationPath(
  runId: string,
  invocationId: string,
  root?: string,
): string {
  return root
    ? resolveRunLayout(root, runId).invocation(invocationId, '.delegation.md')
        .relative
    : `runtime/logs/workflows/${runId}/invocations/${invocationId}.delegation.md`
}

/** Sibling path holding the exact prompt body a referenced delivery uses. */
export function deliveryPromptPath(
  runId: string,
  invocationId: string,
  root?: string,
): string {
  return root
    ? resolveRunLayout(root, runId).invocation(invocationId, '.delivery.md')
        .relative
    : `runtime/logs/workflows/${runId}/invocations/${invocationId}.delivery.md`
}

const MISPLACED_DELEGATION_RELATIVE_PATH = '.delegation.md'

/** Relocate a workspace-root delegation artifact to the invocation-scoped path. */
export function relocateMisplacedDelegationArtifact(
  root: string,
  runId: string,
  invocationId: string,
): boolean {
  const misplacedAbsolute = resolveInside(
    root,
    MISPLACED_DELEGATION_RELATIVE_PATH,
  )

  if (!fileExists(misplacedAbsolute)) {
    return false
  }

  const targetRelative = delegationPath(runId, invocationId, root)
  const targetAbsolute = resolveInside(root, targetRelative)

  ensureDir(path.dirname(targetAbsolute))

  if (!fileExists(targetAbsolute)) {
    writeTextAtomic(targetAbsolute, readText(misplacedAbsolute))
  }

  rmSync(misplacedAbsolute, { force: true })

  return true
}

export function delegationValidationPath(
  runId: string,
  invocationId: string,
  root?: string,
): string {
  return invocationValidationArtifactPath(
    runId,
    invocationId,
    '.delegation-validation.json',
    root,
  )
}

/**
 * Harness-authored execution audit for an external-executor delegation:
 * executor identity, argument vector, exit status, and session.
 */
export function delegationExecutionPath(
  runId: string,
  invocationId: string,
  root?: string,
): string {
  return root
    ? resolveRunLayout(root, runId).invocation(
        invocationId,
        '.delegation-execution.json',
      ).relative
    : `runtime/logs/workflows/${runId}/invocations/${invocationId}.delegation-execution.json`
}

/** Executor session recorded beside the invocation artifacts for later resume. */
export function sessionRecordPath(
  runId: string,
  invocationId: string,
  root?: string,
): string {
  return root
    ? resolveRunLayout(root, runId).invocation(invocationId, '.session.json')
        .relative
    : `runtime/logs/workflows/${runId}/invocations/${invocationId}.session.json`
}

export function loadDelegationExecutionRecord(
  root: string,
  runId: string,
  invocationId: string,
): ExternalDelegationRecord | null {
  const absolute = resolveInside(
    root,
    delegationExecutionPath(runId, invocationId, root),
  )

  if (!fileExists(absolute)) {
    return null
  }

  const value = readJson(absolute)

  return isRecord(value) && value.schema_version === 1
    ? (value as unknown as ExternalDelegationRecord)
    : null
}

/**
 * Which body the delegation artifact must reproduce, and the matching delivery
 * mode label.
 *
 * A cursor `referenced` delegation owes the compact delivery prompt; a cursor
 * `verbatim` one owes the whole card. An external delegation owes the card for
 * a fresh delivery, but a `resumed` revision round delivers a compact directive
 * that references the card — the harness persists that directive at the
 * delivery-prompt path, so the comparison follows the execution record.
 */
export function expectedDelegationSource(
  root: string,
  invocation: Invocation,
): { path: string; mode: InvocationDeliveryMode } {
  const runId = invocation.run_id
  const invocationId = invocation.invocation_id
  const delegation = invocation.delegation
  const canonicalPath =
    delegation?.canonical_markdown_path ??
    resolveRunLayout(root, runId).invocation(invocationId, '.md').relative

  if (delegation?.mode === 'referenced' && delegation.delivery_prompt_path) {
    return { path: delegation.delivery_prompt_path, mode: 'referenced' }
  }

  const personaExecutor = invocation.stage.persona_executor ?? 'cursor'

  if (personaExecutor !== 'cursor') {
    const record = loadDelegationExecutionRecord(root, runId, invocationId)

    if (record?.delegation_kind === 'resumed') {
      return {
        path: deliveryPromptPath(runId, invocationId, root),
        mode: 'referenced',
      }
    }
  }

  return { path: canonicalPath, mode: 'verbatim' }
}

export function attestationValidationPath(
  runId: string,
  invocationId: string,
  root?: string,
): string {
  return invocationValidationArtifactPath(
    runId,
    invocationId,
    '.attestation-validation.json',
    root,
  )
}

export function buildValidationArtifact(options: {
  run_id: string
  invocation_id: string
  kind: 'invocation' | 'delegation' | 'attestation'
  status: 'pass' | 'fail'
  checks: ValidationCheck[]
  artifact_path: string
  validated_at?: string
}): ValidationResultArtifact {
  const failed = options.checks.filter((check) => !check.passed)
  const summary =
    options.status === 'pass'
      ? `All ${options.checks.length} validation check(s) passed.`
      : `${failed.length} check(s) failed: ${failed.map((check) => check.id).join(', ')}`

  return {
    schema_version: 1,
    run_id: options.run_id,
    invocation_id: options.invocation_id,
    kind: options.kind,
    status: options.status,
    summary,
    checks: options.checks,
    validated_at: options.validated_at ?? new Date().toISOString(),
    artifact_path: options.artifact_path,
  }
}

/**
 * Check how one policy guidance range reaches the rendered contract.
 *
 * A resolved reference is checked for its heading, its read trigger, a digest
 * that matches the snapshot content, and the absence of the guidance body. The
 * absence check is the load-bearing one: it is what keeps a renderer from
 * silently restoring the full body and undoing progressive disclosure. Guidance
 * without a reference belongs to an invocation prepared before progressive
 * disclosure existed, so it keeps the original inline-content contract and an
 * in-flight legacy run can still submit.
 */
function guidanceChecks(options: {
  id_prefix: string
  label: string
  guidance: PolicyGuidance
  markdown: string
}): ValidationCheck[] {
  const { id_prefix: idPrefix, label, guidance, markdown } = options
  const { reference } = guidance

  if (!reference) {
    const heading = guidanceInlineHeading(3, guidance.source_path)

    return [
      {
        id: `${idPrefix}.heading`,
        passed: markdown.includes(heading),
        message: markdown.includes(heading)
          ? `${label} heading is present`
          : `Markdown MUST identify inline guidance ${guidance.source_path}`,
      },
      {
        id: `${idPrefix}.content`,
        passed: markdown.includes(guidance.content),
        message: markdown.includes(guidance.content)
          ? `${label} content is present`
          : `Markdown MUST inline guidance from ${guidance.source_path}`,
      },
    ]
  }

  const heading = guidanceReferenceHeading(3, guidance.source_path)
  const digestToken = guidanceDigestToken(reference)
  const selectedRange = `Selected range: ${guidanceSelectedRange(reference)}.`
  const referenceBlockLines = renderGuidanceBlock(3, guidance)
  const referenceBlock = referenceBlockLines.join('\n')
  // An invocation rendered before the digest-basis line existed carries the
  // reference block without it. Accepting that block keeps an in-flight run
  // valid across the upgrade; a fresh render always carries the basis line.
  const legacyReferenceBlock = referenceBlockLines.slice(0, -1).join('\n')
  const referenceBlockPresent =
    markdown.includes(referenceBlock) || markdown.includes(legacyReferenceBlock)
  const digestMatchesContent =
    reference.content_sha256 === sha256(guidance.content)
  const lineCountMatchesContent =
    reference.line_count === guidance.content.split('\n').length
  const byteLengthMatchesContent =
    reference.byte_length === Buffer.byteLength(guidance.content, 'utf8')
  const bodyAbsent = !markdown.includes(guidance.content)

  return [
    {
      id: `${idPrefix}.heading`,
      passed: markdown.includes(heading),
      message: markdown.includes(heading)
        ? `${label} reference heading is present`
        : `Markdown MUST reference guidance ${guidance.source_path}`,
    },
    {
      id: `${idPrefix}.read_trigger`,
      passed: markdown.includes(reference.read_trigger),
      message: markdown.includes(reference.read_trigger)
        ? `${label} states when to read the source`
        : `Markdown MUST state the read trigger for ${guidance.source_path}`,
    },
    {
      id: `${idPrefix}.selected_range`,
      passed: markdown.includes(selectedRange),
      message: markdown.includes(selectedRange)
        ? `${label} states the selected source range`
        : `Markdown MUST state the selected range for ${guidance.source_path}`,
    },
    {
      id: `${idPrefix}.digest`,
      passed: markdown.includes(digestToken),
      message: markdown.includes(digestToken)
        ? `${label} carries the selected content digest`
        : `Markdown MUST carry '${digestToken}' for ${guidance.source_path}`,
    },
    {
      id: `${idPrefix}.digest_matches_snapshot`,
      passed: digestMatchesContent,
      message: digestMatchesContent
        ? `${label} digest matches the snapshot content`
        : `${label} digest MUST match the snapshot content of ${guidance.source_path}`,
    },
    {
      id: `${idPrefix}.line_count_matches_snapshot`,
      passed: lineCountMatchesContent,
      message: lineCountMatchesContent
        ? `${label} line count matches the snapshot content`
        : `${label} line count MUST match the snapshot content of ${guidance.source_path}`,
    },
    {
      id: `${idPrefix}.byte_length_matches_snapshot`,
      passed: byteLengthMatchesContent,
      message: byteLengthMatchesContent
        ? `${label} byte length matches the snapshot content`
        : `${label} byte length MUST match the snapshot content of ${guidance.source_path}`,
    },
    {
      id: `${idPrefix}.reference_block`,
      passed: referenceBlockPresent,
      message: referenceBlockPresent
        ? `${label} reference fields are contiguous and exact`
        : `Markdown MUST render the exact reference block for ${guidance.source_path}`,
    },
    {
      id: `${idPrefix}.body_absent`,
      passed: bodyAbsent,
      message: bodyAbsent
        ? `${label} body stays in the invocation snapshot`
        : `Markdown MUST NOT inline the guidance body of ${guidance.source_path}`,
    },
  ]
}

/**
 * Workflow lifecycle commands are supervisor-owned. A worker-visible contract
 * that prints one invites the worker to run it, so invocation validation
 * rejects any of these in the card when the delegation names a separate
 * supervisor procedure document.
 */
const WORKER_LIFECYCLE_COMMAND_PATTERN =
  /pan\s+(submit|decide|set-stage|waive-gate|delegate|abort)\b/u

export function validateInvocationMarkdown(
  invocation: Invocation,
  markdown: string,
  supervisorProcedureMarkdown?: string,
): { passed: boolean; checks: ValidationCheck[] } {
  const checks: ValidationCheck[] = []
  const normalized = normalizeMarkdownContent(markdown)

  checks.push({
    id: 'policies.non_empty',
    passed: invocation.policies.length > 0,
    message:
      invocation.policies.length > 0
        ? `${invocation.policies.length} policies in invocation snapshot`
        : 'invocation.policies MUST NOT be empty',
  })

  checks.push({
    id: 'policies.heading',
    passed: normalized.includes(POLICIES_HEADING),
    message: normalized.includes(POLICIES_HEADING)
      ? 'Policy section heading is present'
      : `Markdown MUST contain '${POLICIES_HEADING}'`,
  })

  for (const policy of invocation.policies) {
    const header = `**${policy.id} · ${policy.title}**`

    checks.push({
      id: `policy.${policy.id}.header`,
      passed: normalized.includes(header),
      message: normalized.includes(header)
        ? `Policy ${policy.id} header is present`
        : `Markdown MUST include policy id and title for ${policy.id}`,
    })

    checks.push({
      id: `policy.${policy.id}.summary`,
      passed: normalized.includes(policy.summary),
      message: normalized.includes(policy.summary)
        ? `Policy ${policy.id} summary is present`
        : `Markdown MUST include policy ${policy.id} summary text`,
    })

    for (const [index, instruction] of policy.instructions.entries()) {
      checks.push({
        id: `policy.${policy.id}.instruction.${index + 1}`,
        passed: normalized.includes(instruction),
        message: normalized.includes(instruction)
          ? `Policy ${policy.id} instruction ${index + 1} is present`
          : `Markdown MUST include policy ${policy.id} instruction ${index + 1}`,
      })
    }

    for (const [index, guidance] of (policy.guidance ?? []).entries()) {
      checks.push(
        ...guidanceChecks({
          id_prefix: `policy.${policy.id}.guidance.${index + 1}`,
          label: `Policy ${policy.id} guidance ${index + 1}`,
          guidance,
          markdown: normalized,
        }),
      )
    }
  }

  // A retry card that does not state the recorded failure reason lets a worker
  // resubmit the same defect, so the reason being rendered is itself a contract.
  if (invocation.prior_failure) {
    const failure = invocation.prior_failure

    checks.push({
      id: 'prior_failure.heading',
      passed: normalized.includes(PRIOR_FAILURE_HEADING),
      message: normalized.includes(PRIOR_FAILURE_HEADING)
        ? 'Prior-attempt failure reason is present'
        : `Markdown MUST contain '${PRIOR_FAILURE_HEADING}'`,
    })

    const renderedReasons = [
      ...failure.failed_hard_criteria.map((item) => item.id),
      ...failure.failed_deterministic.map((item) => item.id),
      ...failure.validation_errors,
      ...failure.governance_artifact_warnings,
    ]

    for (const [index, reason] of renderedReasons.entries()) {
      checks.push({
        id: `prior_failure.reason.${index + 1}`,
        passed: normalized.includes(reason),
        message: normalized.includes(reason)
          ? `Prior failure reason ${index + 1} is inlined`
          : `Markdown MUST inline prior failure reason '${reason}'`,
      })
    }
  }

  if (invocation.delegation) {
    const { delegation } = invocation
    // A delegation that names a supervisor procedure document keeps every
    // lifecycle command there; the card holds only a pointer section. Legacy
    // delegations inline the whole procedure on the card, so their checks run
    // against the card body.
    const split = typeof delegation.supervisor_procedure_path === 'string'
    const procedure = split
      ? normalizeMarkdownContent(supervisorProcedureMarkdown ?? '')
      : normalized
    const procedureLabel = split
      ? 'the supervisor procedure document'
      : 'the card'

    checks.push({
      id: 'delegation.heading',
      passed: normalized.includes(DELEGATION_HEADING),
      message: normalized.includes(DELEGATION_HEADING)
        ? 'Supervisor delivery procedure is present'
        : `Markdown MUST contain '${DELEGATION_HEADING}'`,
    })

    if (split) {
      const procedurePath = delegation.supervisor_procedure_path ?? ''

      checks.push({
        id: 'delegation.procedure_path',
        passed: normalized.includes(procedurePath),
        message: normalized.includes(procedurePath)
          ? 'Supervisor procedure path is resolved in the card'
          : `Markdown MUST name the supervisor procedure document: ${procedurePath}`,
      })
      checks.push({
        id: 'delegation.procedure_document',
        passed: procedure.includes(DELEGATION_HEADING),
        message: procedure.includes(DELEGATION_HEADING)
          ? 'Supervisor procedure document is present'
          : `The supervisor procedure document at ${procedurePath} MUST contain '${DELEGATION_HEADING}'`,
      })

      const lifecycleMatch = WORKER_LIFECYCLE_COMMAND_PATTERN.exec(normalized)

      checks.push({
        id: 'delegation.worker_isolation',
        passed: lifecycleMatch === null,
        message:
          lifecycleMatch === null
            ? 'Worker-visible contract carries no workflow lifecycle command'
            : `Worker-visible contract MUST NOT contain the lifecycle command 'pan ${lifecycleMatch[1]}'`,
      })
    }

    checks.push({
      id: 'delegation.policies_present',
      passed: delegation.policies.length > 0,
      message:
        delegation.policies.length > 0
          ? `${delegation.policies.length} supervisor delivery policies are inline`
          : 'Delegated stages MUST inline INVOCATION-001 for the supervisor',
    })

    for (const policy of delegation.policies) {
      for (const [index, instruction] of policy.instructions.entries()) {
        checks.push({
          id: `delegation.${policy.id}.instruction.${index + 1}`,
          passed: procedure.includes(instruction),
          message: procedure.includes(instruction)
            ? `Delivery policy ${policy.id} instruction ${index + 1} is present`
            : `${procedureLabel} MUST inline ${policy.id} instruction ${index + 1} for the supervisor`,
        })
      }
    }

    for (const [id, value] of [
      ['canonical_path', delegation.canonical_markdown_path],
      ['validation_path', delegation.invocation_validation_path],
      ['artifact_path', delegation.delegation_artifact_path],
      ...(delegation.cursor_agent_path
        ? ([['agent_path', delegation.cursor_agent_path]] as const)
        : []),
      ...(delegation.delegate_command
        ? ([['delegate_command', delegation.delegate_command]] as const)
        : []),
      ['submit_command', delegation.submit_command],
      ...(delegation.delivery_prompt_path
        ? ([['delivery_prompt_path', delegation.delivery_prompt_path]] as const)
        : []),
    ] as const) {
      checks.push({
        id: `delegation.${id}`,
        passed: procedure.includes(value),
        message: procedure.includes(value)
          ? `Delivery ${id} is resolved in ${procedureLabel}`
          : `${procedureLabel} MUST resolve the delivery ${id}: ${value}`,
      })
    }
  }

  if (invocation.requirements) {
    const requirements = [
      ...invocation.requirements.automation_requirements,
      ...invocation.requirements.validation_requirements,
    ]
    const agentRequirements = requirements.filter(
      (requirement) => requirement.executor !== 'harness',
    )
    const harnessRequirements = requirements.filter(
      (requirement) => requirement.executor === 'harness',
    )

    if (agentRequirements.length > 0) {
      checks.push({
        id: 'requirements.agent_heading',
        passed: normalized.includes(AGENT_REQUIREMENTS_HEADING),
        message: normalized.includes(AGENT_REQUIREMENTS_HEADING)
          ? 'Agent requirements section heading is present'
          : `Markdown MUST contain '${AGENT_REQUIREMENTS_HEADING}'`,
      })
    }

    if (harnessRequirements.length > 0) {
      checks.push({
        id: 'requirements.harness_heading',
        passed: normalized.includes(HARNESS_REQUIREMENTS_HEADING),
        message: normalized.includes(HARNESS_REQUIREMENTS_HEADING)
          ? 'Harness requirements section heading is present'
          : `Markdown MUST contain '${HARNESS_REQUIREMENTS_HEADING}'`,
      })
    }

    for (const requirement of agentRequirements) {
      const row = `| ${requirement.policy_id} | ${requirement.requirement_id} |`

      checks.push({
        id: `requirement.${requirement.policy_id}.${requirement.requirement_id}`,
        passed: normalized.includes(row),
        message: normalized.includes(row)
          ? `Requirement ${requirement.requirement_id} is rendered`
          : `Markdown MUST include requirement row for ${requirement.requirement_id}`,
      })
    }

    for (const requirement of harnessRequirements) {
      const line =
        `\`${requirement.registry_id}@${requirement.registry_version}\` — ` +
        `${requirement.requirement_id} (${requirement.phase}, ${requirement.enforcement})`

      checks.push({
        id: `requirement.${requirement.policy_id}.${requirement.requirement_id}`,
        passed: normalized.includes(line),
        message: normalized.includes(line)
          ? `Harness requirement ${requirement.requirement_id} is rendered`
          : `Markdown MUST include harness requirement ${requirement.requirement_id}`,
      })
    }
  }

  return {
    passed: checks.every((check) => check.passed),
    checks,
  }
}

/** Longest leading persona label the delegation contract tolerates. */
const DELEGATION_LABEL_MAX_LENGTH = 80

/**
 * Identity line the supervisor procedure generates ahead of the delivered
 * body, e.g. `Agent: pan-coder` or `Persona: \`coder\`.`. Only these keys
 * qualify for the two-line prefix, so free prose can never stack into a
 * parallel instruction.
 */
const DELEGATION_IDENTITY_LINE = /^(?:Agent|Persona):\s\S/u

function qualifiesAsDelegationLabel(line: string): boolean {
  return (
    line.trim().length > 0 &&
    line.length <= DELEGATION_LABEL_MAX_LENGTH &&
    !/^\s*(?:[#>*\-+]|\d+[.)]|```|\|)/u.test(line)
  )
}

/**
 * Enumerate every reading of the minimal non-conflicting persona label
 * `INVOCATION-001` and the supervisor commands explicitly permit ahead of the
 * pasted card.
 *
 * A label qualifies when it is a single short line that starts no Markdown
 * structure and is followed by a blank line, so it cannot smuggle in a
 * heading, list item, or parallel instruction that would shadow the card. Two
 * leading lines qualify only when both are `Agent:`/`Persona:` identity lines
 * — the exact prefix the supervisor procedure generates — again followed by a
 * blank line. Both readings are returned because the delivered body itself
 * begins with a harness-generated `Persona:` line, so only comparison against
 * the expected body can tell which lines are label and which are body.
 */
function permittedDelegationLabelReadings(
  delegation: string,
): Array<{ body: string; label: string | null }> {
  const readings: Array<{ body: string; label: string | null }> = [
    { body: delegation, label: null },
  ]
  const lines = delegation.split('\n')
  const [first = '', second = '', third = ''] = lines

  if (
    qualifiesAsDelegationLabel(first) &&
    second.trim().length === 0 &&
    lines.length > 2
  ) {
    readings.push({ body: lines.slice(2).join('\n'), label: first.trim() })
  }

  if (
    qualifiesAsDelegationLabel(first) &&
    qualifiesAsDelegationLabel(second) &&
    DELEGATION_IDENTITY_LINE.test(first) &&
    DELEGATION_IDENTITY_LINE.test(second) &&
    third.trim().length === 0 &&
    lines.length > 3
  ) {
    readings.push({
      body: lines.slice(3).join('\n'),
      label: `${first.trim()} / ${second.trim()}`,
    })
  }

  return readings
}

/**
 * Compare delegation evidence with the body the supervisor was required to
 * deliver.
 *
 * Under `verbatim` mode that body is the canonical card. Under `referenced` mode
 * it is the compact delivery prompt, which names the card as the worker
 * contract. Either way the comparison is exact after line-ending normalization,
 * so the supervisor cannot narrow, summarize, or shadow what it delivered.
 */
export function validateDelegationMarkdown(
  expectedMarkdown: string,
  delegationMarkdown: string,
  mode: InvocationDeliveryMode = 'verbatim',
): { passed: boolean; checks: ValidationCheck[] } {
  const expectedNormalized = normalizeDelegationContent(expectedMarkdown)
  const delegationNormalized = normalizeDelegationContent(delegationMarkdown)

  const exact = expectedNormalized === delegationNormalized
  const matched = exact
    ? { body: delegationNormalized, label: null }
    : permittedDelegationLabelReadings(delegationNormalized).find(
        (reading) => reading.body === expectedNormalized,
      )
  const label = matched?.label ?? null
  const passed = exact || matched !== undefined
  const subject =
    mode === 'referenced'
      ? 'the compact delivery prompt'
      : 'the canonical invocation card'

  const checks: ValidationCheck[] = [
    {
      id: 'delegation.canonical_equality',
      passed,
      message: passed
        ? label
          ? `Delegation artifact matches ${subject} after the permitted persona label '${label}'`
          : `Delegation artifact matches ${subject}`
        : `Delegation artifact MUST equal ${subject} after line-ending and trailing-whitespace normalization, except for one permitted leading persona label (or the 'Agent:'/'Persona:' identity-line pair) followed by a blank line`,
    },
    {
      id: 'delegation.mode',
      passed: true,
      message: `Delivery mode is '${mode}'`,
    },
  ]

  if (label) {
    checks.push({
      id: 'delegation.label_minimal',
      passed: true,
      message: `Leading persona label '${label}' precedes the delivered body`,
    })
  }

  return { passed, checks }
}

function attestationSections(value: unknown): Array<{
  id: unknown
  sha256: unknown
}> {
  if (!Array.isArray(value)) {
    return []
  }

  return value.map((item) =>
    isRecord(item)
      ? { id: item.id, sha256: item.sha256 }
      : { id: undefined, sha256: undefined },
  )
}

/**
 * Check the worker's guidance declarations against the manifest's guidance
 * index. Progressive disclosure moved guidance bodies off the card, and these
 * checks are what make the mandated reads observable: every referenced
 * selection needs a worker decision — `read`, `skipped` with the reason the
 * trigger did not apply, or `reference_failed` with the concrete error. A
 * failed reference fails the attestation, because the worker acted without
 * guidance the policy holds it to; re-preparation resolves the source loudly.
 *
 * A manifest without a guidance index belongs to an invocation prepared before
 * guidance attestation existed (or one whose contract references no guidance),
 * so it requires nothing.
 */
/**
 * Expected `final_line` read evidence for each referenced guidance selection,
 * keyed by policy id, source path, and content digest. Built from the
 * invocation's own policy snapshot, so the check needs no source file that
 * may have drifted since preparation.
 */
function expectedGuidanceFinalLines(
  invocation: Invocation,
): Map<string, string> {
  const expected = new Map<string, string>()
  const policySets = [
    invocation.policies,
    invocation.delegation?.policies ?? [],
  ]

  for (const policies of policySets) {
    for (const policy of policies) {
      for (const guidance of policy.guidance ?? []) {
        if (!guidance.reference) {
          continue
        }

        expected.set(
          `${policy.id}\0${guidance.source_path}\0${guidance.reference.content_sha256}`,
          lastEvidenceLine(guidance.content),
        )
      }
    }
  }

  return expected
}

function guidanceAttestationChecks(
  manifest: InvocationContractManifest,
  attestation: Record<string, unknown>,
  expectedFinalLines: Map<string, string>,
): ValidationCheck[] {
  const expected = manifest.guidance ?? []

  if (expected.length === 0) {
    return []
  }

  const declared = Array.isArray(attestation.guidance)
    ? attestation.guidance
    : []
  const checks: ValidationCheck[] = [
    {
      id: 'attestation.guidance_count',
      passed: declared.length === expected.length,
      message:
        declared.length === expected.length
          ? `Attestation covers all ${expected.length} guidance reference(s)`
          : `Attestation MUST declare all ${expected.length} guidance reference(s) in manifest order (got ${declared.length})`,
    },
  ]

  for (const [index, entry] of expected.entries()) {
    const id = `attestation.guidance.${entry.policy_id}.${index + 1}`
    const claim = isRecord(declared[index]) ? declared[index] : {}
    const identityMatches =
      claim.policy_id === entry.policy_id &&
      claim.source_path === entry.source_path &&
      claim.content_sha256 === entry.content_sha256

    if (!identityMatches) {
      checks.push({
        id,
        passed: false,
        message:
          `Guidance attestation position ${index + 1} MUST name policy ` +
          `'${entry.policy_id}', source '${entry.source_path}', and digest ` +
          `'${entry.content_sha256}'`,
      })
      continue
    }

    const reason = typeof claim.reason === 'string' ? claim.reason.trim() : ''
    const error = typeof claim.error === 'string' ? claim.error.trim() : ''

    switch (claim.status) {
      case 'read': {
        // The final line is deliberately not printed on the card: quoting it
        // is what separates "opened the selection" from "echoed the card".
        const expectedFinalLine = expectedFinalLines.get(
          `${entry.policy_id}\0${entry.source_path}\0${entry.content_sha256}`,
        )
        const declaredFinalLine =
          typeof claim.final_line === 'string' ? claim.final_line : ''
        const finalLineMatches =
          expectedFinalLine === undefined ||
          declaredFinalLine.trim() === expectedFinalLine.trim()

        checks.push({
          id,
          passed: finalLineMatches && declaredFinalLine.trim().length > 0,
          message:
            finalLineMatches && declaredFinalLine.trim().length > 0
              ? `Guidance ${entry.source_path} (${entry.policy_id}) is attested as read with matching final-line evidence`
              : declaredFinalLine.trim().length === 0
                ? `A read guidance entry MUST quote the selection's last content line (skipping trailing dividers) as final_line for ${entry.source_path}`
                : `Guidance ${entry.source_path} (${entry.policy_id}) final_line does not match the selected content's last content line (trailing divider lines are skipped)`,
        })
        break
      }
      case 'skipped':
        checks.push({
          id,
          passed: reason.length > 0,
          message:
            reason.length > 0
              ? `Guidance ${entry.source_path} (${entry.policy_id}) is skipped: ${reason}`
              : `A skipped guidance read MUST carry the concrete reason the trigger did not apply for ${entry.source_path}`,
        })
        break
      case 'reference_failed':
        checks.push({
          id,
          passed: false,
          message:
            error.length > 0
              ? `Guidance ${entry.source_path} (${entry.policy_id}) was unreadable: ${error} — repair the source or read the selection from the invocation JSON snapshot`
              : `A reference_failed guidance entry MUST carry the concrete read error for ${entry.source_path}`,
        })
        break
      case 'pending':
        checks.push({
          id,
          passed: false,
          message:
            `Guidance ${entry.source_path} (${entry.policy_id}) is still the scaffold value pending; ` +
            'set it to read, or to skipped with the reason the trigger does not apply',
        })
        break
      default:
        checks.push({
          id,
          passed: false,
          message: `Guidance status MUST be read, skipped, or reference_failed (got ${JSON.stringify(claim.status)})`,
        })
    }
  }

  return checks
}

/**
 * Check a worker's read attestation against the invocation contract manifest.
 *
 * The attestation is the only observable the harness has for a referenced
 * delivery, so it is checked for exact section order, cardinality, ids, and
 * digests. A `reference_failed` report is accepted only next to a `blocked`
 * stage result carrying the concrete read error, which keeps an unreadable
 * contract loud instead of letting it pass as a product verdict.
 *
 * `pending` is the scaffold value and is rejected here. The scaffold cannot know
 * whether the worker read the contract, so submitting the prefilled value would
 * record a claim nobody made.
 */
/**
 * A card that declares model 'auto' delegates model selection to the
 * executor, so the worker attests the model it actually ran as; any other
 * declaration must match exactly.
 */
export function attestationModelMatches(
  attested: unknown,
  declared: string,
): boolean {
  return declared === 'auto'
    ? typeof attested === 'string' && attested.trim().length > 0
    : attested === declared
}

export function validateInvocationAttestation(
  invocation: Invocation,
  output: unknown,
): {
  passed: boolean
  status: 'read' | 'reference_failed' | 'pending' | 'missing' | 'malformed'
  checks: ValidationCheck[]
} {
  const manifest = invocation.contract_manifest
  const record = isRecord(output) ? output : {}
  const attestation = isRecord(record.invocation_attestation)
    ? record.invocation_attestation
    : null

  if (!manifest) {
    return {
      passed: true,
      status: 'missing',
      checks: [
        {
          id: 'attestation.not_required',
          passed: true,
          message:
            'Invocation carries no contract manifest, so no read attestation is required',
        },
      ],
    }
  }

  if (!attestation) {
    return {
      passed: false,
      status: 'missing',
      checks: [
        {
          id: 'attestation.present',
          passed: false,
          message:
            'Output MUST declare invocation_attestation for a referenced invocation contract',
        },
      ],
    }
  }

  const pending = attestation.status === 'pending'
  const status =
    attestation.status === 'read' || attestation.status === 'reference_failed'
      ? attestation.status
      : null
  const checks: ValidationCheck[] = [
    {
      id: 'attestation.status',
      passed: status !== null,
      message:
        status !== null
          ? `Attestation status is '${status}'`
          : pending
            ? 'Attestation status is still the scaffold value pending; set it to read after reading the complete contract'
            : `Attestation status MUST be read or reference_failed (got ${JSON.stringify(attestation.status)})`,
    },
    {
      id: 'attestation.invocation_id',
      passed: attestation.invocation_id === invocation.invocation_id,
      message:
        attestation.invocation_id === invocation.invocation_id
          ? 'Attestation names the active invocation'
          : `Attestation invocation_id MUST equal '${invocation.invocation_id}'`,
    },
    {
      id: 'attestation.model',
      passed: attestationModelMatches(
        attestation.model,
        invocation.stage.model,
      ),
      message: attestationModelMatches(
        attestation.model,
        invocation.stage.model,
      )
        ? invocation.stage.model === 'auto'
          ? `Attestation records executor-selected model '${String(attestation.model)}' under declared model 'auto'`
          : `Attestation records effective model '${invocation.stage.model}'`
        : invocation.stage.model === 'auto'
          ? `Attestation model MUST name the executor-selected model when the declared model is 'auto'`
          : `Attestation model MUST equal '${invocation.stage.model}'`,
    },
    {
      id: 'attestation.contract_path',
      passed: attestation.contract_path === manifest.contract_path,
      message:
        attestation.contract_path === manifest.contract_path
          ? 'Attestation names the canonical contract path'
          : `Attestation contract_path MUST equal '${manifest.contract_path}'`,
    },
  ]

  if (status === null) {
    return { passed: false, status: pending ? 'pending' : 'malformed', checks }
  }

  if (status === 'reference_failed') {
    const error =
      typeof attestation.error === 'string' ? attestation.error.trim() : ''

    checks.push(
      {
        id: 'attestation.reference_failure_reason',
        passed: error.length > 0,
        message:
          error.length > 0
            ? `Reported reference failure: ${error}`
            : 'A reference_failed attestation MUST carry the concrete read error in error',
      },
      {
        id: 'attestation.reference_failure_blocks',
        passed: record.result === 'blocked',
        message:
          record.result === 'blocked'
            ? 'Reference failure is reported as a blocked stage result'
            : 'A reference_failed attestation MUST accompany result blocked',
      },
    )

    return {
      passed: checks.every((check) => check.passed),
      status,
      checks,
    }
  }

  checks.push({
    id: 'attestation.contract_digest',
    passed: attestation.contract_sha256 === manifest.contract_sha256,
    message:
      attestation.contract_sha256 === manifest.contract_sha256
        ? 'Attestation matches the contract digest'
        : `Attestation contract_sha256 MUST equal '${manifest.contract_sha256}'`,
  })

  // The whole contract digest above already proves the worker held the exact
  // card. A per-section digest echo re-proves the same thing at ~19 lines of
  // transcription per attempt, so it is validated only when a worker (or a
  // legacy scaffold) volunteers it — never required.
  if (attestation.sections !== undefined) {
    const declared = attestationSections(attestation.sections)

    checks.push({
      id: 'attestation.section_count',
      passed: declared.length === manifest.sections.length,
      message:
        declared.length === manifest.sections.length
          ? `Attestation covers all ${manifest.sections.length} contract sections`
          : `Attestation MUST declare all ${manifest.sections.length} contract sections (got ${declared.length})`,
    })

    for (const [index, section] of manifest.sections.entries()) {
      const claim = declared[index]
      const matches =
        claim?.id === section.id && claim.sha256 === section.sha256

      checks.push({
        id: `attestation.section.${section.id}`,
        passed: matches,
        message: matches
          ? `Section ${section.id} is attested in order with a matching digest`
          : `Attestation position ${index + 1} MUST be section '${section.id}' with digest '${section.sha256}'`,
      })
    }
  }

  // Guidance read evidence is required whenever the manifest references
  // guidance: the card carries only digests, so a self-declared "I read the
  // contract" cannot cover external selections the worker never opened.
  checks.push(
    ...guidanceAttestationChecks(
      manifest,
      attestation,
      expectedGuidanceFinalLines(invocation),
    ),
  )

  return {
    passed: checks.every((check) => check.passed),
    status: 'read',
    checks,
  }
}

export function loadValidationArtifact(
  root: string,
  relativePath: string,
): ValidationArtifactLoad {
  try {
    const absolute = resolveInside(root, relativePath)

    if (!fileExists(absolute)) {
      return { state: 'missing' }
    }

    const value = readJson(absolute)

    if (
      !isRecord(value) ||
      value.schema_version !== 1 ||
      typeof value.run_id !== 'string' ||
      typeof value.invocation_id !== 'string' ||
      (value.kind !== 'invocation' && value.kind !== 'delegation') ||
      (value.status !== 'pass' && value.status !== 'fail') ||
      typeof value.summary !== 'string' ||
      !Array.isArray(value.checks) ||
      typeof value.validated_at !== 'string' ||
      typeof value.artifact_path !== 'string'
    ) {
      return {
        state: 'malformed',
        reason: 'Validation artifact has invalid shape',
      }
    }

    return value as unknown as ValidationResultArtifact
  } catch (error) {
    return { state: 'malformed', reason: errorMessage(error) }
  }
}

export function loadInvocationValidationStatus(
  root: string,
  runId: string,
  invocationId: string,
): InvocationValidationStatus {
  const invocationValidationPathValue = invocationValidationPath(
    runId,
    invocationId,
    root,
  )
  const delegationValidationPathValue = delegationValidationPath(
    runId,
    invocationId,
    root,
  )
  const delegationPathValue = delegationPath(runId, invocationId, root)

  return {
    invocation: loadValidationArtifact(root, invocationValidationPathValue),
    delegation: loadValidationArtifact(root, delegationValidationPathValue),
    invocation_validation_path: invocationValidationPathValue,
    delegation_validation_path: delegationValidationPathValue,
    delegation_path: delegationPathValue,
  }
}

export interface StageOutputValidation {
  errors: string[]
  output: StageOutput
}

export interface StageOutputValidationOptions {
  /**
   * Declared artifacts the harness itself materializes later in the submission,
   * so their absence at validation time is expected rather than a defect.
   */
  pendingArtifactPaths?: string[]
}

function valueAt(object: Record<string, unknown>, dottedPath: string): unknown {
  let value: unknown = object

  for (const key of dottedPath.split('.')) {
    if (!isRecord(value)) {
      return undefined
    }

    value = value[key]
  }

  return value
}

function hasType(value: unknown, expected: JsonTypeName): boolean {
  if (expected === 'array') {
    return Array.isArray(value)
  }

  if (expected === 'object') {
    return isRecord(value)
  }

  return typeof value === expected
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((item): item is string => typeof item === 'string')
}

function normalizeArtifacts(value: unknown): ArtifactReference[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((item) => {
    if (
      !isRecord(item) ||
      typeof item.path !== 'string' ||
      typeof item.description !== 'string'
    ) {
      return []
    }

    return [{ path: item.path, description: item.description }]
  })
}

function normalizeCriteria(value: unknown): CriterionEvaluation[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== 'string') {
      return []
    }

    const result =
      item.result === 'pass' ||
      item.result === 'fail' ||
      item.result === 'not_applicable'
        ? item.result
        : 'fail'

    return [
      {
        id: item.id,
        result,
        evidence: normalizeStringArray(item.evidence),
        explanation:
          typeof item.explanation === 'string' ? item.explanation : '',
      },
    ]
  })
}

function normalizeStageOutput(
  value: unknown,
  invocation: Invocation,
): StageOutput {
  const record = isRecord(value) ? value : {}
  const result: StageOutcome =
    record.result === 'success' ||
    record.result === 'failure' ||
    record.result === 'blocked'
      ? record.result
      : 'failure'

  return {
    schema_version: 1,
    invocation_id:
      typeof record.invocation_id === 'string'
        ? record.invocation_id
        : invocation.invocation_id,
    result,
    summary:
      typeof record.summary === 'string' && record.summary.trim().length > 0
        ? record.summary
        : 'Submitted output failed structural validation.',
    artifacts: normalizeArtifacts(record.artifacts),
    criteria: normalizeCriteria(record.criteria),
    risks: normalizeStringArray(record.risks),
    unknowns: normalizeStringArray(record.unknowns),
    ...(isRecord(record.workspace_changes)
      ? {
          workspace_changes: {
            attribution:
              record.workspace_changes.attribution === 'internal' ||
              record.workspace_changes.attribution === 'external' ||
              record.workspace_changes.attribution === 'mixed'
                ? record.workspace_changes.attribution
                : 'unknown',
            paths: normalizeStringArray(record.workspace_changes.paths),
            explanation:
              typeof record.workspace_changes.explanation === 'string'
                ? record.workspace_changes.explanation
                : '',
          },
        }
      : {}),
    data: isRecord(record.data) ? record.data : {},
  }
}

export function validateStageOutput(
  root: string,
  stage: StageDefinition,
  invocation: Invocation,
  value: unknown,
  { pendingArtifactPaths = [] }: StageOutputValidationOptions = {},
): StageOutputValidation {
  const errors: string[] = []
  const output = normalizeStageOutput(value, invocation)
  const record = isRecord(value) ? value : {}

  if (!isRecord(value)) {
    errors.push('output MUST be an object')
  }

  if (record.schema_version !== 1) {
    errors.push('schema_version MUST be 1')
  }

  if (record.invocation_id !== invocation.invocation_id) {
    errors.push('invocation_id MUST match the active invocation')
  }

  if (
    record.result !== 'success' &&
    record.result !== 'failure' &&
    record.result !== 'blocked'
  ) {
    errors.push('result MUST be success, failure, or blocked')
  }

  if (
    typeof record.summary !== 'string' ||
    record.summary.trim().length === 0
  ) {
    errors.push('summary MUST be a non-empty string')
  }

  for (const key of ['artifacts', 'criteria']) {
    if (!Array.isArray(record[key])) {
      errors.push(`${key} MUST be an array`)
    }
  }

  // Risks and unknowns are honest-disclosure fields, not paperwork: absent
  // means none to report, exactly like an empty array.
  for (const key of ['risks', 'unknowns']) {
    if (record[key] !== undefined && !Array.isArray(record[key])) {
      errors.push(`${key} MUST be an array when present`)
    }
  }

  if (!isRecord(record.data)) {
    errors.push('data MUST be an object')
  }

  for (const [dataPath, expectedType] of Object.entries(
    stage.required_data ?? {},
  )) {
    const dataValue = valueAt(output.data, dataPath)

    if (!hasType(dataValue, expectedType)) {
      errors.push(`data.${dataPath} MUST be ${expectedType}`)
    }
  }

  // Report an unrecognized criterion verdict explicitly. `normalizeCriteria`
  // coerces one to `fail`, which is the safe default but silently converts a
  // one-token vocabulary mistake into an unexplained stage failure. Naming the
  // offending value is what lets the retry fix the actual problem.
  if (Array.isArray(record.criteria)) {
    for (const item of record.criteria) {
      if (!isRecord(item) || typeof item.id !== 'string') {
        errors.push(
          'each criteria entry MUST be an object with a string id naming a ' +
            'rubric criterion',
        )
        continue
      }

      if (
        item.result !== 'pass' &&
        item.result !== 'fail' &&
        item.result !== 'not_applicable'
      ) {
        errors.push(
          `criteria '${item.id}' result MUST be pass, fail, or ` +
            `not_applicable (got ${JSON.stringify(item.result)})`,
        )
      }
    }
  }

  const criteria = new Map<string, CriterionEvaluation>()

  for (const item of output.criteria) {
    if (criteria.has(item.id)) {
      errors.push(`duplicate criteria result: ${item.id}`)
    }

    // An explanation is required only where it carries information: why a
    // criterion failed, or why it does not apply. Demanding prose on every
    // passing entry produced boilerplate nobody read.
    if (item.result !== 'pass' && item.explanation.length === 0) {
      errors.push(
        `criteria '${item.id}' ${item.result} verdict MUST carry an explanation`,
      )
    }

    criteria.set(item.id, item)
  }

  for (const criterion of stage.criteria) {
    const evaluation = criteria.get(criterion.id)

    if (!evaluation) {
      errors.push(`missing self-evaluation for criterion '${criterion.id}'`)
      continue
    }

    if (criterion.hard && evaluation.result === 'not_applicable') {
      errors.push(`hard criterion '${criterion.id}' MUST NOT be not_applicable`)
    }

    if (
      criterion.hard &&
      evaluation.result === 'pass' &&
      evaluation.evidence.length === 0
    ) {
      errors.push(`criteria '${criterion.id}' pass claim MUST include evidence`)
    }
  }

  if (output.result === 'success') {
    const failedSelf = output.criteria.some((item) => item.result === 'fail')

    if (failedSelf) {
      errors.push('result success contradicts failed criterion self-evaluation')
    }
  }

  const knownCriterionIds = new Set(stage.criteria.map((item) => item.id))

  for (const item of output.criteria) {
    if (!knownCriterionIds.has(item.id)) {
      errors.push(`unknown criteria result: ${item.id}`)
    }
  }

  const briefContract = invocation.output.operator_brief
  const declaredArtifacts = invocation.output.artifacts

  if (declaredArtifacts) {
    if (output.artifacts.length !== declaredArtifacts.length) {
      errors.push(
        `artifacts MUST contain exactly ${declaredArtifacts.length} declared entries`,
      )
    }

    for (const [index, artifact] of declaredArtifacts.entries()) {
      if (output.artifacts[index]?.path !== artifact.path) {
        errors.push(
          `artifacts[${index}].path MUST equal declared path '${artifact.path}'`,
        )
      }
    }
  }

  if (briefContract) {
    const primaryArtifact = output.artifacts[0]
    const sourceTransient =
      briefContract.source_lifecycle === 'transient' ||
      briefContract.source_transient === true

    if (primaryArtifact?.path !== briefContract.rendered_path) {
      errors.push(
        `artifacts[0].path MUST equal rendered operator brief path '${briefContract.rendered_path}'`,
      )
    }

    if (
      sourceTransient &&
      output.artifacts.some(
        (artifact) => artifact.path === briefContract.source_path,
      )
    ) {
      errors.push(
        `artifacts MUST NOT list transient operator brief source '${briefContract.source_path}'`,
      )
    } else if (
      !declaredArtifacts &&
      !sourceTransient &&
      output.artifacts[1]?.path !== briefContract.source_path
    ) {
      errors.push(
        `artifacts[1].path MUST equal operator brief source path '${briefContract.source_path}'`,
      )
    }
  }

  // Compare resolved locations so a pending artifact is exempt however its
  // declared path is spelled.
  const pendingAbsolutePaths = new Set(
    pendingArtifactPaths.map((pendingPath) => resolveInside(root, pendingPath)),
  )

  for (const artifact of output.artifacts) {
    try {
      const absolute = resolveInside(root, artifact.path)

      if (!pendingAbsolutePaths.has(absolute) && !fileExists(absolute)) {
        errors.push(`artifact does not exist: ${artifact.path}`)
      }
    } catch (error) {
      errors.push(errorMessage(error))
    }

    if (artifact.description.length === 0) {
      errors.push(`artifact '${artifact.path}' description MUST be non-empty`)
    }
  }

  return { errors, output }
}

interface ShellCheckResolution {
  command: string
  profile_name: string | null
  removed_reason?: string
}

export function resolveShellCheck(
  root: string,
  criterion: Criterion,
  requestedCommand: string,
  overridden: boolean,
): ShellCheckResolution {
  if (overridden || !isTargetInstallation(root)) {
    return {
      command: requestedCommand,
      profile_name: overridden
        ? null
        : repositoryCheckProfileName(requestedCommand),
    }
  }

  const legacyProfiles: Record<string, string> = {
    'implement.lint:npm run lint': 'static',
    'implement.unit_tests:npm test': 'fast',
    'test.full_suite:npm test': 'full',
    'ship.validate:npm run validate': 'configuration',
  }
  const legacyKey = `${criterion.id}:${requestedCommand.trim()}`
  const legacyProfile = legacyProfiles[legacyKey]

  if (legacyProfile) {
    return {
      command: `pan repository-check ${legacyProfile}`,
      profile_name: legacyProfile,
    }
  }

  if (
    criterion.id === 'test.coverage' &&
    requestedCommand.trim() === 'npm run test:coverage'
  ) {
    return {
      command: requestedCommand,
      profile_name: null,
      removed_reason:
        'Legacy standalone coverage gate removed; coverage belongs inside a target-owned repository profile when applicable.',
    }
  }

  if (
    criterion.id === 'preflight.validate' &&
    requestedCommand.trim() === 'npm run validate'
  ) {
    return {
      command: '"$PANCREATOR_ROOT/bin/pan" validate',
      profile_name: null,
    }
  }

  if (
    criterion.id === 'preflight.tests' &&
    requestedCommand.trim() === 'npm test'
  ) {
    return {
      command: 'npm --prefix "$PANCREATOR_ROOT" test',
      profile_name: null,
    }
  }

  return {
    command: requestedCommand,
    profile_name: repositoryCheckProfileName(requestedCommand),
  }
}

export interface RepositoryCheckBaselineLoad {
  result?: RepositoryCheckResult
  artifact_path?: string
  /** Why the baseline cannot support a gate. Absent when none is expected. */
  reason?: string
}

/**
 * Whether this run completed repository-check baseline capture.
 *
 * The map is absent before the first source-allowed stage. An empty map is still
 * a completed capture for a workflow with no configured profiles, and it must
 * not let a later stage silently recapture post-implementation state.
 */
export function repositoryCheckBaselinesCaptured(state: RunState): boolean {
  return state.repository_check_baselines !== undefined
}

function isRepositoryCheckBaselineArtifact(
  value: unknown,
  profileName: string,
): value is RepositoryCheckBaselineArtifact {
  if (
    !isRecord(value) ||
    value.schema_version !== 1 ||
    value.profile !== profileName ||
    !isRecord(value.result)
  ) {
    return false
  }

  return (
    value.result.profile === profileName && Array.isArray(value.result.results)
  )
}

/**
 * Load the pre-implementation baseline a repository-check gate compares against.
 *
 * Once a run captures baselines, a gated profile without a readable, matching
 * baseline is a harness defect rather than a licence to judge the gate on its
 * exit code alone, so the missing artifact is reported and the gate fails closed.
 */
export function loadRepositoryCheckBaseline(
  root: string,
  state: RunState,
  profileName: string,
): RepositoryCheckBaselineLoad {
  if (!repositoryCheckBaselinesCaptured(state)) {
    return {}
  }

  const pointer = state.repository_check_baselines?.[profileName]

  if (!pointer) {
    // Under a verification level, only source-mutating stage profiles are
    // baselined, so an absent pointer is the expected state for a later gate's
    // heavier profile: that gate is judged on its own result. A run created
    // before levels existed baselined every gated profile, so an absent
    // pointer there is a harness defect and the gate fails closed.
    if (state.verification) {
      return {}
    }

    return {
      reason:
        `No pre-implementation baseline was recorded for repository-check ` +
        `profile '${profileName}'.`,
    }
  }

  const absolute = resolveInside(root, pointer.artifact_path)

  if (!fileExists(absolute)) {
    return {
      reason:
        `Pre-implementation baseline artifact is missing for profile ` +
        `'${profileName}': ${pointer.artifact_path}.`,
    }
  }

  let artifact: unknown

  try {
    artifact = readJson(absolute)
  } catch (error) {
    return {
      reason:
        `Pre-implementation baseline for profile '${profileName}' is unreadable ` +
        `(${pointer.artifact_path}): ${errorMessage(error)}.`,
    }
  }

  if (!isRepositoryCheckBaselineArtifact(artifact, profileName)) {
    return {
      reason:
        `Pre-implementation baseline for profile '${profileName}' is ` +
        `incompatible with its gate (${pointer.artifact_path}).`,
    }
  }

  if (!artifact.full_result_path) {
    return { result: artifact.result, artifact_path: pointer.artifact_path }
  }

  const fullAbsolute = resolveInside(root, artifact.full_result_path)

  if (!fileExists(fullAbsolute)) {
    return {
      reason:
        `Full pre-implementation baseline artifact is missing for profile ` +
        `'${profileName}': ${artifact.full_result_path}.`,
    }
  }

  let fullArtifact: unknown

  try {
    fullArtifact = readJson(fullAbsolute)
  } catch (error) {
    return {
      reason:
        `Full pre-implementation baseline for profile '${profileName}' is ` +
        `unreadable (${artifact.full_result_path}): ${errorMessage(error)}.`,
    }
  }

  if (!isRepositoryCheckBaselineArtifact(fullArtifact, profileName)) {
    return {
      reason:
        `Full pre-implementation baseline for profile '${profileName}' is ` +
        `incompatible with its gate (${artifact.full_result_path}).`,
    }
  }

  return {
    result: fullArtifact.result,
    artifact_path: artifact.full_result_path,
  }
}

/**
 * True when a failed QA repository-check delta carries only timeout or
 * collection artifacts on infrastructure that already failed at baseline.
 * Exported so tests can anchor the classification to preserved evidence.
 */
export function isEnvironmentBlockedDelta(
  stage: StageDefinition,
  baseline: RepositoryCheckResult | undefined,
  comparison: ReturnType<typeof compareRepositoryCheckToBaseline> | undefined,
): boolean {
  // The verifier owns suite-gated QA in the delivery workflows; qa-tester
  // remains the executing persona for standalone and evidence-worker QA.
  if (
    (stage.persona !== 'verifier' && stage.persona !== 'qa-tester') ||
    baseline?.status !== 'failed' ||
    !comparison ||
    comparison.passed ||
    comparison.delta.new.length === 0
  ) {
    return false
  }

  // The embedded arrays cap at 100 entries. The classification must inspect
  // every new identity, so it reads the uncapped list and refuses to classify
  // when identities beyond the cap are unavailable.
  const newDiagnostics = comparison.delta.full?.new ?? comparison.delta.new
  const newCount = comparison.delta.counts?.new ?? newDiagnostics.length

  if (newCount > newDiagnostics.length) {
    return false
  }

  const failedBaselineCommands = new Set(
    baseline.results
      .filter(
        (result) =>
          !result.passed &&
          (result.timed_out ||
            commandFailureDiagnostics(result, baseline.workspace_root).some(
              (diagnostic) => isInfrastructureDiagnostic(diagnostic),
            )),
      )
      .map(
        (result) =>
          `${result.kind}:${result.command.trim().replaceAll(/\s+/gu, ' ')}`,
      ),
  )

  return newDiagnostics.every((diagnostic) => {
    const commandWasCarried = failedBaselineCommands.has(
      `${diagnostic.kind}:${diagnostic.command}`,
    )

    return (
      commandWasCarried && isInfrastructureDiagnostic(diagnostic.diagnostic)
    )
  })
}

/** A pytest test-failure record: product evidence, never infrastructure. */
function isTestFailureRecord(diagnostic: string): boolean {
  return /^FAILED\b/u.test(diagnostic) || /^\S+::.*\bFAILED\b/u.test(diagnostic)
}

/**
 * Match infrastructure evidence by artifact *shape*, not keyword substrings.
 * A genuinely new failing test whose node id or assertion message merely
 * mentions a timeout or collection must never classify as environmental: that
 * misclassification invites an operator waiver that ships the regression.
 */
function isInfrastructureDiagnostic(diagnostic: string): boolean {
  if (isTestFailureRecord(diagnostic)) {
    return false
  }

  return (
    /^<status> .*\btimed_out=true\b/u.test(diagnostic) ||
    /\bERROR collecting\b/iu.test(diagnostic) ||
    /^ERROR\b.*\b(?:ImportError|ModuleNotFoundError)\b/u.test(diagnostic) ||
    /^(?:E\s+)?(?:ImportError|ModuleNotFoundError)\b/u.test(diagnostic) ||
    /\bETIMEDOUT\b/u.test(diagnostic) ||
    /\btimed out\b/iu.test(diagnostic) ||
    /\bworker\b.*\b(?:crash|crashed|exit|exited)\b/iu.test(diagnostic)
  )
}

function runShellCheck(
  root: string,
  runDirectory: string,
  state: RunState,
  stage: StageDefinition,
  criterion: Criterion,
  workspace: WorkspaceSnapshot,
  workspaceDir: string,
  commandOverride?: string,
  artifactId = stage.slug,
  onProgress?: (message: string) => void,
): DeterministicResult {
  const workspaceFingerprint = workspace.fingerprint
  const requestedCommand = commandOverride ?? criterion.command ?? ''
  const resolution = resolveShellCheck(
    root,
    criterion,
    requestedCommand,
    commandOverride !== undefined,
  )
  // The run's verification level may gate this criterion on a different
  // repository-check profile than the workflow declares. An explicit command
  // override still wins: resolution then carries no profile to remap.
  const levelRemap =
    resolution.profile_name !== null
      ? state.verification?.gates[criterion.id]
      : undefined
  const remappedProfile = typeof levelRemap === 'string' ? levelRemap : null
  const command = remappedProfile
    ? `pan repository-check ${remappedProfile}`
    : resolution.command
  const startedAt = new Date().toISOString()
  const profileName = remappedProfile ?? resolution.profile_name

  // A profile gate is judged against the run's own baseline, so the baseline
  // resolves before any cache decision: a run whose baseline is missing or
  // unreadable fails closed below, and a recorded pass never bypasses that.
  const baselineLoad =
    profileName && !resolution.removed_reason
      ? loadRepositoryCheckBaseline(root, state, profileName)
      : undefined

  // A clean pass of the same command at an unchanged workspace fingerprint is
  // already proven; re-executing it spends minutes producing evidence the
  // harness holds (DEV-001). Overridden gates stay uncached: an operator
  // override is a run-scoped decision, not a reusable fact. A non-Git
  // workspace fingerprints as a constant and is never cached.
  const cacheKey =
    commandOverride === undefined &&
    !resolution.removed_reason &&
    gateCacheableSnapshot(workspace) &&
    !baselineLoad?.reason
      ? gateCacheKey(root, workspaceFingerprint, command)
      : null
  const cached = cacheKey ? gateCacheLookup(root, cacheKey) : null
  // A profile gate needs the recorded repository result to compute this run's
  // delta; an entry without one predates that field and is a miss.
  const cachedUsable =
    cached !== null && (!profileName || cached.repository_result !== undefined)
  let cachedSourceEvidence: string | null = null

  if (cached && cachedUsable) {
    try {
      cachedSourceEvidence = readFileSync(
        path.join(root, cached.evidence_path),
        'utf8',
      )
    } catch {
      cachedSourceEvidence = null
    }
  }

  if (cached && cachedUsable && cachedSourceEvidence !== null) {
    const cachedSafeId = criterion.id.replaceAll(/[^a-zA-Z0-9_.-]/g, '-')
    const cachedEvidencePath = path.join(
      runDirectory,
      'evidence',
      `${artifactId}-${cachedSafeId}.log`,
    )
    const cachedComparison =
      profileName && cached.repository_result && baselineLoad?.result
        ? compareRepositoryCheckToBaseline(
            baselineLoad.result,
            cached.repository_result,
          )
        : undefined
    const explanation =
      `Accepted cached clean pass of the same command at an unchanged ` +
      `workspace fingerprint, recorded ${cached.cached_at} by run ` +
      `${cached.run_id} (criterion ${cached.criterion_id}). Original ` +
      `evidence: ${cached.evidence_path}.` +
      (cachedComparison ? ` ${cachedComparison.explanation}` : '')

    onProgress?.(
      `${criterion.id} accepted cached pass recorded ${cached.cached_at} ` +
        `by ${cached.run_id}`,
    )
    // The accepting run carries the original captured output, not a pointer:
    // archival may move the source run, and a verifier spot-checking this
    // gate must hold the bytes the pass rests on.
    writeTextAtomic(
      cachedEvidencePath,
      [
        `$ ${command}`,
        'cached=true',
        `cached_at=${cached.cached_at}`,
        `source_run=${cached.run_id}`,
        `source_criterion=${cached.criterion_id}`,
        `source_evidence=${cached.evidence_path}`,
        `workspace_fingerprint=${workspaceFingerprint}`,
        'exit_code=0',
        '',
        explanation,
        '',
        '--- source evidence ---',
        cachedSourceEvidence,
      ].join('\n'),
    )

    return {
      id: criterion.id,
      type: 'shell',
      hard: Boolean(criterion.hard),
      passed: cachedComparison ? cachedComparison.passed : true,
      cached: true,
      explanation,
      ...(cachedComparison
        ? { repository_check_delta: cachedComparison.delta }
        : {}),
      ...(remappedProfile && state.verification
        ? { verification_level: state.verification.level }
        : {}),
      command,
      exit_code: 0,
      timed_out: false,
      evidence_path: path
        .relative(root, cachedEvidencePath)
        .split(path.sep)
        .join('/'),
      ...(baselineLoad?.artifact_path
        ? { baseline_evidence_path: baselineLoad.artifact_path }
        : {}),
      workspace_fingerprint: workspaceFingerprint,
    }
  }

  let exitCode: number | null
  let signal: NodeJS.Signals | null = null
  let stdout: string
  let stderr: string
  let errorMessageText = ''
  let timedOut = false
  let skipped = false
  let repositoryResult: RepositoryCheckResult | undefined

  if (resolution.removed_reason) {
    exitCode = 0
    stdout = `${resolution.removed_reason}\n`
    stderr = ''
    skipped = true
  } else if (profileName) {
    onProgress?.(
      `running ${criterion.id} with repository profile '${profileName}' (timeout ${criterion.timeout_ms ?? 'default'}ms)`,
    )
    // Profile gates run where the stage worked, so a worktree-targeted run is
    // judged by its own workspace rather than the main checkout.
    repositoryResult = runRepositoryCheck(root, profileName, {
      timeout_ms: criterion.timeout_ms,
      workspace: workspaceDir,
    })
    onProgress?.(
      `${criterion.id} ${repositoryResult.status} in ${(repositoryResult.total_duration_ms / 1000).toFixed(1)}s`,
    )

    exitCode = repositoryResult.status === 'failed' ? 1 : 0
    stdout = `${JSON.stringify(repositoryResult, null, 2)}\n`
    stderr = ''
    skipped = repositoryResult.status === 'not_configured'
    timedOut = repositoryResult.results.some((result) => result.timed_out)
  } else {
    onProgress?.(
      `running ${criterion.id} command (timeout ${criterion.timeout_ms ?? 120_000}ms)`,
    )
    const commandStartedAt = Date.now()
    const result = spawnSync(command, {
      cwd: workspaceDir,
      encoding: 'utf8',
      shell: true,
      timeout: criterion.timeout_ms ?? 120_000,
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        PAN_WORKFLOW_STAGE: stage.slug,
        PANCREATOR_ROOT: root,
        PAN_WORKSPACE_ROOT: workspaceDir,
      },
    })

    onProgress?.(
      `${criterion.id} ${result.status === 0 ? 'passed' : 'failed'} in ${((Date.now() - commandStartedAt) / 1000).toFixed(1)}s`,
    )
    exitCode = result.status
    signal = result.signal
    stdout = result.stdout ?? ''
    stderr = result.stderr ?? ''
    errorMessageText = result.error?.message ?? ''
    timedOut = isNodeError(result.error) && result.error.code === 'ETIMEDOUT'
    skipped = stdout.includes('PANCREATOR_CHECK_SKIPPED=1')
  }

  let baselineComparison:
    | ReturnType<typeof compareRepositoryCheckToBaseline>
    | undefined
  let baselineEvidencePath: string | undefined
  let baselineGap: string | undefined
  let baselineResult: RepositoryCheckResult | undefined

  // Baseline parity applies to every repository-check gate the run baselined,
  // not only to a gate that happens to be failing. A stage that repairs an
  // inherited failure needs the credit recorded, and a first-time failure needs
  // to be named as new rather than inferred from an exit code.
  if (profileName && repositoryResult && !skipped) {
    const load =
      baselineLoad ?? loadRepositoryCheckBaseline(root, state, profileName)

    if (load.result) {
      baselineResult = load.result
      baselineComparison = compareRepositoryCheckToBaseline(
        load.result,
        repositoryResult,
      )
      baselineEvidencePath = load.artifact_path
    } else if (load.reason) {
      baselineGap = load.reason
    }
  }

  const safeCriterionId = criterion.id.replaceAll(/[^a-zA-Z0-9_.-]/g, '-')
  const evidencePath = path.join(
    runDirectory,
    'evidence',
    `${artifactId}-${safeCriterionId}.log`,
  )
  const fullEvidencePath = path.join(
    runDirectory,
    'evidence',
    `${artifactId}-${safeCriterionId}.full.log`,
  )
  const boundedStdout = boundEvidenceStream(stdout)
  const boundedStderr = boundEvidenceStream(stderr)
  const elided = boundedStdout !== stdout || boundedStderr !== stderr
  const header = [
    `$ ${command}`,
    `started_at=${startedAt}`,
    `finished_at=${new Date().toISOString()}`,
    `workspace_fingerprint=${workspaceFingerprint}`,
    `exit_code=${exitCode ?? 'null'}`,
    signal ? `signal=${signal}` : null,
  ].filter((line): line is string => line !== null)
  const body = (out: string, err: string, note: string | null) =>
    [
      ...header,
      ...(note ? [note] : []),
      '',
      '--- stdout ---',
      out,
      '--- stderr ---',
      err,
      errorMessageText ? `--- error ---\n${errorMessageText}` : '',
    ].join('\n')

  // Full test-suite transcripts run to megabytes each and dominate a run's
  // on-disk size while the actionable content sits at the head and tail. Keep a
  // bounded log as the referenced evidence and the untruncated one beside it.
  if (elided) {
    writeTextAtomic(fullEvidencePath, body(stdout, stderr, null))
  }

  writeTextAtomic(
    evidencePath,
    body(
      boundedStdout,
      boundedStderr,
      elided ? `full_output=${toRepoRelative(root, fullEvidencePath)}` : null,
    ),
  )

  const commandSucceeded = exitCode === 0 && !errorMessageText
  const passed = baselineGap
    ? false
    : !skipped &&
      (baselineComparison ? baselineComparison.passed : commandSucceeded)
  const inheritedFailureOnly = Boolean(
    baselineComparison?.passed && !commandSucceeded,
  )

  // Only a clean pass is a reusable fact. A baseline-relative pass credits
  // this run's own baseline, and a failure must re-run to observe its repair.
  if (cacheKey && passed && commandSucceeded && !skipped && !timedOut) {
    gateCacheStore(root, {
      key: cacheKey,
      criterion_id: criterion.id,
      command,
      workspace_fingerprint: workspaceFingerprint,
      run_id: state.run_id,
      cached_at: new Date().toISOString(),
      evidence_path: path
        .relative(root, evidencePath)
        .split(path.sep)
        .join('/'),
      ...(repositoryResult ? { repository_result: repositoryResult } : {}),
    })
  }
  const environmentBlocked = isEnvironmentBlockedDelta(
    stage,
    baselineResult,
    baselineComparison,
  )

  return {
    id: criterion.id,
    type: 'shell',
    hard: Boolean(criterion.hard),
    passed,
    ...(baselineGap
      ? { explanation: `${baselineGap} The gate fails closed.` }
      : skipped
        ? {
            disabled: true,
            explanation:
              resolution.removed_reason ??
              'Repository check profile is not configured; no technology-specific command was guessed.',
          }
        : baselineComparison
          ? {
              explanation: baselineComparison.explanation,
              repository_check_delta: baselineComparison.delta,
              ...(inheritedFailureOnly ? { preexisting_failure: true } : {}),
              ...(environmentBlocked ? { environment_blocked: true } : {}),
            }
          : repositoryResult?.advisories.length
            ? { explanation: repositoryResult.advisories.join(' ') }
            : {}),
    ...(commandOverride === undefined
      ? {}
      : {
          overridden: true,
          explanation: 'Gate command was overridden by run configuration.',
        }),
    ...(remappedProfile && state.verification
      ? { verification_level: state.verification.level }
      : {}),
    command,
    exit_code: exitCode,
    timed_out: timedOut,
    evidence_path: path.relative(root, evidencePath).split(path.sep).join('/'),
    ...(baselineEvidencePath
      ? { baseline_evidence_path: baselineEvidencePath }
      : {}),
    workspace_fingerprint: workspaceFingerprint,
  }
}

export function evaluateStateCriterion(
  state: RunState,
  criterion: Criterion,
  workspaceFingerprint: string,
): DeterministicResult {
  let passed = true
  let explanation = 'No specialized state evaluator was required.'

  if (criterion.id === 'ship.prior_gates_current') {
    // The delivery workflow verifies review and QA jointly in one verify
    // stage, so its latest attempt supplies both evidence roles.
    const verify = [...state.stage_history]
      .reverse()
      .find((item) => item.stage === 'verify')
    const review =
      [...state.stage_history]
        .reverse()
        .find((item) => item.stage === 'review') ?? verify
    const test =
      [...state.stage_history]
        .reverse()
        .find((item) => item.stage === 'test') ?? verify

    const activeWaivers = activeOperatorGateWaivers(state, workspaceFingerprint)
    const waiverFor = (stage: string) =>
      [...activeWaivers].reverse().find((waiver) => waiver.stage === stage)

    const reviewWaiver = waiverFor('review') ?? waiverFor('verify')
    const testWaiver = waiverFor('test') ?? waiverFor('verify')
    const reviewSatisfied =
      review?.outcome === 'success' || Boolean(reviewWaiver)
    const testSatisfied = test?.outcome === 'success' || Boolean(testWaiver)

    const testFingerprint = test?.workspace_fingerprint
    const fingerprintCurrent = testFingerprint === workspaceFingerprint
    const operatorAccepted =
      state.accepted_workspace_fingerprint === workspaceFingerprint
    const acceptedEvidenceFingerprint =
      Boolean(testFingerprint) &&
      state.accepted_workspace_fingerprint === testFingerprint
    const gatesCurrent =
      Boolean(testWaiver) ||
      fingerprintCurrent ||
      operatorAccepted ||
      acceptedEvidenceFingerprint
    passed = Boolean(gatesCurrent && reviewSatisfied && testSatisfied)
    const waiverEvidenceBasis = testWaiver
      ? 'The QA waiver is not fingerprint-bound.'
      : fingerprintCurrent
        ? 'Unwaived QA evidence matches the current workspace fingerprint.'
        : 'Unwaived QA evidence matches the operator-accepted workspace fingerprint.'

    explanation = !passed
      ? 'Passing review/QA evidence is missing or stale.'
      : reviewWaiver || testWaiver
        ? `Operator-waived ${[
            reviewWaiver ? 'review' : null,
            testWaiver ? 'QA' : null,
          ]
            .filter(Boolean)
            .join(' and ')} evidence satisfies the gate. ${waiverEvidenceBasis}`
        : review?.outcome === 'success' && fingerprintCurrent
          ? 'Review and QA passed against the current workspace fingerprint.'
          : review?.outcome === 'success' && operatorAccepted
            ? 'Review and QA are stale, but the operator accepted the current workspace as intentional.'
            : acceptedEvidenceFingerprint
              ? 'Review and QA evidence matches the operator-accepted workspace fingerprint.'
              : 'Review and QA passed against the current workspace fingerprint.'
  }

  return {
    id: criterion.id,
    type: 'state',
    hard: Boolean(criterion.hard),
    passed,
    explanation,
    workspace_fingerprint: workspaceFingerprint,
  }
}

/**
 * Whether every ship attempt since the passing QA evidence forms an unbroken
 * accountability chain starting at the QA fingerprint.
 *
 * Each attempt is accountable for exactly the window between its own before and
 * after snapshots, and `scope.no_unapproved_changes` already adjudicates that
 * window against the stage's workspace policy. So currency across ship retries
 * needs only two things: the first attempt started from the QA fingerprint, and
 * no attempt's before-snapshot disagrees with the previous attempt's
 * after-snapshot. A gap between two attempts is an edit no stage is accountable
 * for, which breaks the chain.
 *
 * This deliberately avoids reconstructing the QA fingerprint by subtracting a
 * predicted set of "release metadata" paths from the live tree. That covering
 * set cannot be known a priori — feature work routinely leaves the same durable
 * docs and README surfaces dirty that the release procedure later version-syncs
 * — and subtracting them removed feature bytes the QA fingerprint included.
 */
function shipAttemptChainProvesCurrency(
  state: RunState,
  qaEvidence: StageHistoryItem,
  currentBeforeFingerprint: string,
): boolean {
  const priorShipAttempts = state.stage_history
    .slice(state.stage_history.indexOf(qaEvidence) + 1)
    .filter((item) => item.stage === 'ship')

  if (priorShipAttempts.length === 0) {
    return false
  }

  let expectedBefore = qaEvidence.workspace_fingerprint

  for (const attempt of priorShipAttempts) {
    // An attempt recorded before before-fingerprints were tracked cannot be
    // bounded, so it cannot carry the chain.
    if (attempt.workspace_before_fingerprint !== expectedBefore) {
      return false
    }

    const scope = attempt.deterministic.find(
      (result) => result.id === 'scope.no_unapproved_changes',
    )

    if (scope && !scope.passed) {
      return false
    }

    expectedBefore = attempt.workspace_fingerprint
  }

  return expectedBefore === currentBeforeFingerprint
}

function resolveShipPriorGatesEvidenceFingerprint(options: {
  state: RunState
  stage: StageDefinition
  beforeSnapshot: WorkspaceSnapshot
  afterSnapshot: WorkspaceSnapshot
  scopePassed: boolean
}): string {
  if (options.stage.workspace_policy !== 'release_metadata_only') {
    return options.afterSnapshot.fingerprint
  }

  const test = [...options.state.stage_history]
    .reverse()
    .find(
      (item) =>
        (item.stage === 'test' || item.stage === 'verify') &&
        item.outcome === 'success',
    )
  const testFingerprint = test?.workspace_fingerprint

  if (!testFingerprint) {
    return options.beforeSnapshot.fingerprint
  }

  if (options.afterSnapshot.fingerprint === testFingerprint) {
    return testFingerprint
  }

  // First ship attempt: before snapshot still matches QA.
  if (options.beforeSnapshot.fingerprint === testFingerprint) {
    return testFingerprint
  }

  // Later ship attempts: the before snapshot already includes earlier ship
  // edits. Currency holds when this attempt's own window is clean and every
  // earlier ship attempt chains back to the QA fingerprint.
  if (
    options.scopePassed &&
    shipAttemptChainProvesCurrency(
      options.state,
      test,
      options.beforeSnapshot.fingerprint,
    )
  ) {
    return testFingerprint
  }

  return options.beforeSnapshot.fingerprint
}

function workspaceDelta(
  before: WorkspaceSnapshot,
  after: WorkspaceSnapshot,
): { added: string[]; removed: string[] } {
  const beforeSet = new Set(before.entries)
  const afterSet = new Set(after.entries)

  return {
    added: [...afterSet].filter((entry) => !beforeSet.has(entry)),
    removed: [...beforeSet].filter((entry) => !afterSet.has(entry)),
  }
}

/**
 * Bound the paths a gate result embeds in durable state. A dependency install
 * or generated tree can touch tens of thousands of files; embedding them all
 * produces a state payload no compaction can externalize, and persist would
 * refuse the transition outright (STATE_SIZE_BUDGET_EXCEEDED).
 */
const SCOPE_DELTA_PREVIEW_LIMIT = 200

function boundedPathList(paths: string[]): string {
  if (paths.length <= SCOPE_DELTA_PREVIEW_LIMIT) {
    return paths.join(', ')
  }

  return (
    `${paths.slice(0, SCOPE_DELTA_PREVIEW_LIMIT).join(', ')} ` +
    `… and ${paths.length - SCOPE_DELTA_PREVIEW_LIMIT} more`
  )
}

function boundedWorkspaceDelta(delta: { added: string[]; removed: string[] }): {
  added: string[]
  removed: string[]
} {
  const bound = (entries: string[]): string[] =>
    entries.length <= SCOPE_DELTA_PREVIEW_LIMIT
      ? entries
      : [
          ...entries.slice(0, SCOPE_DELTA_PREVIEW_LIMIT),
          `… ${entries.length - SCOPE_DELTA_PREVIEW_LIMIT} more entries elided`,
        ]

  return { added: bound(delta.added), removed: bound(delta.removed) }
}

export function evaluateDeterministicCriteria(
  root: string,
  runDirectory: string,
  state: RunState,
  stage: StageDefinition,
  beforeSnapshot: WorkspaceSnapshot,
  workspaceDir: string,
  gateOverrides: Record<string, string | false> = {},
  artifactId = stage.slug,
  stageOutput?: StageOutput,
  onProgress?: (message: string) => void,
  gateSkipReason: string | null = null,
): { results: DeterministicResult[]; workspace: WorkspaceSnapshot } {
  const afterSnapshot = gitWorkspaceSnapshot(workspaceDir)
  const results: DeterministicResult[] = []
  let scopePassed = true

  if (stage.workspace_policy !== 'source_allowed') {
    const changedPaths = workspaceChangedPathsFromSnapshots(
      beforeSnapshot,
      afterSnapshot,
    )
    const releaseMetadataAllowed =
      stage.workspace_policy === 'release_metadata_only' &&
      isSelfDevelopmentInstallation(root)
    const blockingPaths = releaseMetadataAllowed
      ? changedPaths.filter(
          (relativePath) => !isReleaseMetadataPath(relativePath),
        )
      : changedPaths
    const allowedPaths = releaseMetadataAllowed
      ? changedPaths.filter((relativePath) =>
          isReleaseMetadataPath(relativePath),
        )
      : []
    const attribution = stageOutput?.workspace_changes
    const normalizeDeclaredPath = (relativePath: string): string =>
      path.posix
        .normalize(relativePath.replaceAll('\\', '/'))
        .replace(/^\.\//u, '')
    const declaredInternalPaths = new Set(
      attribution?.attribution === 'internal'
        ? attribution.paths.map(normalizeDeclaredPath)
        : [],
    )
    const internallyAttributed =
      blockingPaths.length > 0 &&
      attribution?.attribution === 'internal' &&
      attribution.explanation.trim().length > 0 &&
      blockingPaths.every((relativePath) =>
        declaredInternalPaths.has(normalizeDeclaredPath(relativePath)),
      )
    const unattributedPaths = blockingPaths.filter(
      (relativePath) => !declaredInternalPaths.has(relativePath),
    )
    const changed = blockingPaths.length > 0 && !internallyAttributed

    scopePassed = !changed
    results.push({
      id: 'scope.no_unapproved_changes',
      type: 'state',
      hard: true,
      passed: !changed,
      explanation: changed
        ? `Workspace contamination is external or unattributed for the '${stage.workspace_policy}' stage: ${boundedPathList(unattributedPaths.length > 0 ? unattributedPaths : blockingPaths)}.`
        : internallyAttributed
          ? `All workspace changes were traced to the active worker; no external contamination was detected: ${boundedPathList(blockingPaths)}.`
          : allowedPaths.length > 0
            ? `Only permitted release metadata changed: ${boundedPathList(allowedPaths)}.`
            : 'Workspace fingerprint is unchanged.',
      delta:
        changedPaths.length > 0
          ? boundedWorkspaceDelta(workspaceDelta(beforeSnapshot, afterSnapshot))
          : { added: [], removed: [] },
      workspace_fingerprint: afterSnapshot.fingerprint,
    })
  }

  for (const criterion of stage.criteria) {
    if (criterion.type === 'shell') {
      const override = Object.prototype.hasOwnProperty.call(
        gateOverrides,
        criterion.id,
      )
        ? gateOverrides[criterion.id]
        : undefined

      const verificationSkip =
        override === undefined &&
        state.verification !== undefined &&
        state.verification.gates[criterion.id] === false &&
        repositoryCheckProfileName(criterion.command ?? '') !== null

      // A shell gate can only confirm a success. When the submission has
      // already decided a non-success outcome, executing the command spends
      // its runtime proving nothing, so the gate is recorded as skipped
      // instead of run. State criteria below still evaluate: scope and
      // currency checks detect contamination regardless of the outcome.
      if (gateSkipReason !== null) {
        results.push({
          id: criterion.id,
          type: 'shell',
          hard: Boolean(criterion.hard),
          passed: true,
          skipped: true,
          explanation:
            `Gate not executed: ${gateSkipReason}, so the outcome was ` +
            'already decided as non-success before any deterministic gate ' +
            'ran. A shell gate runs only when its result can decide the stage.',
          command: criterion.command,
          workspace_fingerprint: afterSnapshot.fingerprint,
        })
      } else if (override === false) {
        results.push({
          id: criterion.id,
          type: 'shell',
          hard: Boolean(criterion.hard),
          passed: true,
          disabled: true,
          explanation: 'Gate disabled by run configuration.',
          command: criterion.command,
          workspace_fingerprint: afterSnapshot.fingerprint,
        })
      } else if (verificationSkip) {
        results.push({
          id: criterion.id,
          type: 'shell',
          hard: Boolean(criterion.hard),
          passed: true,
          disabled: true,
          verification_level: state.verification?.level,
          explanation:
            `Gate skipped by verification level ` +
            `'${state.verification?.level}'.`,
          command: criterion.command,
          workspace_fingerprint: afterSnapshot.fingerprint,
        })
      } else {
        results.push(
          runShellCheck(
            root,
            runDirectory,
            state,
            stage,
            criterion,
            afterSnapshot,
            workspaceDir,
            typeof override === 'string' ? override : undefined,
            artifactId,
            onProgress,
          ),
        )
      }
    } else if (criterion.type === 'state') {
      if (criterion.id === 'ship.release_metadata_updated') {
        const metadataErrors = isSelfDevelopmentInstallation(root)
          ? validateReleaseMetadata(root).errors
          : []

        results.push({
          id: criterion.id,
          type: 'state',
          hard: Boolean(criterion.hard),
          passed: metadataErrors.length === 0,
          explanation: isTargetInstallation(root)
            ? 'Pancreator release metadata is not owned by embedded target workflows.'
            : metadataErrors.length === 0
              ? 'Release metadata and version-bearing documentation are synchronized.'
              : `Release metadata is not synchronized: ${metadataErrors.join('; ')}`,
          workspace_fingerprint: afterSnapshot.fingerprint,
        })
        continue
      }

      const evidenceFingerprint = resolveShipPriorGatesEvidenceFingerprint({
        state,
        stage,
        beforeSnapshot,
        afterSnapshot,
        scopePassed,
      })
      const result = evaluateStateCriterion(
        state,
        criterion,
        evidenceFingerprint,
      )
      const releaseMetadataNormalized =
        stage.workspace_policy === 'release_metadata_only' &&
        criterion.id === 'ship.prior_gates_current' &&
        evidenceFingerprint !== afterSnapshot.fingerprint

      results.push(
        releaseMetadataNormalized
          ? {
              ...result,
              explanation:
                `${result.explanation ?? ''} Every ship attempt since QA chains back to the QA fingerprint with an adjudicated scope window, so ship-stage edits do not invalidate the reviewed implementation fingerprint.`.trim(),
              workspace_fingerprint: afterSnapshot.fingerprint,
            }
          : result,
      )
    }
  }

  return { results, workspace: afterSnapshot }
}

function listMarkdownFiles(directory: string): string[] {
  const files: string[] = []

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      files.push(...listMarkdownFiles(absolute))
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(absolute)
    }
  }

  return files
}

const CODE_REVIEW_PERSONAS = new Set([
  'coder',
  'metacritic',
  'reviewer',
  'qa-tester',
])
const DESIGN_PERSONAS = new Set(['designer', 'design-reviewer', 'design-qa'])
const PYTHON_GUIDANCE_PERSONAS = new Set([...CODE_REVIEW_PERSONAS, 'spotfixer'])
const POLICY_REFERENCE_PATTERN = /\b[A-Z][A-Z0-9]*-\d{3}\b/gu
const STATIC_GUIDANCE_PATH_PATTERN =
  /\b(?:governance\/handbooks|library\/skills)\/[A-Za-z0-9._/-]+\.md\b/gu

interface HandbookPolicyRequirement {
  handbook_path: string
  label: string
  personas: Set<string>
  installation_scope?: 'all' | 'self_development'
  technology?: string
}

const HANDBOOK_POLICY_REQUIREMENTS: HandbookPolicyRequirement[] = [
  {
    handbook_path: 'governance/handbooks/eng/engineering.md',
    label: 'engineering handbook',
    personas: CODE_REVIEW_PERSONAS,
  },
  {
    handbook_path: 'governance/handbooks/typescript/style-guide.md',
    label: 'TypeScript handbook',
    personas: CODE_REVIEW_PERSONAS,
    installation_scope: 'self_development',
  },
  {
    handbook_path: 'governance/handbooks/python/style-guide.md',
    label: 'Python handbook',
    personas: PYTHON_GUIDANCE_PERSONAS,
    technology: 'python',
  },
  {
    handbook_path: 'governance/handbooks/design/ux-guide.md',
    label: 'design handbook',
    personas: DESIGN_PERSONAS,
  },
]

function handbookRequirementApplies(
  requirement: HandbookPolicyRequirement,
  selfDevelopment: boolean,
): boolean {
  return (
    requirement.installation_scope !== 'self_development' || selfDevelopment
  )
}

function validateHandbookPolicyCoverage(
  root: string,
  catalog: Map<string, Policy>,
  requirement: HandbookPolicyRequirement,
  errors: string[],
): Set<string> {
  const handbookAbsolute = path.join(root, requirement.handbook_path)

  if (!fileExists(handbookAbsolute)) {
    errors.push(`missing required file: ${requirement.handbook_path}`)
    return new Set<string>()
  }

  const policyIds = new Set<string>()
  const matches = [...catalog.values()].filter((policy) =>
    (policy.guidance ?? []).some(
      (guidance) => guidance.source_path === requirement.handbook_path,
    ),
  )

  if (matches.length === 0) {
    errors.push(
      `${requirement.handbook_path} MUST be delivered by at least one policy`,
    )
    return policyIds
  }

  for (const policy of matches) {
    policyIds.add(policy.id)
  }

  return policyIds
}

function validateGovernance(
  root: string,
  catalog: Map<string, Policy>,
  errors: string[],
): Map<string, Set<string>> {
  const governanceRoot = path.join(root, 'governance')
  const directivePattern = /\b(?:MUST(?: NOT)?|SHOULD(?: NOT)?|MAY)\b/u

  for (const filePath of listMarkdownFiles(governanceRoot)) {
    const relative = path.relative(root, filePath).split(path.sep).join('/')
    const content = readText(filePath)

    if (!content.includes('RFC 2119')) {
      errors.push(`${relative} MUST declare RFC 2119 directive semantics`)
    }
  }

  for (const policy of catalog.values()) {
    if (!directivePattern.test(policy.summary)) {
      errors.push(`${policy.id} summary MUST use an RFC 2119 directive`)
    }

    for (const [index, instruction] of policy.instructions.entries()) {
      if (!directivePattern.test(instruction)) {
        errors.push(
          `${policy.id} instruction ${index + 1} MUST use an RFC 2119 directive`,
        )
      }
    }

    const declaredGuidance = new Set(
      (policy.guidance ?? []).map((guidance) => guidance.source_path),
    )
    const staticReferences = [policy.summary, ...policy.instructions].flatMap(
      (text) => text.match(STATIC_GUIDANCE_PATH_PATTERN) ?? [],
    )

    for (const guidancePath of new Set(staticReferences)) {
      if (!declaredGuidance.has(guidancePath)) {
        errors.push(
          `${policy.id} references static guidance ${guidancePath} without declaring it in guidance_sources`,
        )
      }
    }
  }

  const handbookPolicies = new Map<string, Set<string>>()

  for (const requirement of HANDBOOK_POLICY_REQUIREMENTS) {
    handbookPolicies.set(
      requirement.handbook_path,
      validateHandbookPolicyCoverage(root, catalog, requirement, errors),
    )
  }

  return handbookPolicies
}

function lookupPatternCovers(provider: string, consumer: string): boolean {
  return provider === '*' || provider === consumer
}

function lookupRowCovers(
  provider: PolicyLookupRow,
  consumer: PolicyLookupRow,
): boolean {
  return (
    lookupPatternCovers(provider.persona, consumer.persona) &&
    lookupPatternCovers(provider.workflow, consumer.workflow) &&
    lookupPatternCovers(provider.stage, consumer.stage) &&
    (provider.technology === undefined ||
      provider.technology === consumer.technology) &&
    // A contract-scoped row only resolves for runs carrying that contract, so it
    // cannot satisfy a dependency for a row that resolves without one.
    (provider.contract === undefined ||
      provider.contract === consumer.contract) &&
    // Same reasoning for operator-artifact-scoped rows.
    (provider.operator_artifacts === undefined ||
      provider.operator_artifacts === consumer.operator_artifacts)
  )
}

function referencedPolicyIds(policy: Policy): Set<string> {
  const text = [
    policy.summary,
    ...policy.instructions,
    ...(policy.guidance ?? []).map((guidance) => guidance.content),
  ].join('\n')
  return new Set(text.match(POLICY_REFERENCE_PATTERN) ?? [])
}

function validatePolicyLookupDependencies(
  catalog: Map<string, Policy>,
  lookup: PolicyLookupTable,
  errors: string[],
): void {
  for (const policy of catalog.values()) {
    for (const referencedId of referencedPolicyIds(policy)) {
      if (!catalog.has(referencedId)) {
        errors.push(`${policy.id} references missing policy ${referencedId}`)
      }
    }
  }

  for (const [index, row] of lookup.rows.entries()) {
    const available = new Set(
      lookup.rows
        .filter((candidate) => lookupRowCovers(candidate, row))
        .flatMap((candidate) => candidate.policies),
    )

    for (const policyId of row.policies) {
      const policy = catalog.get(policyId)

      if (!policy) {
        continue
      }

      for (const referencedId of referencedPolicyIds(policy)) {
        if (catalog.has(referencedId) && !available.has(referencedId)) {
          errors.push(
            `policy lookup row ${index} (${row.persona}/${row.workflow}/${row.stage}) ` +
              `loads ${policyId} without referenced policy ${referencedId}`,
          )
        }
      }
    }
  }
}

const QUESTION_TOOL_IDENTIFIERS = [
  'cursor/ask_question',
  'ask_question',
  'askquestion',
  'ask-question',
] as const
const CURSOR_AGENT_FRONTMATTER_PATTERN =
  /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u

/** Check that canonical Cursor agent frontmatter does not name the ACP method. */
export function validateQuestionToolAccess(root: string): string[] {
  const directory = path.join(root, 'library', 'cursor', 'agents')

  if (!fileExists(directory)) {
    return ['missing canonical Cursor agent directory: library/cursor/agents']
  }

  const filenames = readdirSync(directory)
    .filter((filename) => filename.endsWith('.md'))
    .sort()

  if (filenames.length === 0) {
    return ['library/cursor/agents MUST contain canonical agent files']
  }

  const errors: string[] = []

  for (const filename of filenames) {
    const absolute = path.join(directory, filename)
    const frontmatter = CURSOR_AGENT_FRONTMATTER_PATTERN.exec(
      readText(absolute),
    )?.[1]

    if (!frontmatter) {
      continue
    }

    const normalized = frontmatter.toLowerCase()
    const identifier = QUESTION_TOOL_IDENTIFIERS.find((candidate) =>
      normalized.includes(candidate),
    )

    if (identifier) {
      errors.push(
        `library/cursor/agents/${filename} frontmatter MUST NOT name or block ` +
          `question-method identifier '${identifier}'`,
      )
    }
  }

  return errors
}

export function validateRepository(root: string): RepositoryValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  const selfDevelopment = isSelfDevelopmentInstallation(root)
  const required = [
    'AGENTS.md',
    'CHANGELOG.md',
    'VERSION',
    'package.json',
    'package-lock.json',
    'prettier.config.js',
    'tsconfig.json',
    'governance/registries/policy_lookup_table.json',
    'governance/handbooks/eng/engineering.md',
    'governance/handbooks/python/style-guide.md',
    'governance/handbooks/typescript/style-guide.md',
    'governance/registries/validation_registry.json',
    'governance/registries/directive_exemptions.json',
    'governance/registries/projection_manifest.json',
    'docs/validation-framework.md',
    'config.json',
    'library/schemas/config.schema.json',
    'library/schemas/stage-output.schema.json',
    'library/schemas/workflow.schema.json',
    'library/schemas/stage.schema.json',
    'library/cursor/commands/pan-start.md',
    'library/cursor/commands/pan-resume.md',
    'library/cursor/commands/pan-debug.md',
    'library/cursor/commands/pan-repair.md',
    'library/cursor/commands/pan-decompose.md',
    'library/cursor/commands/pan-build-docs.md',
    'library/cursor/commands/pan-build-briefs.md',
    'library/cursor/commands/pan-spotfix.md',
    'library/cursor/commands/pan-pair.md',
    'library/cursor/commands/pan-write-pr.md',
    'library/cursor/agents/decomposer.md',
    'library/cursor/agents/librarian.md',
    'library/cursor/agents/investigator.md',
    'library/cursor/agents/harness-technician.md',
    'library/cursor/agents/repo-technician.md',
    'library/cursor/agents/spotfixer.md',
    'library/personas/decomposer.md',
    'library/personas/librarian.md',
    'library/personas/investigator.md',
    'library/personas/harness-technician.md',
    'library/personas/repo-technician.md',
    'library/personas/spotfixer.md',
    'library/skills/spotfix.md',
    'library/skills/write-pr-description.md',
    'library/skills/craft-operator-artifact.md',
    'library/operator-briefs/primitives.json',
    'library/operator-briefs/base.css',
    'library/schemas/operator-brief.schema.json',
    'library/schemas/operator-brief-system.schema.json',
    'library/templates/operator-briefs/project.json',
    'library/templates/operator-briefs/project.css',
    'library/templates/operator-briefs/brief.example.json',
    'docs/operator-brief-system.md',
    'library/templates/repository-checks.json',
    'library/templates/repository-checks.self-development.json',
    'release/index.json',
    'governance/policies/DECOMP-001.json',
    'governance/policies/PY-001.json',
    'governance/policies/BRIEF-001.json',
    'governance/policies/PRIMER-001.json',
    'governance/policies/REPO-001.json',
    'governance/policies/PR-001.json',
    'governance/policies/WORK-001.json',
    'governance/policies/REPAIR-001.json',
    'governance/policies/SPOT-001.json',
    'governance/policies/PAIR-001.json',
    'governance/policies/PROTO-001.json',
    'governance/policies/DIRECTOR-001.json',
    'library/workflows/prototype/workflow.json',
    'src/cli.ts',
  ]

  if (selfDevelopment) {
    required.push(
      'docs/operator-briefs/project.json',
      'docs/operator-briefs/project.css',
      // The harness review lineup. `bin/install` drops it from the staged
      // payload, so it is required here and absent from a target installation.
      'library/skills/review-squad-pancreator.md',
    )
  }

  for (const relative of required) {
    if (!fileExists(path.join(root, relative))) {
      errors.push(`missing required file: ${relative}`)
    }
  }

  errors.push(...validateQuestionToolAccess(root))
  errors.push(...validateReleaseMetadata(root).errors)

  try {
    assertRepositoryChecksValid(root)
  } catch (error) {
    errors.push(errorMessage(error))
  }

  let pipelineConfig: LoadedPipelineConfig | null = null
  let handbookPolicies = new Map<string, Set<string>>()

  try {
    pipelineConfig = loadPipelineConfig(root)
  } catch (error) {
    errors.push(errorMessage(error))
  }

  try {
    const catalog = loadPolicyCatalog(root)

    if (catalog.size === 0) {
      errors.push('policy catalog MUST NOT be empty')
    }

    const lookup = readPolicyLookupTable(root)

    for (const row of lookup.rows) {
      for (const id of row.policies) {
        if (!catalog.has(id)) {
          errors.push(`policy lookup references missing policy: ${id}`)
        }
      }
    }

    validatePolicyLookupDependencies(catalog, lookup, errors)

    if (
      fileExists(
        path.join(root, 'governance', 'registries', 'validation_registry.json'),
      )
    ) {
      const registry = loadRegistry(root)
      errors.push(...validateRegistry(registry, HANDLER_IDS))
      errors.push(...validatePolicyRequirements(root, registry))

      for (const row of lookup.rows) {
        try {
          resolveRequirements(root, {
            persona: row.persona,
            workflow: row.workflow,
            stage: row.stage,
          })
        } catch (error) {
          errors.push(
            `requirement resolution failed for ${row.persona}/${row.workflow}/${row.stage}: ${errorMessage(error)}`,
          )
        }
      }
    }

    const directiveAudit = auditDirectives(root)
    errors.push(...directiveAudit.errors)
    warnings.push(...directiveAudit.warnings)

    const projection = validateProjectionDrift(root)
    errors.push(...projection.errors)

    handbookPolicies = validateGovernance(root, catalog, errors)
  } catch (error) {
    errors.push(errorMessage(error))
  }

  const workflowPersonas = new Set<string>()

  for (const slug of listWorkflowSlugs(root)) {
    try {
      const workflow = loadWorkflow(root, slug)

      for (const stage of workflow.stages) {
        workflowPersonas.add(stage.persona)

        // Repository verification MUST route through configured profiles rather
        // than baking a project-shaped command into a workflow (REPO-001).
        const canonicalRepositoryChecks: Record<
          string,
          Record<string, string>
        > = {
          dev: {
            'implement.lint': 'pan repository-check static',
            'implement.unit_tests': 'pan repository-check fast',
            'test.full_suite': 'pan repository-check full',
            'ship.validate': 'pan repository-check configuration',
          },
          prototype: {
            'build.static': 'pan repository-check static',
            'build.fast_checks': 'pan repository-check fast',
          },
        }
        const expectedForWorkflow = canonicalRepositoryChecks[workflow.slug]

        if (expectedForWorkflow) {
          for (const criterion of stage.criteria) {
            const expectedCommand = expectedForWorkflow[criterion.id]

            if (expectedCommand && criterion.command !== expectedCommand) {
              errors.push(
                `${workflow.slug} criterion '${criterion.id}' MUST use '${expectedCommand}'`,
              )
            }

            if (criterion.id === 'test.coverage') {
              errors.push(
                `${workflow.slug} MUST NOT require a standalone coverage gate; configure coverage inside a target-owned repository profile when applicable`,
              )
            }
          }
        }

        // A prototype deprioritizes QA breadth by design; a hard full-suite gate
        // would reintroduce exactly the cost the workflow exists to avoid.
        if (workflow.slug === 'prototype') {
          for (const criterion of stage.criteria) {
            if (
              criterion.type === 'shell' &&
              criterion.hard === true &&
              criterion.command !== 'pan repository-check static'
            ) {
              errors.push(
                `prototype criterion '${criterion.id}' MUST NOT be a hard shell ` +
                  'gate other than the static profile; report other profiles as ' +
                  'advisory evidence instead',
              )
            }
          }
        }
        const policies = resolvePolicies(root, {
          persona: stage.persona,
          workflow: workflow.slug,
          stage: stage.slug,
        })

        for (const requirement of HANDBOOK_POLICY_REQUIREMENTS) {
          if (
            !handbookRequirementApplies(requirement, selfDevelopment) ||
            !requirement.personas.has(stage.persona)
          ) {
            continue
          }

          const handbookPolicyIds =
            handbookPolicies.get(requirement.handbook_path) ?? new Set<string>()
          const applicablePolicies = requirement.technology
            ? resolvePolicies(root, {
                persona: stage.persona,
                workflow: workflow.slug,
                stage: stage.slug,
                technologies: [requirement.technology],
              })
            : policies
          const hasHandbookPolicy = applicablePolicies.some((policy) =>
            handbookPolicyIds.has(policy.id),
          )

          if (hasHandbookPolicy) {
            continue
          }

          errors.push(
            `workflow stage '${workflow.slug}/${stage.slug}' persona ` +
              `'${stage.persona}' MUST load a policy for the ` +
              `${requirement.label}`,
          )
        }

        const personaPath = path.join(
          root,
          'library',
          'personas',
          `${stage.persona}.md`,
        )

        if (!fileExists(personaPath)) {
          errors.push(`missing persona: library/personas/${stage.persona}.md`)
        }

        const agentPath = path.join(
          root,
          'library',
          'cursor',
          'agents',
          `${stage.persona}.md`,
        )

        if (!fileExists(agentPath)) {
          errors.push(
            `missing Cursor agent template: library/cursor/agents/${stage.persona}.md`,
          )
        }
      }
    } catch (error) {
      errors.push(errorMessage(error))
    }
  }

  validateOperatorInvolvementProfiles(root, errors)

  const cursorAgentPersonas = new Set<string>()
  const cursorAgentDirectory = path.join(root, 'library', 'cursor', 'agents')

  if (fileExists(cursorAgentDirectory)) {
    for (const entry of readdirSync(cursorAgentDirectory, {
      withFileTypes: true,
    })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) {
        continue
      }

      const persona = entry.name.slice(0, -3)
      cursorAgentPersonas.add(persona)

      if (
        !fileExists(path.join(root, 'library', 'personas', `${persona}.md`))
      ) {
        errors.push(`missing persona: library/personas/${persona}.md`)
      }
    }
  }

  const configuredPersonas = new Set([
    ...workflowPersonas,
    ...cursorAgentPersonas,
  ])

  if (pipelineConfig) {
    for (const configName of Object.keys(pipelineConfig.file.configs)) {
      const personas = resolveConfigPersonas(pipelineConfig.file, configName)

      for (const persona of configuredPersonas) {
        if (!personas[persona]) {
          errors.push(
            `pipeline config '${configName}' does not map persona '${persona}'`,
          )
        }
      }
    }
  }

  for (const directory of [
    'library/cursor/agents',
    'library/cursor/commands',
    'src/lib',
  ]) {
    const absolute = path.join(root, directory)

    if (fileExists(absolute) && readdirSync(absolute).length === 0) {
      warnings.push(`${directory} is empty`)
    }
  }

  const legacyModules = [
    ...readdirSync(path.join(root, 'src'), { recursive: true }),
    ...readdirSync(path.join(root, 'tests'), { recursive: true }),
  ].filter((entry) => typeof entry === 'string' && entry.endsWith('.mjs'))

  if (legacyModules.length > 0) {
    errors.push('src/ and tests/ MUST NOT contain legacy .mjs modules')
  }

  validateAdHocModelInheritanceGuidance(root, errors)

  if (
    fileExists(path.join(root, 'library', 'cursor', 'commands', 'pan-repo.md'))
  ) {
    errors.push(
      'repo-technician MUST remain directly invocable without a dedicated pan-repo command',
    )
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    report_hash: sha256({ errors, warnings }),
  }
}

/**
 * Check every involvement profile against every workflow at authoring time. A
 * profile is shared across workflows, so a stage key only has to match one of
 * them; a key matching none is a typo that would otherwise surface as a failed
 * `pan init` for whoever selected the profile first.
 */
function validateOperatorInvolvementProfiles(
  root: string,
  errors: string[],
): void {
  let file: OperatorInvolvementFile

  try {
    file = loadOperatorInvolvementFile(root)
  } catch (error) {
    errors.push(errorMessage(error))
    return
  }

  const workflows = listWorkflowSlugs(root).flatMap((slug) => {
    try {
      return [loadWorkflow(root, slug)]
    } catch {
      // Workflow-level defects are already reported by the workflow loop.
      return []
    }
  })

  const profileEntries: Array<[string, OperatorInvolvementProfile]> =
    Object.entries(file.profiles)

  for (const [name, profile] of profileEntries) {
    for (const stageKey of Object.keys(profile.gates ?? {})) {
      if (stageKey === '*') {
        continue
      }

      const owners = workflows.filter((workflow) =>
        workflow.stages.some((stage) => stage.slug === stageKey),
      )

      if (owners.length === 0) {
        errors.push(
          `operator-involvement profile '${name}' targets stage '${stageKey}', ` +
            'which no workflow defines',
        )
      }
    }

    for (const workflow of workflows) {
      try {
        applyOperatorInvolvement(structuredClone(workflow), { name, profile })
      } catch (error) {
        // Only report the mismatch when the profile actually names a stage of
        // this workflow; a shared profile is allowed to be inert elsewhere.
        const targetsWorkflow = Object.keys(profile.gates ?? {}).some(
          (key) =>
            key === '*' || workflow.stages.some((stage) => stage.slug === key),
        )

        if (targetsWorkflow || (profile.contracts ?? []).length > 0) {
          errors.push(
            `operator-involvement profile '${name}' cannot apply to workflow ` +
              `'${workflow.slug}': ${errorMessage(error)}`,
          )
        }
      }
    }
  }
}

function validateAdHocModelInheritanceGuidance(
  root: string,
  errors: string[],
): void {
  const sources = [
    'AGENTS.md',
    'library/templates/embedded-AGENTS.md',
    'library/cursor/rules/pancreator-self-development.mdc',
    'library/cursor/rules/pancreator-embedded.mdc',
  ]

  for (const relative of sources) {
    const absolute = path.join(root, relative)

    if (!fileExists(absolute)) {
      continue
    }

    const content = readText(absolute)
    const hasDefaultInheritance =
      /Ad-hoc Subagent calls MUST omit `model`/u.test(content) &&
      /inherit the parent model/u.test(content)
    const hasExplicitOverride =
      /operator explicitly selects(?: a model| one| model)?/u.test(content)
    const hasNamedRouting =
      /named[- ]personas?/iu.test(content) &&
      (/projected/u.test(content) || /project\.json/u.test(content))

    if (!hasDefaultInheritance) {
      errors.push(
        `${relative} MUST require ad-hoc Subagent calls to omit model and inherit the parent model`,
      )
    }

    if (!hasExplicitOverride) {
      errors.push(
        `${relative} MUST preserve explicit operator-selected model override for ad-hoc Subagent calls`,
      )
    }

    if (!hasNamedRouting) {
      errors.push(
        `${relative} MUST preserve named-persona projected model routing`,
      )
    }
  }
}
