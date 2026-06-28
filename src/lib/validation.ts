import { spawnSync } from 'node:child_process'
import { readdirSync, rmSync } from 'node:fs'
import path from 'node:path'

import { errorMessage, isNodeError } from './errors.js'
import {
  ensureDir,
  fileExists,
  isRecord,
  readJson,
  readText,
  resolveInside,
  sha256,
  writeTextAtomic,
} from './io.js'
import { loadPipelineConfig, syncCursorAgentModels } from './pipeline-config.js'
import { panCommand } from './project-config.js'
import type { LoadedPipelineConfig } from './pipeline-config.js'
import { auditDirectives } from './governance/audit-directives.js'
import { HANDLER_IDS } from './requirements/handlers.js'
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
  blockingWorkspacePathsFromSnapshots,
  snapshotWorkspace,
} from './workspace/index.js'
import { resolveRoots } from './workspace/roots.js'
import { listWorkflowSlugs, loadWorkflow } from './workflow.js'
import { activeOperatorGateWaivers } from './waivers.js'
import type {
  ArtifactReference,
  Criterion,
  CriterionEvaluation,
  DeterministicResult,
  Invocation,
  JsonTypeName,
  Policy,
  PolicyLookupRow,
  PolicyLookupTable,
  RepositoryValidationResult,
  RunState,
  StageDefinition,
  StageOutput,
  StageOutcome,
  WorkspaceSnapshot,
} from './types.js'

export const POLICIES_HEADING = '## 📜 Policies in force'
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
  kind: 'invocation' | 'delegation'
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

export function invocationValidationPath(
  runId: string,
  invocationId: string,
): string {
  return (
    `runtime/logs/workflows/${runId}/invocations/` +
    `${invocationId}.invocation-validation.json`
  )
}

export function delegationPath(runId: string, invocationId: string): string {
  return (
    `runtime/logs/workflows/${runId}/invocations/` +
    `${invocationId}.delegation.md`
  )
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

  const targetRelative = delegationPath(runId, invocationId)
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
): string {
  return (
    `runtime/logs/workflows/${runId}/invocations/` +
    `${invocationId}.delegation-validation.json`
  )
}

export function buildValidationArtifact(options: {
  run_id: string
  invocation_id: string
  kind: 'invocation' | 'delegation'
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

export function validateInvocationMarkdown(
  invocation: Invocation,
  markdown: string,
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
        `${requirement.requirement_id} (${requirement.phase})`

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

export function validateDelegationMarkdown(
  canonicalMarkdown: string,
  delegationMarkdown: string,
): { passed: boolean; checks: ValidationCheck[] } {
  const canonical = normalizeMarkdownContent(canonicalMarkdown)
  const delegation = normalizeMarkdownContent(delegationMarkdown)
  const canonicalNormalized = canonical.endsWith('\n')
    ? canonical
    : `${canonical}\n`
  const delegationNormalized = delegation.endsWith('\n')
    ? delegation
    : `${delegation}\n`
  const passed = canonicalNormalized === delegationNormalized

  return {
    passed,
    checks: [
      {
        id: 'delegation.canonical_equality',
        passed,
        message: passed
          ? 'Delegation artifact matches canonical invocation markdown'
          : 'Delegation artifact MUST equal the canonical invocation card after line-ending normalization',
      },
    ],
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
  )
  const delegationValidationPathValue = delegationValidationPath(
    runId,
    invocationId,
  )
  const delegationPathValue = delegationPath(runId, invocationId)

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
    data: isRecord(record.data) ? record.data : {},
  }
}

export function validateStageOutput(
  root: string,
  stage: StageDefinition,
  invocation: Invocation,
  value: unknown,
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

  for (const key of ['artifacts', 'criteria', 'risks', 'unknowns']) {
    if (!Array.isArray(record[key])) {
      errors.push(`${key} MUST be an array`)
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

  const criteria = new Map<string, CriterionEvaluation>()

  for (const item of output.criteria) {
    if (criteria.has(item.id)) {
      errors.push(`duplicate criteria result: ${item.id}`)
    }

    if (item.explanation.length === 0) {
      errors.push(`criteria '${item.id}' explanation MUST be non-empty`)
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

    if (evaluation.result === 'pass' && evaluation.evidence.length === 0) {
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

  for (const artifact of output.artifacts) {
    try {
      const absolute = resolveInside(root, artifact.path)

      if (!fileExists(absolute)) {
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

function runShellCheck(
  root: string,
  runDirectory: string,
  stage: StageDefinition,
  criterion: Criterion,
  workspaceFingerprint: string,
  workspaceDir: string,
  commandOverride?: string,
  artifactId = stage.slug,
): DeterministicResult {
  const command = commandOverride ?? criterion.command ?? ''
  const startedAt = new Date().toISOString()
  const result = spawnSync(command, {
    cwd: workspaceDir,
    encoding: 'utf8',
    shell: true,
    timeout: criterion.timeout_ms ?? 120_000,
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, PAN_WORKFLOW_STAGE: stage.slug },
  })
  const safeCriterionId = criterion.id.replaceAll(/[^a-zA-Z0-9_.-]/g, '-')
  const evidencePath = path.join(
    runDirectory,
    'evidence',
    `${artifactId}-${safeCriterionId}.log`,
  )
  const combined = [
    `$ ${command}`,
    `started_at=${startedAt}`,
    `finished_at=${new Date().toISOString()}`,
    `workspace_fingerprint=${workspaceFingerprint}`,
    `exit_code=${result.status ?? 'null'}`,
    result.signal ? `signal=${result.signal}` : null,
    '',
    '--- stdout ---',
    result.stdout ?? '',
    '--- stderr ---',
    result.stderr ?? '',
    result.error ? `--- error ---\n${result.error.message}` : '',
  ]
    .filter((line): line is string => line !== null)
    .join('\n')

  writeTextAtomic(evidencePath, combined)

  return {
    id: criterion.id,
    type: 'shell',
    hard: Boolean(criterion.hard),
    passed: result.status === 0 && !result.error,
    ...(commandOverride === undefined
      ? {}
      : {
          overridden: true,
          explanation: 'Gate command was overridden by run configuration.',
        }),
    command,
    exit_code: result.status,
    timed_out: isNodeError(result.error) && result.error.code === 'ETIMEDOUT',
    evidence_path: path.relative(root, evidencePath).split(path.sep).join('/'),
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
    const review = [...state.stage_history]
      .reverse()
      .find((item) => item.stage === 'review')
    const test = [...state.stage_history]
      .reverse()
      .find((item) => item.stage === 'test')

    const activeWaivers = activeOperatorGateWaivers(state, workspaceFingerprint)
    const waiverFor = (stage: string, invocationId: string | undefined) =>
      activeWaivers.find(
        (waiver) =>
          waiver.stage === stage &&
          waiver.source_invocation_id === invocationId,
      )

    const reviewWaiver = waiverFor('review', review?.invocation_id)
    const testWaiver = waiverFor('test', test?.invocation_id)
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
      fingerprintCurrent || operatorAccepted || acceptedEvidenceFingerprint
    const fingerprintBasis = fingerprintCurrent
      ? 'current workspace fingerprint'
      : 'operator-accepted workspace fingerprint'

    passed = Boolean(test && gatesCurrent && reviewSatisfied && testSatisfied)
    explanation = !passed
      ? 'Passing review/QA evidence is missing or stale.'
      : reviewWaiver || testWaiver
        ? `Operator-waived ${[
            reviewWaiver ? 'review' : null,
            testWaiver ? 'QA' : null,
          ]
            .filter(Boolean)
            .join(
              ' and ',
            )} evidence satisfies the gate; remaining evidence matches the ${fingerprintBasis}.`
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

export function evaluateDeterministicCriteria(
  root: string,
  runDirectory: string,
  state: RunState,
  stage: StageDefinition,
  beforeSnapshot: WorkspaceSnapshot,
  workspaceDir: string,
  gateOverrides: Record<string, string | false> = {},
  artifactId = stage.slug,
): { results: DeterministicResult[]; workspace: WorkspaceSnapshot } {
  const roots = resolveRoots({
    installation_root: root,
    workspace_root: workspaceDir,
    state_root: state.state_root,
  })
  const afterSnapshot = snapshotWorkspace(roots, false).snapshot
  const results: DeterministicResult[] = []

  if (stage.workspace_policy !== 'source_allowed') {
    const blockingPaths = blockingWorkspacePathsFromSnapshots(
      beforeSnapshot,
      afterSnapshot,
      roots,
    )
    const changed = blockingPaths.length > 0

    results.push({
      id: 'scope.no_unapproved_changes',
      type: 'state',
      hard: true,
      passed: !changed,
      explanation: changed
        ? `Workspace changed during a stage that forbids source changes: ${blockingPaths.join(', ')}.`
        : 'Workspace fingerprint is unchanged.',
      delta: changed
        ? workspaceDelta(beforeSnapshot, afterSnapshot)
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

      if (override === false) {
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
      } else {
        results.push(
          runShellCheck(
            root,
            runDirectory,
            stage,
            criterion,
            afterSnapshot.fingerprint,
            workspaceDir,
            typeof override === 'string' ? override : undefined,
            artifactId,
          ),
        )
      }
    } else if (criterion.type === 'state') {
      results.push(
        evaluateStateCriterion(state, criterion, afterSnapshot.fingerprint),
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

const CODE_REVIEW_PERSONAS = new Set(['coder', 'reviewer', 'qa-tester'])
const POLICY_REFERENCE_PATTERN = /\b[A-Z][A-Z0-9]*-\d{3}\b/gu

interface HandbookPolicyRequirement {
  handbook_path: string
  label: string
  personas: Set<string>
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
  },
]

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
    [policy.summary, ...policy.instructions].some((text) =>
      text.includes(requirement.handbook_path),
    ),
  )

  if (matches.length === 0) {
    errors.push(
      `${requirement.handbook_path} MUST be referenced by at least one policy`,
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
    lookupPatternCovers(provider.stage, consumer.stage)
  )
}

function referencedPolicyIds(policy: Policy): Set<string> {
  const text = [policy.summary, ...policy.instructions].join('\n')
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

export function validateRepository(root: string): RepositoryValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  const required = [
    'AGENTS.md',
    'package.json',
    'prettier.config.js',
    'tsconfig.json',
    'governance/registries/policy_lookup_table.json',
    'governance/handbooks/eng/engineering.md',
    'governance/handbooks/typescript/style-guide.md',
    'governance/registries/validation_registry.json',
    'governance/registries/directive_exemptions.json',
    'governance/registries/projection_manifest.json',
    'docs/validation-framework.md',
    'project.json',
    'library/schemas/project.schema.json',
    'library/schemas/stage-output.schema.json',
    'library/schemas/workflow.schema.json',
    'library/schemas/stage.schema.json',
    '.cursor/commands/pan-start.md',
    '.cursor/commands/pan-resume.md',
    '.cursor/commands/pan-debug.md',
    '.cursor/commands/pan-decompose.md',
    '.cursor/commands/pan-spotfix.md',
    '.cursor/agents/decomposer.md',
    '.cursor/agents/investigator.md',
    '.cursor/agents/spotfixer.md',
    'library/personas/decomposer.md',
    'library/personas/investigator.md',
    'library/personas/spotfixer.md',
    'library/skills/spotfix.md',
    'governance/policies/DECOMP-001.json',
    'governance/policies/WORK-001.json',
    'governance/policies/SPOT-001.json',
    'src/cli.ts',
  ]

  for (const relative of required) {
    if (!fileExists(path.join(root, relative))) {
      errors.push(`missing required file: ${relative}`)
    }
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

    if (fileExists(path.join(root, 'governance', 'validation_registry.json'))) {
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
        const policies = resolvePolicies(root, {
          persona: stage.persona,
          workflow: workflow.slug,
          stage: stage.slug,
        })

        for (const requirement of HANDBOOK_POLICY_REQUIREMENTS) {
          if (!requirement.personas.has(stage.persona)) {
            continue
          }

          const handbookPolicyIds =
            handbookPolicies.get(requirement.handbook_path) ?? new Set<string>()
          const hasHandbookPolicy = policies.some((policy) =>
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

        if (stage.persona !== 'orchestrator') {
          const agentPath = path.join(
            root,
            '.cursor',
            'agents',
            `${stage.persona}.md`,
          )

          if (!fileExists(agentPath)) {
            errors.push(
              `missing Cursor agent: .cursor/agents/${stage.persona}.md`,
            )
          }
        }
      }
    } catch (error) {
      errors.push(errorMessage(error))
    }
  }

  const cursorAgentPersonas = new Set<string>()
  const cursorAgentDirectory = path.join(root, '.cursor', 'agents')

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
    for (const [configName, config] of Object.entries(
      pipelineConfig.file.configs,
    )) {
      for (const persona of configuredPersonas) {
        if (!config.personas[persona]) {
          errors.push(
            `pipeline config '${configName}' does not map persona '${persona}'`,
          )
        }
      }
    }

    for (const entry of syncCursorAgentModels(root, pipelineConfig)) {
      if (entry.changed) {
        errors.push(
          `${entry.path} model '${entry.previous_model ?? 'missing'}' does not ` +
            `match active pipeline config '${pipelineConfig.name}' model ` +
            `'${entry.model}'; run ${panCommand(root)} models --sync`,
        )
      }
    }
  }

  for (const directory of ['.cursor/agents', '.cursor/commands', 'src/lib']) {
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

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    report_hash: sha256({ errors, warnings }),
  }
}
