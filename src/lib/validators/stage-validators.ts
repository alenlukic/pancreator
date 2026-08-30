import path from 'node:path'
import { readFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

import {
  fileExists,
  isRecord,
  lastEvidenceLine,
  readJson,
  readText,
} from '../io.js'
import { invariant } from '../errors.js'
import { loadRegistry } from '../requirements/registry.js'
import { hasHeading, operatorLeadPresent, parseMarkdown } from '../markdown.js'
import type { HandlerInput, HandlerResult } from '../requirements/types.js'
import { activeOperatorGateWaivers } from '../waivers.js'
import { readProjectConfig } from '../project-config.js'
import { loadRepositoryChecks } from '../repository-checks.js'
import { resolveRunLayout } from '../run-layout.js'
import { resolveTargetInstructionPaths } from '../target-instructions.js'
import {
  gitWorkspaceSnapshot,
  workspaceChangedPathsFromSnapshots,
} from '../git.js'
import type { WorkspaceSnapshot } from '../types.js'
import {
  isReleaseMetadataPath,
  isSemanticVersion,
  nextSemanticVersion,
  validateReleaseMetadata,
  type ReleaseBump,
} from '../versioning.js'

const WORK_MODES = new Set(['systematic', 'lightweight'])
const HARNESS_REPAIR_CLASSIFICATIONS = [
  'harness bug',
  'compliance issue',
  'governance miss',
  'agent execution error',
  'target-repository defect',
  'unresolved hypothesis',
] as const
const GIT_TIMEOUT_MS = 30_000
const GIT_MAX_BUFFER = 1_024 * 1_024

const HARNESS_EVIDENCE_PREFIXES = [
  'runtime/',
  'library/',
  'governance/',
] as const

interface SharedFieldRequirement {
  path: string
  type: string
  enum?: string[]
  required?: string[]
  accepted_shapes?: string[]
}

function sharedFieldRequirements(
  root: string,
  stageSlug: string,
): SharedFieldRequirement[] {
  const sourcePath = path.join(
    root,
    'library',
    'schemas',
    'stage-output-requirements.json',
  )
  // No process.cwd() fallback: in a broken installation it would silently
  // substitute the contract of whatever checkout started the run, and
  // validate the target's outputs against a foreign document.
  invariant(
    fileExists(sourcePath),
    `${sourcePath} is missing. The installation MUST ship the shared stage ` +
      `output contract document.`,
    { code: 'INVALID_STAGE_OUTPUT_REQUIREMENTS' },
  )

  const canonicalSourcePath = sourcePath
  const source = readJson(canonicalSourcePath)

  invariant(
    isRecord(source) && isRecord(source.stages),
    `${canonicalSourcePath} MUST contain a stage map.`,
    { code: 'INVALID_STAGE_OUTPUT_REQUIREMENTS' },
  )

  const stage = source.stages[stageSlug]

  invariant(
    isRecord(stage) && Array.isArray(stage.fields),
    `${canonicalSourcePath}.stages.${stageSlug} MUST declare fields.`,
    { code: 'INVALID_STAGE_OUTPUT_REQUIREMENTS' },
  )

  return stage.fields.filter(
    (field): field is SharedFieldRequirement =>
      isRecord(field) &&
      typeof field.path === 'string' &&
      typeof field.type === 'string' &&
      (field.enum === undefined ||
        (Array.isArray(field.enum) &&
          field.enum.every((entry) => typeof entry === 'string'))) &&
      (field.required === undefined ||
        (Array.isArray(field.required) &&
          field.required.every((entry) => typeof entry === 'string'))) &&
      (field.accepted_shapes === undefined ||
        (Array.isArray(field.accepted_shapes) &&
          field.accepted_shapes.every((entry) => typeof entry === 'string'))),
  )
}

function sharedEnum(
  root: string,
  stageSlug: string,
  fieldPath: string,
): Set<string> {
  const field = sharedFieldRequirements(root, stageSlug).find(
    (candidate) => candidate.path === fieldPath,
  )

  return new Set(field?.enum ?? [])
}

function sharedChildFields(
  root: string,
  stageSlug: string,
  fieldPrefix: string,
): string[] {
  return sharedFieldRequirements(root, stageSlug)
    .map((field) =>
      field.path.startsWith(fieldPrefix)
        ? field.path.slice(fieldPrefix.length)
        : null,
    )
    .filter(
      (field): field is string =>
        field !== null && field.length > 0 && !field.includes('.'),
    )
}

function validEvidenceShape(
  entry: string,
  acceptedShapes: Set<string>,
): boolean {
  const value = entry.trim()
  const pathReference =
    acceptedShapes.has('path_reference') &&
    !/\s/u.test(value) &&
    /(?:^|\/)[^/]+\.[a-z0-9]+(?::\d+(?::\d+)?)?$/iu.test(value)
  const proseObservation =
    acceptedShapes.has('prose_observation') &&
    value.length >= 12 &&
    /\s/u.test(value)
  const pytestNodeId =
    acceptedShapes.has('pytest_node_id') &&
    !/\s/u.test(value) &&
    /^[^:]+::[^:]+(?:::[^:]+)*$/u.test(value)

  return pathReference || proseObservation || pytestNodeId
}

export function validateSharedFieldContract(
  input: HandlerInput,
): HandlerResult {
  const issues: HandlerResult['issues'] = []
  const source = readJson(path.join(input.root, input.targetPath))

  if (
    !isRecord(source) ||
    source.schema_version !== 1 ||
    source.policy_id !== 'CONTRACT-001' ||
    source.validator_id !== 'FIELD-CONTRACT-VALIDATE-001' ||
    !isRecord(source.criterion_results) ||
    !isRecord(source.stages)
  ) {
    return {
      status: 'failed',
      issues: [
        issue(
          'field_contract.shape',
          'The shared field contract MUST declare its schema, policy, validator, and stages',
        ),
      ],
    }
  }

  for (const result of ['unevaluated', 'skipped', 'not_applicable']) {
    const meaning = source.criterion_results[result]

    if (typeof meaning !== 'string' || meaning.trim().length === 0) {
      issues.push(
        issue(
          'field_contract.criterion_result',
          `The shared field contract MUST explain criterion result ${result}`,
        ),
      )
    }
  }

  const registryIds = new Set(loadRegistry(input.root).entries.keys())

  for (const stageSlug of [
    'plan',
    'implement',
    'verify',
    'remediate',
    'ship',
    'approach',
    'build',
    'evaluate',
  ]) {
    const stage = source.stages[stageSlug]

    if (
      !isRecord(stage) ||
      !Array.isArray(stage.validators) ||
      !Array.isArray(stage.fields) ||
      stage.validators.length === 0 ||
      stage.fields.length === 0
    ) {
      issues.push(
        issue(
          'field_contract.stage',
          `The ${stageSlug} field contract MUST declare validators and fields`,
        ),
      )
      continue
    }

    const declaredPaths = new Set(
      stage.fields
        .filter(
          (field): field is Record<string, unknown> =>
            isRecord(field) && typeof field.path === 'string',
        )
        .map((field) => field.path as string),
    )

    for (const validator of stage.validators) {
      if (
        !isRecord(validator) ||
        typeof validator.registry_id !== 'string' ||
        !registryIds.has(validator.registry_id) ||
        (validator.enforcement !== 'blocks' &&
          validator.enforcement !== 'advises')
      ) {
        issues.push(
          issue(
            'field_contract.validator',
            `The ${stageSlug} field contract contains an invalid validator`,
          ),
        )
        continue
      }

      const enforcedFields = Array.isArray(validator.enforced_fields)
        ? validator.enforced_fields.filter(
            (entry): entry is string => typeof entry === 'string',
          )
        : []

      for (const fieldPath of enforcedFields) {
        if (!declaredPaths.has(fieldPath)) {
          issues.push(
            issue(
              'field_contract.enforced_field',
              `Validator ${validator.registry_id} enforces undeclared field ${fieldPath}`,
            ),
          )
        }
      }
    }

    const fields = sharedFieldRequirements(input.root, stageSlug)

    if (fields.length !== stage.fields.length) {
      issues.push(
        issue(
          'field_contract.field',
          `The ${stageSlug} field contract contains an invalid field`,
        ),
      )
    }
  }

  const requiredFieldPaths: Record<string, string[]> = {
    plan: [
      'data.acceptance_criteria[].id',
      'data.acceptance_criteria[].maps_to',
      'data.acceptance_criteria[].verification',
      'data.engineering_plan.files[]',
      'data.test_plan[]',
      'data.open_question_dispositions[].id',
      'data.open_question_dispositions[].answer',
      'data.open_question_dispositions[].disposition',
      'data.open_question_dispositions[].evidence',
      'data.verification_recommendation',
    ],
    implement: ['data.acceptance_results[].evidence[]'],
    verify: [
      'data.verify.verdict',
      'data.verify.findings[].severity',
      'data.verify.findings[].source',
      'data.verify.qa_cases[].steps',
      'data.verify.qa_cases[].expected',
      'data.verify.qa_cases[].actual',
      'data.verify.remediation_guidance',
      'data.verify.severity_rationale',
      'data.verify.blocking_reason',
      'data.verify.missing_evidence_paths',
    ],
    ship: [
      'data.release.change_list[]',
      'data.release.validation[].workspace_fingerprint',
    ],
  }

  for (const [stageSlug, fieldPaths] of Object.entries(requiredFieldPaths)) {
    const available = new Set(
      sharedFieldRequirements(input.root, stageSlug).map((field) => field.path),
    )

    for (const fieldPath of fieldPaths) {
      if (!available.has(fieldPath)) {
        issues.push(
          issue(
            'field_contract.required_field',
            `The ${stageSlug} field contract MUST declare ${fieldPath}`,
          ),
        )
      }
    }
  }

  const releaseChangeList = sharedFieldRequirements(input.root, 'ship').find(
    (field) => field.path === 'data.release.change_list[]',
  )

  if (
    !['path', 'kind', 'description'].every((field) =>
      releaseChangeList?.required?.includes(field),
    )
  ) {
    issues.push(
      issue(
        'field_contract.release_change_list',
        'The ship change list MUST require path, kind, and description',
      ),
    )
  }

  const expectedVerifyEnums: Record<string, string[]> = {
    'data.verify.verdict': [
      'pass',
      'pass_with_warnings',
      'fail_remedial',
      'fail_severe',
    ],
    'data.verify.findings[].severity': ['blocker', 'high', 'medium', 'low'],
    'data.verify.findings[].source': ['review', 'qa'],
  }

  const expectedPrototypeEnums: Record<string, Record<string, string[]>> = {
    approach: {
      'data.technical_approach.preconditions[].status': [
        'ready',
        'unavailable',
        'unknown',
      ],
    },
    build: {
      'data.spike.precondition_checks[].status': [
        'ready',
        'unavailable',
        'unknown',
      ],
    },
    evaluate: {
      'data.evaluation.verdict': [
        'validated',
        'invalidated',
        'inconclusive',
        'environment_blocked',
      ],
      'data.evaluation.question_results[].cause': [
        'product',
        'environment',
        'mixed',
        'none',
      ],
    },
  }

  for (const [stageSlug, fields] of Object.entries(expectedPrototypeEnums)) {
    for (const [fieldPath, expected] of Object.entries(fields)) {
      const actual = sharedEnum(input.root, stageSlug, fieldPath)

      if (
        actual.size !== expected.length ||
        !expected.every((value) => actual.has(value))
      ) {
        issues.push(
          issue(
            'field_contract.prototype_enum',
            `The ${stageSlug} field ${fieldPath} MUST declare its canonical values`,
          ),
        )
      }
    }
  }

  for (const [fieldPath, expected] of Object.entries(expectedVerifyEnums)) {
    const actual = sharedEnum(input.root, 'verify', fieldPath)

    if (
      actual.size !== expected.length ||
      !expected.every((value) => actual.has(value))
    ) {
      issues.push(
        issue(
          'field_contract.verify_enum',
          `The verify field ${fieldPath} MUST declare its canonical values`,
        ),
      )
    }
  }

  const implementationEvidence = sharedFieldRequirements(
    input.root,
    'implement',
  ).find((field) => field.path === 'data.acceptance_results[].evidence[]')
  const evidenceShapes = new Set(implementationEvidence?.accepted_shapes ?? [])

  if (
    !['path_reference', 'prose_observation', 'pytest_node_id'].every((shape) =>
      evidenceShapes.has(shape),
    )
  ) {
    issues.push(
      issue(
        'field_contract.evidence_shapes',
        'Implementation evidence MUST accept path, prose, and pytest shapes',
      ),
    )
  }

  return { status: issues.length === 0 ? 'passed' : 'failed', issues }
}

function evidencePathCandidate(entry: string): string | null {
  const trimmed = entry.trim()
  const explicit = trimmed.match(/^(?:path|file):\s*(.+)$/iu)
  const candidate = (explicit?.[1] ?? trimmed).split('::', 1)[0]?.trim() ?? ''

  if (candidate.length === 0 || /^[a-z][a-z0-9+.-]*:\/\//iu.test(candidate)) {
    return null
  }

  if (explicit || trimmed.includes('::')) {
    return candidate
  }

  if (/\s/u.test(candidate)) {
    return null
  }

  if (
    candidate.startsWith('./') ||
    candidate.startsWith('../') ||
    candidate.startsWith('/') ||
    /(?:^|\/)\.?[a-z0-9_-]+\.[a-z0-9]+$/iu.test(candidate)
  ) {
    return candidate
  }

  return null
}

function workspaceRootFromInput(input: HandlerInput): string {
  if (
    isRecord(input.runState) &&
    typeof input.runState.workspace_root === 'string'
  ) {
    return path.resolve(input.root, input.runState.workspace_root)
  }

  return input.root
}

function isHarnessRelativeEvidencePath(candidate: string): boolean {
  return HARNESS_EVIDENCE_PREFIXES.some(
    (prefix) =>
      candidate === prefix.slice(0, -1) || candidate.startsWith(prefix),
  )
}

function resolveEvidenceFilesystemPath(
  installationRoot: string,
  workspaceRoot: string,
  entry: string,
): string | null {
  const candidate = evidencePathCandidate(entry)

  if (!candidate) {
    return null
  }

  if (path.isAbsolute(candidate)) {
    return candidate
  }

  if (isHarnessRelativeEvidencePath(candidate)) {
    return path.join(installationRoot, candidate)
  }

  return path.join(workspaceRoot, candidate)
}

function resolveWorkspaceRelativeFilePath(
  installationRoot: string,
  workspaceRoot: string,
  relativePath: string,
): string {
  const trimmed = relativePath.trim()

  if (path.isAbsolute(trimmed)) {
    return trimmed
  }

  if (isHarnessRelativeEvidencePath(trimmed)) {
    return path.join(installationRoot, trimmed)
  }

  return path.join(workspaceRoot, trimmed)
}

function missingEvidencePath(
  input: HandlerInput,
  entry: unknown,
): string | null {
  if (typeof entry !== 'string') {
    return null
  }

  const candidate = evidencePathCandidate(entry)

  if (!candidate) {
    return null
  }

  const resolved = resolveEvidenceFilesystemPath(
    input.root,
    workspaceRootFromInput(input),
    entry,
  )

  return resolved && !fileExists(resolved) ? candidate : null
}

type GitCommandResult =
  | { ok: true; stdout: string }
  | { ok: false; error: string }

type GitDiffResult =
  | { ok: true; files: string[] }
  | { ok: false; error: string }

function gitOutput(root: string, gitArgs: string[]): GitCommandResult {
  const result = spawnSync('git', gitArgs, {
    cwd: root,
    encoding: 'utf8',
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
  })

  if (result.error) {
    return { ok: false, error: result.error.message }
  }

  if (result.status !== 0) {
    return {
      ok: false,
      error: (
        result.stderr ||
        result.stdout ||
        `git exited ${result.status}`
      ).trim(),
    }
  }

  return { ok: true, stdout: result.stdout.trim() }
}

function gitChangedFiles(root: string): GitDiffResult {
  const files = new Set<string>()

  const tracked = gitOutput(root, [
    'diff',
    '--name-only',
    'HEAD',
    '--diff-filter=ACMR',
  ])

  if (!tracked.ok) {
    return { ok: false, error: tracked.error }
  }

  for (const file of tracked.stdout.split('\n').filter(Boolean)) {
    files.add(file)
  }

  const untracked = gitOutput(root, [
    'ls-files',
    '--others',
    '--exclude-standard',
  ])

  if (!untracked.ok) {
    return { ok: false, error: untracked.error }
  }

  for (const file of untracked.stdout.split('\n').filter(Boolean)) {
    files.add(file)
  }

  return { ok: true, files: [...files] }
}

export function isSpotfixDiffExempt(file: string): boolean {
  if (file.endsWith('.md') || file.endsWith('.mdc')) {
    return true
  }

  if (file.startsWith('docs/') || file.startsWith('tests/')) {
    return true
  }

  if (path.basename(file).includes('.test.')) {
    return true
  }

  if (file.startsWith('.cursor/')) {
    return true
  }

  return false
}

function isHarnessBookkeepingPath(file: string): boolean {
  return (
    file.startsWith('runtime/') ||
    file.endsWith('/.lock') ||
    file.endsWith('/.operation-mutex') ||
    file.includes('/validations/')
  )
}

function workspaceSourceChanges(root: string): GitDiffResult {
  const diff = gitChangedFiles(root)

  if (!diff.ok) {
    return diff
  }

  return {
    ok: true,
    files: diff.files.filter((file) => !isHarnessBookkeepingPath(file)),
  }
}

/**
 * Paths this attempt changed, measured against the snapshot taken when its own
 * invocation was prepared.
 *
 * `changed_files` describes one attempt's work, so comparing it against the
 * cumulative `git diff HEAD` charged every attempt with the whole run's
 * accumulated diff — including files earlier attempts touched and files the run
 * never touched at all. Returns null when the invocation carries no comparable
 * snapshot, in which case the caller falls back to the cumulative diff.
 */
function attemptChangedPaths(
  input: HandlerInput,
  workspaceRoot: string,
): string[] | null {
  const invocation = input.invocation

  if (!isRecord(invocation) || !isRecord(invocation.workspace_before)) {
    return null
  }

  const before = invocation.workspace_before as unknown as WorkspaceSnapshot

  if (before.kind !== 'git' || !Array.isArray(before.entries)) {
    return null
  }

  try {
    const after = gitWorkspaceSnapshot(workspaceRoot)

    return workspaceChangedPathsFromSnapshots(before, after).filter(
      (file) => !isHarnessBookkeepingPath(file),
    )
  } catch {
    return null
  }
}

interface TestsAddedEntry {
  /** The entry as submitted, for messages. */
  raw: string
  /** File portion of the entry. */
  file: string
  contract?: string
}

/**
 * Parse one `tests_added` entry. A bare string is the legacy `<path>` or
 * `<path>::<case>` form and parses as `{ path }` without a contract. An
 * object carries `path` and an optional `contract`.
 */
function parseTestsAddedEntry(entry: unknown): TestsAddedEntry | null {
  if (typeof entry === 'string') {
    return { raw: entry, file: testFilePortion(entry) }
  }

  if (
    isRecord(entry) &&
    typeof entry.path === 'string' &&
    (entry.contract === undefined || typeof entry.contract === 'string')
  ) {
    return {
      raw: entry.path,
      file: testFilePortion(entry.path),
      ...(typeof entry.contract === 'string'
        ? { contract: entry.contract }
        : {}),
    }
  }

  return null
}

/**
 * An entry names a test file, optionally followed by '::<case name>' in native
 * pytest/Jest notation or the spaced display form ' :: <case>'. Both resolve
 * to the same file: only the file portion resolves against the workspace.
 */
function testFilePortion(entry: string): string {
  return entry.split(/\s*::\s*/u)[0].trim()
}

const TEST_FILE_PATTERN =
  /(?:^|\/)(?:[^/]+\.(?:test|spec)\.[^/]+|test_[^/]+\.py|[^/]+_test\.(?:py|go))$/u

/** JavaScript/TypeScript `test(`/`it(` call sites and Python `def test_`. */
function countTestCallSites(source: string): number {
  const matches = source.match(
    /^[ \t]*(?:(?:test|it)(?:\.\w+)*\s*\(|(?:async\s+)?def\s+test_\w+\s*\()/gmu,
  )

  return matches?.length ?? 0
}

export interface TestDelta {
  path: string
  kind: 'new_file' | 'net_positive'
  count: number
}

/**
 * The attempt's observable test delta: new `*.test.*` files and changed test
 * files whose `test(`/`it(` call-site count rose against `HEAD`. Measured over
 * the paths this attempt changed (the invocation `workspace_before` snapshot),
 * falling back to the cumulative working-tree diff when no snapshot exists.
 * A filesystem workspace or an unavailable Git leaves the delta unobservable
 * and reports nothing; the caller has already failed closed on Git errors.
 */
export function attemptTestDelta(
  input: HandlerInput,
  workspaceRoot: string,
  precomputed: {
    /** This attempt's changed paths, when the caller already snapshotted them. */
    attemptFiles?: string[] | null
    /** The cumulative workspace diff, when the caller already ran it. */
    diff?: ReturnType<typeof workspaceSourceChanges>
  } = {},
): TestDelta[] {
  const workspaceBefore =
    isRecord(input.invocation) && isRecord(input.invocation.workspace_before)
      ? input.invocation.workspace_before
      : null

  if (workspaceBefore?.kind === 'filesystem') {
    return []
  }

  let changed =
    precomputed.attemptFiles !== undefined
      ? precomputed.attemptFiles
      : attemptChangedPaths(input, workspaceRoot)

  if (changed === null) {
    const diff = precomputed.diff ?? workspaceSourceChanges(workspaceRoot)

    if (!diff.ok) {
      return []
    }

    changed = diff.files
  }

  const deltas: TestDelta[] = []

  for (const relativePath of [...new Set(changed)].sort()) {
    if (!TEST_FILE_PATTERN.test(relativePath)) {
      continue
    }

    const absolute = path.join(workspaceRoot, relativePath)

    if (!fileExists(absolute)) {
      continue
    }

    const current = countTestCallSites(readFileSync(absolute, 'utf8'))
    const head = gitOutput(workspaceRoot, ['show', `HEAD:${relativePath}`])

    if (!head.ok) {
      // Not in HEAD: a new file. Zero call sites means no test was added.
      if (current > 0) {
        deltas.push({ path: relativePath, kind: 'new_file', count: current })
      }

      continue
    }

    const net = current - countTestCallSites(head.stdout)

    if (net > 0) {
      deltas.push({ path: relativePath, kind: 'net_positive', count: net })
    }
  }

  return deltas
}

function gitUnavailableIssue(error: string): HandlerResult['issues'][number] {
  return issue(
    'git.unavailable',
    `Git-backed validation failed closed: ${error}`,
  )
}

function issue(code: string, message: string): HandlerResult['issues'][number] {
  return { code, message }
}

function acceptanceCriterionIdsFromPlanOutput(
  root: string,
  planOutputPath: string,
): string[] {
  const absolute = path.join(root, planOutputPath)

  if (!fileExists(absolute)) {
    return []
  }

  const value = readJson(absolute) as Record<string, unknown>
  const data = isRecord(value.data) ? value.data : {}
  const criteria = Array.isArray(data.acceptance_criteria)
    ? data.acceptance_criteria
    : []
  const ids: string[] = []

  for (const item of criteria) {
    if (isRecord(item) && typeof item.id === 'string') {
      ids.push(item.id)
    }
  }

  return [...new Set(ids)].sort()
}

function assessmentVerdictForInvocation(
  root: string,
  runId: string,
  invocationId: string,
): string | null {
  const layout = resolveRunLayout(root, runId)
  const assessmentsDirectory = path.dirname(
    layout.assessment('placeholder').absolute,
  )
  const currentPath = path.join(
    assessmentsDirectory,
    `${invocationId}.assessment.json`,
  )
  const legacyPath = path.join(
    assessmentsDirectory,
    `assessment-${invocationId}.json`,
  )
  const assessmentPath = fileExists(currentPath) ? currentPath : legacyPath

  if (!fileExists(assessmentPath)) {
    return null
  }

  try {
    const value = readJson(assessmentPath)

    return isRecord(value) && typeof value.verdict === 'string'
      ? value.verdict
      : null
  } catch {
    return null
  }
}

function latestPlanOutputPathFromOutputs(
  root: string,
  runId: string,
): string | null {
  const layout = resolveRunLayout(root, runId)
  const outputsDir = path.dirname(layout.output('placeholder').absolute)

  if (!fileExists(outputsDir)) {
    return null
  }

  const planPattern = /^(?:\d{3}_)?plan-(\d+)[-_]/u
  const planFiles = readdirSync(outputsDir)
    .filter((entry) => planPattern.test(entry))
    .sort((left, right) => {
      const leftNumber = Number(planPattern.exec(left)?.[1] ?? 0)
      const rightNumber = Number(planPattern.exec(right)?.[1] ?? 0)

      return leftNumber - rightNumber
    })

  if (planFiles.length === 0) {
    return null
  }

  const latestPlan = planFiles[planFiles.length - 1]

  return layout.output(latestPlan.replace(/\.json$/u, '')).relative
}

function acceptedPlanOutputPath(
  root: string,
  runId: string,
  runState?: Record<string, unknown>,
): string | null {
  const stageHistory = Array.isArray(runState?.stage_history)
    ? runState.stage_history
    : []
  let latestAccepted: string | null = null
  let latestSuccessful: string | null = null

  for (const item of stageHistory) {
    if (
      !isRecord(item) ||
      item.stage !== 'plan' ||
      item.outcome !== 'success' ||
      typeof item.output_path !== 'string'
    ) {
      continue
    }

    if (!fileExists(path.join(root, item.output_path))) {
      continue
    }

    latestSuccessful = item.output_path

    if (typeof item.invocation_id !== 'string') {
      continue
    }

    if (
      assessmentVerdictForInvocation(root, runId, item.invocation_id) === 'pass'
    ) {
      latestAccepted = item.output_path
    }
  }

  if (latestAccepted) {
    return latestAccepted
  }

  if (latestSuccessful) {
    return latestSuccessful
  }

  return latestPlanOutputPathFromOutputs(root, runId)
}

/**
 * The ratified intake product spec, read from the intake stage's own output on
 * disk. The plan validator used to require the plan document to carry a
 * verbatim copy of the spec (~3.4 KB per attempt) purely so this data was in
 * reach; the run record is the single source instead.
 */
function intakeProductSpecFromRun(
  root: string,
  targetPath: string,
  runState?: Record<string, unknown>,
): Record<string, unknown> | null {
  const runMatch = /runtime\/logs\/workflows\/([^/]+)\//u.exec(targetPath)

  if (!runMatch) {
    return null
  }

  const stageHistory = Array.isArray(runState?.stage_history)
    ? runState.stage_history
    : []
  let latest: string | null = null

  for (const item of stageHistory) {
    if (
      isRecord(item) &&
      item.stage === 'intake' &&
      item.outcome === 'success' &&
      typeof item.output_path === 'string' &&
      fileExists(path.join(root, item.output_path))
    ) {
      latest = item.output_path
    }
  }

  if (!latest) {
    const layout = resolveRunLayout(root, runMatch[1])
    const outputsDir = path.dirname(layout.output('placeholder').absolute)

    if (fileExists(outputsDir)) {
      const intakePattern = /^(?:\d{3}_)?intake-(\d+)[-_]/u
      const intakeFiles = readdirSync(outputsDir)
        .filter((entry) => intakePattern.test(entry))
        .sort((left, right) => {
          const leftNumber = Number(intakePattern.exec(left)?.[1] ?? 0)
          const rightNumber = Number(intakePattern.exec(right)?.[1] ?? 0)

          return leftNumber - rightNumber
        })

      if (intakeFiles.length > 0) {
        latest = layout.output(
          intakeFiles[intakeFiles.length - 1].replace(/\.json$/u, ''),
        ).relative
      }
    }
  }

  if (!latest) {
    return null
  }

  try {
    const value = readJson(path.join(root, latest))

    if (
      isRecord(value) &&
      isRecord(value.data) &&
      isRecord(value.data.product_spec)
    ) {
      return value.data.product_spec
    }
  } catch {
    return null
  }

  return null
}

function planAcceptanceCriterionIds(
  root: string,
  targetPath: string,
  runState?: Record<string, unknown>,
): string[] {
  const runMatch = /runtime\/logs\/workflows\/([^/]+)\//u.exec(targetPath)

  if (!runMatch) {
    return []
  }

  const planOutputPath = acceptedPlanOutputPath(root, runMatch[1], runState)

  if (!planOutputPath) {
    return []
  }

  return acceptanceCriterionIdsFromPlanOutput(root, planOutputPath)
}

/** Validate AGENTS.md read evidence against declared and final changed paths. */
export function validateTargetInstructionCoverage(
  input: HandlerInput,
): HandlerResult {
  const issues: HandlerResult['issues'] = []
  const invocationInputs =
    isRecord(input.invocation) && isRecord(input.invocation.inputs)
      ? input.invocation.inputs
      : null
  const targetInstructions =
    invocationInputs && isRecord(invocationInputs.target_instructions)
      ? invocationInputs.target_instructions
      : null

  if (!targetInstructions) {
    return {
      status: 'failed',
      issues: [
        issue(
          'TARGET_INSTRUCTION_COVERAGE_MISSING',
          'The invocation does not declare target instruction paths.',
        ),
      ],
    }
  }

  const declaredChangedPaths = Array.isArray(targetInstructions.changed_paths)
    ? targetInstructions.changed_paths.filter(
        (item): item is string => typeof item === 'string',
      )
    : []
  const invocationReadPaths = Array.isArray(targetInstructions.read_paths)
    ? targetInstructions.read_paths.filter(
        (item): item is string => typeof item === 'string',
      )
    : []
  const workspaceRoot = workspaceRootFromInput(input)
  const output = readJson(path.join(input.root, input.targetPath))
  const outputData =
    isRecord(output) && isRecord(output.data) ? output.data : null
  const implementation =
    outputData && isRecord(outputData.implementation)
      ? outputData.implementation
      : null
  const claimedChangedPaths =
    implementation && Array.isArray(implementation.changed_files)
      ? implementation.changed_files.filter(
          (item): item is string => typeof item === 'string',
        )
      : []
  const diff = workspaceSourceChanges(workspaceRoot)
  const workspaceBefore =
    isRecord(input.invocation) && isRecord(input.invocation.workspace_before)
      ? input.invocation.workspace_before
      : null

  if (!diff.ok && workspaceBefore?.kind !== 'filesystem') {
    issues.push(gitUnavailableIssue(diff.error))
  }

  const finalChangedPaths = [
    ...new Set([
      ...declaredChangedPaths,
      ...claimedChangedPaths,
      ...(diff.ok ? diff.files : []),
    ]),
  ].sort()
  const finalReadPaths = resolveTargetInstructionPaths(
    workspaceRoot,
    finalChangedPaths,
  )
  const requiredReadPaths = [
    ...new Set([...invocationReadPaths, ...finalReadPaths]),
  ].sort()
  const evidence =
    isRecord(output) && isRecord(output.target_instruction_evidence)
      ? output.target_instruction_evidence
      : null
  const readPaths =
    evidence && Array.isArray(evidence.read_paths)
      ? evidence.read_paths.filter(
          (item): item is string => typeof item === 'string',
        )
      : []
  const reads = new Map<string, string>(
    evidence && Array.isArray(evidence.reads)
      ? evidence.reads.flatMap(
          (entry): Array<[string, string]> =>
            isRecord(entry) &&
            typeof entry.path === 'string' &&
            typeof entry.final_line === 'string'
              ? [[entry.path, entry.final_line]]
              : [],
        )
      : [],
  )

  for (const requiredPath of requiredReadPaths) {
    if (!readPaths.includes(requiredPath)) {
      issues.push(
        issue(
          'TARGET_INSTRUCTION_COVERAGE_MISSING',
          `Target instruction evidence omits ${requiredPath}.`,
        ),
      )
      continue
    }

    // A path list alone is copyable from the card; the quoted closing line is
    // what shows the file was opened. It validates against the workspace file
    // because instruction files bind as they exist in the tree being changed.
    const declaredFinalLine = reads.get(requiredPath)

    if (declaredFinalLine === undefined) {
      issues.push(
        issue(
          'TARGET_INSTRUCTION_READ_EVIDENCE_MISSING',
          `Target instruction evidence MUST include reads entry ` +
            `{ path, final_line } quoting the last content line of ` +
            `${requiredPath}.`,
        ),
      )
      continue
    }

    const instructionAbsolute = path.join(workspaceRoot, requiredPath)

    if (!fileExists(instructionAbsolute)) {
      continue
    }

    const expectedFinalLine = lastEvidenceLine(readText(instructionAbsolute))

    if (declaredFinalLine.trim() !== expectedFinalLine.trim()) {
      issues.push(
        issue(
          'TARGET_INSTRUCTION_READ_EVIDENCE_MISMATCH',
          `Target instruction read evidence for ${requiredPath} does not ` +
            `quote the file's last content line (trailing divider lines ` +
            `are skipped).`,
        ),
      )
    }
  }

  return { status: issues.length === 0 ? 'passed' : 'failed', issues }
}

export function validateImplementationClaims(
  input: HandlerInput,
): HandlerResult {
  const issues: HandlerResult['issues'] = []
  const absolute = path.join(input.root, input.targetPath)
  const value = readJson(absolute) as Record<string, unknown>
  const data = isRecord(value.data) ? value.data : {}
  const implementation = isRecord(data.implementation)
    ? data.implementation
    : null

  if (!implementation) {
    return {
      status: 'failed',
      issues: [
        issue('implementation.missing', 'data.implementation is required'),
      ],
    }
  }

  const invocationAttempt =
    typeof input.invocation?.attempt === 'number' ? input.invocation.attempt : 1

  if (invocationAttempt > 1) {
    const remediation = Array.isArray(implementation.remediation)
      ? implementation.remediation
      : []

    if (remediation.length === 0) {
      issues.push(
        issue(
          'implementation.remediation_missing',
          'Retry implementation output MUST explicitly describe remediation for the prior failure or loop cause',
        ),
      )
    }

    for (const [index, item] of remediation.entries()) {
      if (!isRecord(item)) {
        issues.push(
          issue(
            'implementation.remediation_shape',
            `implementation.remediation[${index}] MUST be an object`,
          ),
        )
        continue
      }

      for (const field of ['cause', 'action', 'evidence'] as const) {
        const value = item[field]
        const valid =
          field === 'evidence'
            ? Array.isArray(value) &&
              value.some(
                (entry) => typeof entry === 'string' && entry.trim().length > 0,
              )
            : typeof value === 'string' && value.trim().length > 0

        if (!valid) {
          issues.push(
            issue(
              'implementation.remediation_shape',
              `implementation.remediation[${index}].${field} MUST be ${
                field === 'evidence'
                  ? 'a non-empty string array'
                  : 'a non-empty string'
              }`,
            ),
          )
        }
      }
    }
  }

  const changedFilesRaw = Array.isArray(implementation.changed_files)
    ? (implementation.changed_files as unknown[])
    : []
  const changedFiles = changedFilesRaw.filter(
    (file): file is string => typeof file === 'string',
  )

  // Reject non-string entries explicitly: comparing or joining an object
  // yields '[object Object]' diagnostics, and path.join on one throws.
  for (const entry of changedFilesRaw) {
    if (typeof entry !== 'string') {
      issues.push(
        issue(
          'claim.entry_shape',
          `implementation.changed_files entries MUST be strings; got ${JSON.stringify(entry)}`,
        ),
      )
    }
  }

  const acceptanceResultsList = Array.isArray(data.acceptance_results)
    ? data.acceptance_results
    : []
  const workspaceRoot = workspaceRootFromInput(input)
  const diffResult = workspaceSourceChanges(workspaceRoot)
  // Snapshotted once: the disclosure check and the test-delta check below
  // both read this attempt's changed paths.
  const attemptFiles = attemptChangedPaths(input, workspaceRoot)

  if (!diffResult.ok) {
    if (changedFiles.length > 0) {
      issues.push(gitUnavailableIssue(diffResult.error))
    }
  } else {
    const diffFiles = diffResult.files
    // Disclosure is owed for what this attempt changed. Existence is checked
    // against the cumulative diff, which still catches a fabricated claim.
    const owedDisclosure = attemptFiles ?? diffFiles

    if (diffFiles.length > 0 && changedFiles.length > 0) {
      for (const file of changedFiles) {
        if (!diffFiles.includes(file)) {
          issues.push(
            issue(
              'claim.not_in_diff',
              `Claimed changed file not in workspace diff: ${file}`,
            ),
          )
        }
      }

      for (const file of owedDisclosure) {
        if (!changedFiles.includes(file)) {
          issues.push(
            issue(
              'claim.diff_not_disclosed',
              `File changed by this attempt but not listed in changed_files: ${file}`,
            ),
          )
        }
      }
    } else if (changedFiles.length > 0) {
      for (const file of changedFiles) {
        if (!fileExists(path.join(workspaceRoot, file))) {
          issues.push(
            issue(
              'claim.file_missing',
              `Claimed changed file does not exist: ${file}`,
            ),
          )
        }
      }
    }
  }

  if (acceptanceResultsList.length === 0) {
    issues.push(
      issue('acceptance.missing', 'data.acceptance_results MUST be non-empty'),
    )
  }

  const acceptanceIds = new Set<string>()
  const evidenceRequirement = sharedFieldRequirements(
    input.root,
    'implement',
  ).find((field) => field.path === 'data.acceptance_results[].evidence[]')
  const acceptedEvidenceShapes = new Set(
    evidenceRequirement?.accepted_shapes ?? [],
  )

  for (const [index, item] of acceptanceResultsList.entries()) {
    if (!isRecord(item) || typeof item.id !== 'string') {
      issues.push(
        issue(
          'acceptance.shape',
          `acceptance_results[${index}] MUST have an id`,
        ),
      )
      continue
    }

    if (acceptanceIds.has(item.id)) {
      issues.push(
        issue('acceptance.duplicate', `Duplicate acceptance id: ${item.id}`),
      )
    }

    acceptanceIds.add(item.id)

    if (typeof item.result !== 'string' || item.result.trim().length === 0) {
      issues.push(
        issue(
          'acceptance.result',
          `Acceptance ${item.id} MUST declare a result`,
        ),
      )
    }

    const evidence = Array.isArray(item.evidence) ? item.evidence : []

    if (evidence.length === 0) {
      issues.push(
        issue(
          'acceptance.evidence',
          `Acceptance ${item.id} MUST include evidence`,
        ),
      )
    }

    for (const [evidenceIndex, entry] of evidence.entries()) {
      if (
        typeof entry !== 'string' ||
        !validEvidenceShape(entry, acceptedEvidenceShapes)
      ) {
        issues.push(
          issue(
            'acceptance.evidence_shape',
            `Acceptance ${item.id} evidence[${evidenceIndex}] MUST be a path reference, prose observation, or pytest node id`,
          ),
        )
      }
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
      if (!acceptanceIds.has(id)) {
        issues.push(
          issue(
            'acceptance.coverage',
            `Implementation MUST report acceptance result for ${id}`,
          ),
        )
      }
    }

    for (const id of acceptanceIds) {
      if (!expectedSet.has(id)) {
        issues.push(
          issue(
            'acceptance.unknown',
            `Unknown acceptance id not in plan: ${id}`,
          ),
        )
      }
    }
  }

  const testsAddedRaw = Array.isArray(implementation.tests_added)
    ? (implementation.tests_added as unknown[])
    : []
  const testsAdded: TestsAddedEntry[] = []

  for (const entry of testsAddedRaw) {
    const parsed = parseTestsAddedEntry(entry)

    if (parsed) {
      testsAdded.push(parsed)
    } else {
      issues.push(
        issue(
          'claim.entry_shape',
          `implementation.tests_added entries MUST be '<test file path>' ` +
            `strings or { path, contract } objects; got ${JSON.stringify(entry)}`,
        ),
      )
    }
  }

  for (const entry of testsAdded) {
    const resolved = resolveWorkspaceRelativeFilePath(
      input.root,
      workspaceRoot,
      entry.file,
    )

    if (!fileExists(resolved)) {
      issues.push(
        issue(
          'claim.test_missing',
          `Listed test file does not exist: ${entry.file} (from entry: ` +
            `${entry.raw}). Entries MUST be '<test file path>' optionally ` +
            `followed by '::<test case>', e.g. ` +
            `'tests/unit/example.test.ts::adds provenance rows'.`,
        ),
      )
    }
  }

  // Each new test file and each net-positive test delta needs a contract.
  // A change that adds no tests needs no entry.
  for (const delta of attemptTestDelta(input, workspaceRoot, {
    attemptFiles,
    diff: diffResult,
  })) {
    const covered = testsAdded.some(
      (entry) =>
        entry.file === delta.path &&
        typeof entry.contract === 'string' &&
        entry.contract.trim().length > 0,
    )

    if (covered) {
      continue
    }

    const shape =
      delta.kind === 'new_file'
        ? `is a new test file with ${delta.count} test call site(s)`
        : `gained ${delta.count} net test call site(s)`

    issues.push(
      issue(
        'implementation.tests_added_contract_missing',
        `${delta.path} ${shape}; implementation.tests_added MUST carry ` +
          `{ "path": "${delta.path}", "contract": "<one sentence naming the ` +
          `behavior the test proves>" }.`,
      ),
    )
  }

  return {
    status: issues.length === 0 ? 'passed' : 'failed',
    issues,
  }
}

/**
 * Shape check for the optional worker recommendation to change the run's
 * verification level. Level-name validity is judged at prepare time against
 * the installation's configured levels.
 */
function verificationRecommendationIssues(
  data: Record<string, unknown>,
  stage: string,
): HandlerResult['issues'] {
  const recommendation = data.verification_recommendation

  if (recommendation === undefined) {
    return []
  }

  if (
    !isRecord(recommendation) ||
    typeof recommendation.level !== 'string' ||
    recommendation.level.trim().length === 0 ||
    typeof recommendation.reason !== 'string' ||
    recommendation.reason.trim().length === 0
  ) {
    return [
      issue(
        `${stage}.verification_recommendation`,
        'data.verification_recommendation MUST carry non-empty level and ' +
          'reason strings when present',
      ),
    ]
  }

  return []
}

export function validateIntakeOutput(input: HandlerInput): HandlerResult {
  const issues: HandlerResult['issues'] = []
  const value = readJson(path.join(input.root, input.targetPath)) as Record<
    string,
    unknown
  >
  const data = isRecord(value.data) ? value.data : {}
  const spec = isRecord(data.product_spec) ? data.product_spec : null

  issues.push(...verificationRecommendationIssues(data, 'intake'))

  if (!spec) {
    issues.push(issue('intake.spec_missing', 'data.product_spec is required'))
    return { status: 'failed', issues }
  }

  if (typeof spec.summary !== 'string' || spec.summary.trim().length === 0) {
    issues.push(
      issue('intake.summary', 'product_spec.summary MUST be non-empty'),
    )
  }

  const stories = Array.isArray(spec.user_stories) ? spec.user_stories : []
  const storyIds = new Set<string>()

  for (const [index, story] of stories.entries()) {
    if (!isRecord(story) || typeof story.id !== 'string') {
      issues.push(
        issue(
          'intake.story_id',
          `User story ${index + 1} MUST have a stable id`,
        ),
      )
      continue
    }

    storyIds.add(story.id)

    if (
      typeof story.statement !== 'string' ||
      story.statement.trim().length === 0
    ) {
      issues.push(
        issue(
          'intake.story_statement',
          `User story ${story.id} MUST have an observable statement`,
        ),
      )
    }
  }

  const constraints = Array.isArray(spec.constraints) ? spec.constraints : []

  if (constraints.length === 0) {
    issues.push(
      issue('intake.constraints', 'product_spec.constraints MUST be non-empty'),
    )
  }

  if (!Array.isArray(spec.out_of_scope)) {
    issues.push(
      issue(
        'intake.out_of_scope',
        'product_spec.out_of_scope MUST be an array',
      ),
    )
  }

  if (!Array.isArray(spec.open_questions)) {
    issues.push(
      issue(
        'intake.open_questions',
        'product_spec.open_questions MUST be an array',
      ),
    )
  }

  const artifacts = Array.isArray(value.artifacts) ? value.artifacts : []

  for (const artifact of artifacts) {
    if (!isRecord(artifact) || typeof artifact.path !== 'string') {
      continue
    }

    const artifactPath = path.join(input.root, artifact.path)

    if (!fileExists(artifactPath)) {
      issues.push(
        issue('intake.artifact_missing', `Artifact missing: ${artifact.path}`),
      )
      continue
    }

    const artifactContent = readText(artifactPath)
    let mentionedStories = 0

    for (const id of storyIds) {
      if (artifactContent.includes(id)) {
        mentionedStories += 1
      }
    }

    if (storyIds.size > 0 && mentionedStories === 0) {
      issues.push(
        issue(
          'intake.artifact_json_mismatch',
          `Artifact ${artifact.path} does not reference any user story ids from JSON`,
        ),
      )
    }
  }

  return { status: issues.length === 0 ? 'passed' : 'failed', issues }
}

export function validatePlanTrace(input: HandlerInput): HandlerResult {
  const issues: HandlerResult['issues'] = []
  const value = readJson(path.join(input.root, input.targetPath)) as Record<
    string,
    unknown
  >
  const data = isRecord(value.data) ? value.data : {}
  const criteria = Array.isArray(data.acceptance_criteria)
    ? data.acceptance_criteria
    : []
  const plan = isRecord(data.engineering_plan) ? data.engineering_plan : null
  const referencedStories = new Set<string>()

  // The intake record on disk is authoritative; a spec embedded in the plan
  // document is only a fallback for runs whose intake output is unavailable.
  const productSpec =
    intakeProductSpecFromRun(input.root, input.targetPath, input.runState) ??
    (isRecord(data.product_spec) ? data.product_spec : null)
  const intakeStories = productSpec ? productSpec.user_stories : null
  const storyIds = new Set<string>()

  if (Array.isArray(intakeStories)) {
    for (const story of intakeStories) {
      if (isRecord(story) && typeof story.id === 'string') {
        storyIds.add(story.id)
      }
    }
  }

  for (const [index, item] of criteria.entries()) {
    if (!isRecord(item) || typeof item.id !== 'string') {
      issues.push(
        issue(
          'plan.criterion_id',
          `Acceptance criterion ${index + 1} MUST have an id`,
        ),
      )
      continue
    }

    const verification = isRecord(item.verification) ? item.verification : null

    if (!verification || typeof verification.method !== 'string') {
      issues.push(
        issue(
          'plan.verification_missing',
          `Criterion ${item.id} MUST declare a verification method`,
        ),
      )
    } else if (
      typeof verification.expected !== 'string' ||
      verification.expected.trim().length === 0
    ) {
      issues.push(
        issue(
          'plan.verification_expected',
          `Criterion ${item.id} MUST declare verification.expected`,
        ),
      )
    }

    const mapsTo = Array.isArray(item.maps_to) ? item.maps_to : []

    if (mapsTo.length === 0) {
      issues.push(
        issue(
          'plan.maps_to_missing',
          `Criterion ${item.id} MUST declare maps_to`,
        ),
      )
    }

    for (const mapped of mapsTo) {
      if (typeof mapped === 'string' && mapped.startsWith('US-')) {
        referencedStories.add(mapped)
      } else if (typeof mapped === 'string' && mapped.startsWith('AC-')) {
        if (mapped !== item.id) {
          issues.push(
            issue(
              'plan.maps_to_mismatch',
              `Criterion ${item.id} maps_to includes unrelated acceptance id ${mapped}`,
            ),
          )
        }
      } else if (typeof mapped === 'string' && mapped.includes('-')) {
        const catalog = loadRegistry(input.root)

        if (!catalog.entries.has(mapped)) {
          issues.push(
            issue(
              'plan.maps_to_unknown',
              `Criterion ${item.id} maps_to references unknown registry id ${mapped}`,
            ),
          )
        }
      }
    }
  }

  for (const storyId of storyIds) {
    if (!referencedStories.has(storyId)) {
      issues.push(
        issue(
          'plan.orphan_story',
          `User story ${storyId} is not referenced by any acceptance criterion`,
        ),
      )
    }
  }

  if (
    storyIds.size === 0 &&
    referencedStories.size === 0 &&
    criteria.length > 0
  ) {
    issues.push(
      issue(
        'plan.story_trace_missing',
        'Plan acceptance criteria MUST map to user story ids (US-*)',
      ),
    )
  }

  const files = plan && Array.isArray(plan.files) ? plan.files : []
  // Plan file paths name target-repository files, so they resolve against the
  // workspace root. Resolving them against the installation root fails every
  // path in a detached install, where the two are different directories.
  const workspaceRoot = workspaceRootFromInput(input)

  for (const [index, file] of files.entries()) {
    if (!isRecord(file) || typeof file.path !== 'string') {
      issues.push(
        issue(
          'plan.file_shape',
          `engineering_plan.files[${index}] MUST have path`,
        ),
      )
      continue
    }

    const status = typeof file.status === 'string' ? file.status : ''

    // Absolute and traversal paths are acceptable when that is what the plan
    // declares: any path that resolves on this system is valid, and the
    // existence check below is the only gate. Downstream target-instruction
    // resolution consumes the same paths without rejecting them.
    if (
      status !== 'new' &&
      !fileExists(
        resolveWorkspaceRelativeFilePath(input.root, workspaceRoot, file.path),
      )
    ) {
      issues.push(
        issue(
          'plan.file_missing',
          `Likely file does not exist and is not marked new: ${file.path}`,
        ),
      )
    }
  }

  // ORCH-001: the gate runs each profile once, so a case must not rerun one.
  const testPlan = Array.isArray(data.test_plan) ? data.test_plan : []

  for (const [index, testCase] of testPlan.entries()) {
    if (!isRecord(testCase)) {
      continue
    }

    const caseId =
      typeof testCase.id === 'string' ? testCase.id : `test_plan[${index}]`
    const text = ['setup', 'action', 'command', 'steps']
      .map((field) => testCase[field])
      .filter((entry): entry is string => typeof entry === 'string')
      .join('\n')
    const rerun =
      text.length > 0 ? profileCommandInText(input.root, text) : null

    if (rerun) {
      issues.push(
        issue(
          'plan.case_reruns_profile',
          `Test-plan case ${caseId} runs \`${rerun.command}\`, the ` +
            `\`${rerun.profile}\` profile; the gate runs that profile once, so ` +
            'the case must exercise a focused scenario instead',
        ),
      )
    }
  }

  issues.push(
    ...openQuestionDispositionIssues(input, data, criteria, productSpec),
  )
  issues.push(...verificationRecommendationIssues(data, 'plan'))

  return { status: issues.length === 0 ? 'passed' : 'failed', issues }
}

/** Leading identifier of an inherited open question, e.g. `Q2` in `Q2: ...`. */
const OPEN_QUESTION_ID_PATTERN = /^\s*([A-Za-z]+-?\d+)\s*[:.)]/u

function openQuestionIds(spec: Record<string, unknown> | null): string[] {
  const questions =
    spec && Array.isArray(spec.open_questions) ? spec.open_questions : []
  const ids: string[] = []

  for (const question of questions) {
    if (typeof question !== 'string') {
      continue
    }

    const match = OPEN_QUESTION_ID_PATTERN.exec(question)

    if (match) {
      ids.push(match[1])
    }
  }

  return ids
}

function openQuestionCount(spec: Record<string, unknown> | null): number {
  return spec && Array.isArray(spec.open_questions)
    ? spec.open_questions.length
    : 0
}

/**
 * An open question the plan cannot settle from evidence must be carried forward
 * as deferred or escalated, never answered by assumption and never hardened
 * into an acceptance criterion. Prose appended to the inherited specification
 * text is invisible to every downstream stage, so the disposition record is
 * what makes the unmade decision auditable.
 */
function openQuestionDispositionIssues(
  input: HandlerInput,
  data: Record<string, unknown>,
  criteria: unknown[],
  productSpec: Record<string, unknown> | null,
): HandlerResult['issues'] {
  const issues: HandlerResult['issues'] = []
  const questionCount = openQuestionCount(productSpec)

  if (questionCount === 0) {
    return issues
  }

  const dispositions = Array.isArray(data.open_question_dispositions)
    ? data.open_question_dispositions
    : []

  if (dispositions.length === 0) {
    return [
      issue(
        'plan.disposition_missing',
        'data.open_question_dispositions is required when the ratified ' +
          'specification carries open questions',
      ),
    ]
  }

  const allowed = sharedEnum(
    input.root,
    'plan',
    'data.open_question_dispositions[].disposition',
  )
  const questionIds = openQuestionIds(productSpec)
  const reported = new Set<string>()
  const unsettled = new Set<string>()

  for (const [index, entry] of dispositions.entries()) {
    if (!isRecord(entry) || typeof entry.id !== 'string') {
      issues.push(
        issue(
          'plan.disposition_shape',
          `open_question_dispositions[${index + 1}] MUST name the question id`,
        ),
      )
      continue
    }

    if (reported.has(entry.id)) {
      issues.push(
        issue(
          'plan.disposition_duplicate',
          `Duplicate disposition for question ${entry.id}`,
        ),
      )
    }

    reported.add(entry.id)

    const disposition =
      typeof entry.disposition === 'string' ? entry.disposition : ''

    if (!allowed.has(disposition)) {
      issues.push(
        issue(
          'plan.disposition_value',
          `Disposition for ${entry.id} MUST be one of ${[...allowed].join(', ')}`,
        ),
      )
    }

    if (disposition === 'deferred' || disposition === 'escalated') {
      unsettled.add(entry.id)
    }

    if (typeof entry.answer !== 'string' || entry.answer.trim().length === 0) {
      issues.push(
        issue(
          'plan.disposition_answer',
          `Disposition for ${entry.id} MUST state the answer or the decision ` +
            `still required`,
        ),
      )
    }

    const evidence = Array.isArray(entry.evidence) ? entry.evidence : []
    const validEvidence =
      evidence.length > 0 &&
      evidence.every(
        (item) => typeof item === 'string' && item.trim().length > 0,
      )

    if (disposition === 'resolved' && !validEvidence) {
      issues.push(
        issue(
          'plan.disposition_evidence',
          `Question ${entry.id} resolved by the plan MUST cite non-empty ` +
            `evidence`,
        ),
      )
    }
  }

  for (const id of questionIds) {
    if (!reported.has(id)) {
      issues.push(
        issue(
          'plan.disposition_missing',
          `Open question ${id} MUST have a recorded disposition`,
        ),
      )
    }
  }

  if (questionIds.length > 0) {
    const known = new Set(questionIds)

    for (const id of reported) {
      if (!known.has(id)) {
        issues.push(
          issue(
            'plan.disposition_unknown',
            `Disposition names unknown open question: ${id}`,
          ),
        )
      }
    }
  } else if (dispositions.length < questionCount) {
    // The intake wrote unlabeled questions, so coverage is countable only.
    issues.push(
      issue(
        'plan.disposition_missing',
        `The specification carries ${questionCount} open questions and the ` +
          `plan records ${dispositions.length} dispositions`,
      ),
    )
  }

  // A criterion that cites an unsettled question asserts the answer the plan
  // just said it does not have.
  for (const item of criteria) {
    if (!isRecord(item) || typeof item.id !== 'string') {
      continue
    }

    const mapsTo = Array.isArray(item.maps_to) ? item.maps_to : []

    for (const mapped of mapsTo) {
      if (typeof mapped === 'string' && unsettled.has(mapped)) {
        issues.push(
          issue(
            'plan.criterion_assumes_answer',
            `Criterion ${item.id} maps to ${mapped}, which the plan recorded ` +
              `as unresolved`,
          ),
        )
      }
    }
  }

  return issues
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

  for (const [index, finding] of findings.entries()) {
    if (!isRecord(finding) || typeof finding.id !== 'string') {
      issues.push(
        issue('verify.finding_shape', `Finding ${index + 1} MUST have an id`),
      )
      continue
    }

    const severity =
      typeof finding.severity === 'string' ? finding.severity : ''

    if (!severities.has(severity)) {
      issues.push(
        issue(
          'verify.severity',
          `Finding ${finding.id} MUST use an allowed severity`,
        ),
      )
    }

    const source = typeof finding.source === 'string' ? finding.source : ''

    if (!sources.has(source)) {
      issues.push(
        issue(
          'verify.finding_source',
          `Finding ${finding.id} MUST declare source as review or qa`,
        ),
      )
    }

    if (
      typeof finding.statement !== 'string' ||
      finding.statement.trim().length === 0
    ) {
      issues.push(
        issue(
          'verify.finding_statement',
          `Finding ${finding.id} MUST include a statement`,
        ),
      )
    }

    const evidence = Array.isArray(finding.evidence) ? finding.evidence : []

    if (
      evidence.length === 0 ||
      !evidence.every(
        (entry) => typeof entry === 'string' && entry.trim().length > 0,
      )
    ) {
      issues.push(
        issue(
          'verify.finding_evidence',
          `Finding ${finding.id} MUST include non-empty evidence`,
        ),
      )
    }
  }

  const caseFields = sharedChildFields(
    input.root,
    'verify',
    'data.verify.qa_cases[].',
  )
  const qaCases = Array.isArray(verify.qa_cases) ? verify.qa_cases : []

  if (qaCases.length === 0) {
    issues.push(issue('verify.qa_cases_missing', 'verify.qa_cases is required'))
  }

  for (const [index, qaCase] of qaCases.entries()) {
    if (!isRecord(qaCase) || typeof qaCase.id !== 'string') {
      issues.push(
        issue('verify.case_shape', `QA case ${index + 1} MUST have an id`),
      )
      continue
    }

    for (const field of caseFields) {
      if (
        typeof qaCase[field] !== 'string' ||
        (qaCase[field] as string).trim().length === 0
      ) {
        issues.push(
          issue(
            'verify.case_field',
            `QA case ${qaCase.id} MUST include ${field}`,
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
          `QA case ${qaCase.id} runs \`${rerun.command}\`, the \`${rerun.profile}\` ` +
            'profile; cite the gate evidence for that profile instead',
        ),
      )
    }
  }

  // VERIFY-001: the output must cite every current gate-evidence reference.
  const citations = Array.isArray(verify.gate_evidence_citations)
    ? verify.gate_evidence_citations
    : []
  const citedKeys = new Set<string>()

  for (const [index, citation] of citations.entries()) {
    if (
      !isRecord(citation) ||
      typeof citation.profile !== 'string' ||
      citation.profile.trim().length === 0 ||
      typeof citation.fingerprint !== 'string' ||
      citation.fingerprint.trim().length === 0 ||
      typeof citation.evidence_path !== 'string' ||
      citation.evidence_path.trim().length === 0
    ) {
      issues.push(
        issue(
          'verify.gate_citation_shape',
          `gate_evidence_citations[${index}] MUST carry profile, fingerprint, and evidence_path`,
        ),
      )
      continue
    }

    citedKeys.add(
      `${citation.profile}\u0000${citation.fingerprint}\u0000${citation.evidence_path}`,
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

  for (const [index, item] of acceptanceResults.entries()) {
    if (!isRecord(item) || typeof item.id !== 'string') {
      issues.push(
        issue(
          'verify.acceptance_shape',
          `acceptance_results[${index}] MUST have an id`,
        ),
      )
      continue
    }

    if (reportedIds.has(item.id)) {
      issues.push(
        issue(
          'verify.acceptance_duplicate',
          `Duplicate acceptance id: ${item.id}`,
        ),
      )
    }

    reportedIds.add(item.id)

    if (typeof item.result !== 'string' || item.result.trim().length === 0) {
      issues.push(
        issue(
          'verify.acceptance_result',
          `Acceptance ${item.id} MUST declare a result`,
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

export function validateReleaseOutput(input: HandlerInput): HandlerResult {
  const issues: HandlerResult['issues'] = []
  const value = readJson(path.join(input.root, input.targetPath)) as Record<
    string,
    unknown
  >
  const data = isRecord(value.data) ? value.data : {}
  const release = isRecord(data.release) ? data.release : null

  if (!release) {
    return {
      status: 'failed',
      issues: [issue('release.missing', 'data.release is required')],
    }
  }

  if (readProjectConfig(input.root)?.installation_mode === 'self_development') {
    const versioning = isRecord(release.versioning) ? release.versioning : null

    if (!versioning) {
      issues.push(
        issue(
          'release.versioning_missing',
          'Self-development release output MUST include release.versioning',
        ),
      )
    } else {
      const currentVersion =
        typeof versioning.current_version === 'string'
          ? versioning.current_version
          : ''
      const proposedVersion =
        typeof versioning.proposed_version === 'string'
          ? versioning.proposed_version
          : ''
      const recommendation =
        typeof versioning.recommendation === 'string'
          ? versioning.recommendation
          : ''
      const baselineCommit =
        typeof versioning.baseline_commit === 'string'
          ? versioning.baseline_commit
          : ''
      const rawUpdatedFiles = Array.isArray(versioning.updated_files)
        ? versioning.updated_files
        : []
      const updatedFiles = rawUpdatedFiles.filter(
        (entry): entry is string => typeof entry === 'string',
      )
      const rationale =
        typeof versioning.rationale === 'string'
          ? versioning.rationale.trim()
          : ''
      const compatibility =
        typeof versioning.compatibility === 'string'
          ? versioning.compatibility.trim()
          : ''
      const releaseIndexAction =
        typeof versioning.release_index_action === 'string'
          ? versioning.release_index_action.trim()
          : ''

      if (!isSemanticVersion(currentVersion)) {
        issues.push(
          issue(
            'release.current_version',
            'release.versioning.current_version MUST be complete Semantic Versioning',
          ),
        )
      }

      if (!isSemanticVersion(proposedVersion)) {
        issues.push(
          issue(
            'release.proposed_version',
            'release.versioning.proposed_version MUST be complete Semantic Versioning',
          ),
        )
      }

      if (!['major', 'minor', 'patch'].includes(recommendation)) {
        issues.push(
          issue(
            'release.recommendation',
            'release.versioning.recommendation MUST be major, minor, or patch',
          ),
        )
      } else {
        const expected = nextSemanticVersion(
          currentVersion,
          recommendation as ReleaseBump,
        )

        if (expected !== proposedVersion) {
          issues.push(
            issue(
              'release.proposed_version_mismatch',
              `release.versioning.proposed_version MUST be ${expected ?? 'a valid next version'} for a ${recommendation} bump from ${currentVersion}`,
            ),
          )
        }
      }

      if (!/^[0-9a-f]{40}$/u.test(baselineCommit)) {
        issues.push(
          issue(
            'release.baseline_commit',
            'release.versioning.baseline_commit MUST be a full lowercase Git commit hash',
          ),
        )
      } else {
        const committedVersion = gitOutput(input.root, ['show', 'HEAD:VERSION'])

        if (!committedVersion.ok) {
          issues.push(
            issue(
              'release.committed_version_unavailable',
              `Unable to read the committed VERSION: ${committedVersion.error}`,
            ),
          )
        } else if (committedVersion.stdout.trim() !== currentVersion) {
          issues.push(
            issue(
              'release.current_version_mismatch',
              'release.versioning.current_version MUST equal the committed HEAD:VERSION value',
            ),
          )
        }

        const baselineVersion = gitOutput(input.root, [
          'show',
          `${baselineCommit}:VERSION`,
        ])

        if (
          !baselineVersion.ok ||
          baselineVersion.stdout.trim() !== currentVersion
        ) {
          issues.push(
            issue(
              'release.baseline_version_mismatch',
              'release.versioning.baseline_commit MUST contain current_version in VERSION',
            ),
          )
        }

        const ancestor = gitOutput(input.root, [
          'merge-base',
          '--is-ancestor',
          baselineCommit,
          'HEAD',
        ])

        if (!ancestor.ok) {
          issues.push(
            issue(
              'release.baseline_not_ancestor',
              'release.versioning.baseline_commit MUST be an ancestor of HEAD',
            ),
          )
        }

        const parentVersion = gitOutput(input.root, [
          'show',
          `${baselineCommit}^:VERSION`,
        ])

        if (
          parentVersion.ok &&
          parentVersion.stdout.trim() === currentVersion
        ) {
          issues.push(
            issue(
              'release.baseline_not_bump',
              'release.versioning.baseline_commit MUST be the commit that introduced current_version, not a later commit carrying the same value',
            ),
          )
        }
      }

      if (rationale.length === 0) {
        issues.push(
          issue(
            'release.rationale_missing',
            'release.versioning.rationale MUST explain the selected bump',
          ),
        )
      }

      if (compatibility.length === 0) {
        issues.push(
          issue(
            'release.compatibility_missing',
            'release.versioning.compatibility MUST describe compatibility impact',
          ),
        )
      }

      if (releaseIndexAction.length === 0) {
        issues.push(
          issue(
            'release.index_action_missing',
            'release.versioning.release_index_action MUST describe deferred indexing after the release commit exists',
          ),
        )
      }

      if (rawUpdatedFiles.length !== updatedFiles.length) {
        issues.push(
          issue(
            'release.updated_files_invalid',
            'release.versioning.updated_files MUST contain only path strings',
          ),
        )
      }

      for (const file of updatedFiles) {
        if (!isReleaseMetadataPath(file)) {
          issues.push(
            issue(
              'release.updated_file_out_of_scope',
              `release.versioning.updated_files contains an out-of-scope path: ${file}`,
            ),
          )
        }
      }

      const requiredUpdatedFiles = [
        'CHANGELOG.md',
        'VERSION',
        'docs/embedded-installation.md',
        'package-lock.json',
        'package.json',
      ]

      for (const file of requiredUpdatedFiles) {
        if (!updatedFiles.includes(file)) {
          issues.push(
            issue(
              'release.updated_file_missing',
              `release.versioning.updated_files MUST include ${file}`,
            ),
          )
        }
      }

      const diskVersion = readText(path.join(input.root, 'VERSION')).trim()

      if (diskVersion !== proposedVersion) {
        issues.push(
          issue(
            'release.version_not_applied',
            'VERSION MUST equal release.versioning.proposed_version before ship submission',
          ),
        )
      }

      for (const metadataError of validateReleaseMetadata(input.root).errors) {
        issues.push(issue('release.metadata_invalid', metadataError))
      }
    }
  }

  const rawChangeList = Array.isArray(release.change_list)
    ? release.change_list
    : []
  const changeListRequirement = sharedFieldRequirements(
    input.root,
    'ship',
  ).find((field) => field.path === 'data.release.change_list[]')
  const requiredChangeListFields = changeListRequirement?.required ?? []
  const changeList = rawChangeList
    .map((entry) =>
      isRecord(entry) &&
      requiredChangeListFields.every(
        (field) =>
          typeof entry[field] === 'string' &&
          (entry[field] as string).trim().length > 0,
      )
        ? entry.path
        : null,
    )
    .filter((entry): entry is string => typeof entry === 'string')
  const diffResult = workspaceSourceChanges(workspaceRootFromInput(input))

  if (rawChangeList.length !== changeList.length) {
    const invalid = rawChangeList.find(
      (entry) =>
        !isRecord(entry) ||
        requiredChangeListFields.some(
          (field) =>
            typeof entry[field] !== 'string' ||
            (entry[field] as string).trim().length === 0,
        ),
    )
    issues.push(
      issue(
        'release.change_list_shape',
        `change_list entries MUST be objects with path, kind, and description: ${JSON.stringify(invalid)}`,
      ),
    )
  }

  if (!diffResult.ok) {
    if (changeList.length > 0) {
      issues.push(gitUnavailableIssue(diffResult.error))
    }
  } else {
    const diffFiles = diffResult.files

    if (changeList.length === 0 && diffFiles.length > 0) {
      issues.push(issue('release.change_list', 'change_list MUST be non-empty'))
    }

    for (const file of changeList) {
      if (diffFiles.length > 0 && !diffFiles.includes(file)) {
        issues.push(
          issue(
            'release.change_not_in_diff',
            `change_list file not in workspace diff: ${file}`,
          ),
        )
      }
    }

    for (const file of diffFiles) {
      if (!changeList.includes(file)) {
        issues.push(
          issue(
            'release.diff_not_disclosed',
            `diff file not listed in change_list: ${file}`,
          ),
        )
      }
    }
  }

  const rollback =
    typeof release.rollback_plan === 'string'
      ? release.rollback_plan
      : typeof release.rollback === 'string'
        ? release.rollback
        : ''

  if (rollback.trim().length === 0) {
    issues.push(issue('release.rollback', 'rollback_plan MUST be non-empty'))
  }

  const governanceReview = isRecord(release.governance_artifact_review)
    ? release.governance_artifact_review
    : null
  const runGovernanceIssues = Array.isArray(
    input.runState?.governance_artifact_issues,
  )
    ? input.runState.governance_artifact_issues.filter(isRecord)
    : []

  if (runGovernanceIssues.length > 0) {
    if (!governanceReview) {
      issues.push(
        issue(
          'release.governance_review_missing',
          'release.governance_artifact_review MUST disposition every recorded governance or artifact issue',
        ),
      )
    } else {
      const reviewedIssueIds = new Set(
        Array.isArray(governanceReview.issues_reviewed)
          ? governanceReview.issues_reviewed.filter(
              (item): item is string => typeof item === 'string',
            )
          : [],
      )
      const summary =
        typeof governanceReview.summary === 'string'
          ? governanceReview.summary.trim()
          : ''

      if (summary.length === 0) {
        issues.push(
          issue(
            'release.governance_review_summary',
            'release.governance_artifact_review.summary MUST be non-empty',
          ),
        )
      }

      for (const runIssue of runGovernanceIssues) {
        const issueId =
          typeof runIssue.issue_id === 'string' ? runIssue.issue_id : ''

        if (issueId.length > 0 && !reviewedIssueIds.has(issueId)) {
          issues.push(
            issue(
              'release.governance_issue_undisposed',
              `Recorded governance or artifact issue is not dispositioned: ${issueId}`,
            ),
          )
        }
      }
    }
  }

  const waivers = Array.isArray(release.disclosed_waivers)
    ? release.disclosed_waivers
    : Array.isArray(release.waivers)
      ? release.waivers
      : []
  const followUps = Array.isArray(release.follow_up_cases)
    ? release.follow_up_cases
    : []
  const deferred = Array.isArray(release.deferred_acceptance_criteria)
    ? release.deferred_acceptance_criteria
    : []
  const runWaivers = Array.isArray(input.runState?.operator_gate_waivers)
    ? input.runState.operator_gate_waivers
    : []
  const workspaceBefore = isRecord(input.invocation?.workspace_before)
    ? input.invocation.workspace_before
    : null
  const currentFingerprint =
    workspaceBefore && typeof workspaceBefore.fingerprint === 'string'
      ? workspaceBefore.fingerprint
      : undefined
  const activeRunWaivers = activeOperatorGateWaivers(
    {
      stage_history: input.runState?.stage_history,
      operator_gate_waivers: runWaivers,
      accepted_workspace_fingerprint:
        input.runState?.accepted_workspace_fingerprint,
    },
    currentFingerprint,
  )
  const runDeferred = Array.isArray(
    input.runState?.deferred_acceptance_criteria,
  )
    ? (input.runState.deferred_acceptance_criteria as string[])
    : []
  const stageHistory = Array.isArray(input.runState?.stage_history)
    ? input.runState.stage_history
    : []
  const knownFingerprints = new Set<string>()

  for (const historyItem of stageHistory) {
    if (
      isRecord(historyItem) &&
      typeof historyItem.workspace_fingerprint === 'string'
    ) {
      knownFingerprints.add(historyItem.workspace_fingerprint)
    }
  }

  if (typeof input.runState?.accepted_workspace_fingerprint === 'string') {
    knownFingerprints.add(input.runState.accepted_workspace_fingerprint)
  }

  for (const waiver of runWaivers) {
    if (isRecord(waiver) && typeof waiver.workspace_fingerprint === 'string') {
      knownFingerprints.add(waiver.workspace_fingerprint)
    }
  }

  const validation = Array.isArray(release.validation) ? release.validation : []

  for (const [index, entry] of validation.entries()) {
    if (!isRecord(entry)) {
      issues.push(
        issue(
          'release.validation_shape',
          `validation[${index}] MUST be an object`,
        ),
      )
      continue
    }

    const fingerprint =
      typeof entry.workspace_fingerprint === 'string'
        ? entry.workspace_fingerprint
        : ''

    if (fingerprint.length === 0) {
      issues.push(
        issue(
          'release.validation_fingerprint',
          `validation[${index}] MUST declare workspace_fingerprint`,
        ),
      )
    } else if (!knownFingerprints.has(fingerprint)) {
      issues.push(
        issue(
          'release.validation_fingerprint_unknown',
          `validation fingerprint is not backed by stage history or waivers: ${fingerprint}`,
        ),
      )
    }

    const evidencePath =
      typeof entry.evidence_path === 'string' ? entry.evidence_path : ''

    const missingValidationPath = missingEvidencePath(input, evidencePath)

    if (missingValidationPath) {
      issues.push(
        issue(
          'release.validation_evidence_missing',
          `Validation evidence path does not exist: ${missingValidationPath}`,
        ),
      )
    }
  }

  for (const criterion of runDeferred) {
    if (!deferred.includes(criterion)) {
      issues.push(
        issue(
          'release.deferred_undisclosed',
          `Deferred acceptance criterion not disclosed: ${criterion}`,
        ),
      )
    }
  }

  for (const followUp of followUps) {
    if (!isRecord(followUp) || typeof followUp.id !== 'string') {
      issues.push(
        issue('release.follow_up_shape', 'Each follow_up_case MUST have an id'),
      )
      continue
    }

    const evidence = Array.isArray(followUp.evidence) ? followUp.evidence : []

    if (evidence.length === 0) {
      issues.push(
        issue(
          'release.follow_up_evidence',
          `Follow-up ${followUp.id} MUST include evidence`,
        ),
      )
    }

    for (const entry of evidence) {
      const missingPath = missingEvidencePath(input, entry)

      if (missingPath) {
        issues.push(
          issue(
            'release.evidence_missing',
            `Follow-up evidence path does not exist: ${missingPath}`,
          ),
        )
      }
    }
  }

  for (const waiver of activeRunWaivers) {
    const disclosed = waivers.find(
      (item) => isRecord(item) && item.waiver_id === waiver.waiver_id,
    )

    if (!disclosed) {
      // Distinguish a waiver that is absent from one disclosed under the
      // wrong key or shape: reporting both as "not disclosed" misdiagnoses a
      // re-key defect as an omission (audited follow-up SHIP-FU-001).
      const misdeclared = waivers.find((item) =>
        isRecord(item)
          ? Object.values(item).includes(waiver.waiver_id)
          : item === waiver.waiver_id,
      )

      issues.push(
        issue(
          'release.waiver_undisclosed',
          misdeclared === undefined
            ? `Active waiver not disclosed: ${waiver.waiver_id}`
            : `Waiver ${waiver.waiver_id} is disclosed without a 'waiver_id' ` +
                `key. Re-key this entry, keeping its content: ` +
                `${JSON.stringify(misdeclared)}`,
        ),
      )
      continue
    }

    const runFingerprint =
      typeof waiver.workspace_fingerprint === 'string'
        ? waiver.workspace_fingerprint
        : ''
    const disclosedFingerprint =
      typeof disclosed.workspace_fingerprint === 'string'
        ? disclosed.workspace_fingerprint
        : ''

    if (disclosedFingerprint.length === 0) {
      issues.push(
        issue(
          'release.waiver_fingerprint',
          `Disclosed waiver ${waiver.waiver_id} MUST include workspace_fingerprint`,
        ),
      )
    } else if (disclosedFingerprint !== runFingerprint) {
      issues.push(
        issue(
          'release.waiver_fingerprint_mismatch',
          `Disclosed waiver fingerprint does not match run state for ${waiver.waiver_id}`,
        ),
      )
    }

    for (const evidencePath of [
      typeof waiver.artifact_path === 'string' ? waiver.artifact_path : '',
      typeof waiver.source_evidence_path === 'string'
        ? waiver.source_evidence_path
        : '',
    ]) {
      if (
        evidencePath.length > 0 &&
        !fileExists(path.join(input.root, evidencePath))
      ) {
        issues.push(
          issue(
            'release.waiver_evidence_missing',
            `Waiver evidence path does not exist: ${evidencePath}`,
          ),
        )
      }
    }
  }

  return { status: issues.length === 0 ? 'passed' : 'failed', issues }
}

export function validateDecompositionArtifact(
  input: HandlerInput,
): HandlerResult {
  const issues: HandlerResult['issues'] = []
  const content = readText(path.join(input.root, input.targetPath))
  const parsed = parseMarkdown(content)
  const lower = content.toLowerCase()
  const requiredHeadings = [
    'decision',
    'scope summary',
    'threshold assessment',
    'fragmentation economics',
    'requirement traceability',
    'risks and unknowns',
    'next action',
  ]

  for (const heading of requiredHeadings) {
    if (!hasHeading(parsed, heading)) {
      issues.push(
        issue(
          'decomposition.section_missing',
          `Decomposition MUST include heading: ${heading}`,
        ),
      )
    }
  }

  const decisionSection = /^## Decision\s*\n+([^\n]+)/imu.exec(content)?.[1]
  const normalizedDecision = decisionSection
    ?.replaceAll(/[`*_]/gu, '')
    .replace(/^decision\s*:\s*/iu, '')
    .trim()
    .toLowerCase()

  if (normalizedDecision !== 'retain' && normalizedDecision !== 'decompose') {
    issues.push(
      issue(
        'decomposition.decision',
        'Decision section MUST contain exactly retain or decompose',
      ),
    )
  }

  const thresholdTerms = [
    'independence gate',
    'hard trigger',
    'pressure indicator',
    'file count',
  ]

  for (const term of thresholdTerms) {
    if (!lower.includes(term)) {
      issues.push(
        issue(
          'decomposition.threshold_coverage',
          `Threshold assessment MUST address ${term}`,
        ),
      )
    }
  }

  if (!lower.includes('workflow overhead') || !lower.includes('risk')) {
    issues.push(
      issue(
        'decomposition.economics',
        'Fragmentation economics MUST compare workflow overhead with risk reduction',
      ),
    )
  }

  const chunkPattern = /^## Chunk (\d+):\s+(.+)$/gmu
  const chunkMatches = [...content.matchAll(chunkPattern)]

  if (normalizedDecision === 'retain') {
    if (!hasHeading(parsed, 'retained intake spec')) {
      issues.push(
        issue(
          'decomposition.retained_spec',
          'A retain decision MUST include the retained intake spec',
        ),
      )
    }

    if (chunkMatches.length > 0) {
      issues.push(
        issue(
          'decomposition.retain_chunks',
          'A retain decision MUST NOT include decomposed chunks',
        ),
      )
    }
  }

  if (normalizedDecision === 'decompose') {
    for (const heading of ['dependency graph', 'execution order']) {
      if (!hasHeading(parsed, heading)) {
        issues.push(
          issue(
            'decomposition.section_missing',
            `A decompose decision MUST include heading: ${heading}`,
          ),
        )
      }
    }

    if (chunkMatches.length < 2) {
      issues.push(
        issue(
          'decomposition.chunk_count',
          'A decompose decision MUST contain at least two chunks',
        ),
      )
    }

    if (
      chunkMatches.length > 5 &&
      !hasHeading(parsed, 'more than five chunks justification')
    ) {
      issues.push(
        issue(
          'decomposition.over_fragmented',
          'More than five chunks MUST include an explicit justification',
        ),
      )
    }

    const expectedNumbers = chunkMatches.map((_, index) => index + 1)
    const observedNumbers = chunkMatches.map((match) => Number(match[1]))

    if (
      observedNumbers.some((number, index) => number !== expectedNumbers[index])
    ) {
      issues.push(
        issue(
          'decomposition.chunk_sequence',
          'Chunk headings MUST be numbered sequentially from 1',
        ),
      )
    }

    const requiredChunkSections = [
      'objective',
      'in scope',
      'out of scope',
      'acceptance criteria',
      'dependencies',
      'validation',
      'handoff contract',
    ]

    for (const [index, match] of chunkMatches.entries()) {
      const start = match.index ?? 0
      const end = chunkMatches[index + 1]?.index ?? content.length
      const block = content.slice(start, end)
      const blockParsed = parseMarkdown(block)

      for (const heading of requiredChunkSections) {
        if (!hasHeading(blockParsed, heading)) {
          issues.push(
            issue(
              'decomposition.chunk_section_missing',
              `Chunk ${index + 1} MUST include heading: ${heading}`,
            ),
          )
        }
      }

      const acceptanceHeading = /^### Acceptance criteria\s*$/imu.exec(block)
      let acceptanceSection = ''

      if (acceptanceHeading?.index !== undefined) {
        const remainder = block.slice(
          acceptanceHeading.index + acceptanceHeading[0].length,
        )
        const nextHeading = /^###?\s+/mu.exec(remainder)
        acceptanceSection = remainder.slice(0, nextHeading?.index)
      }

      if (!acceptanceSection || !/^\s*\d+\.\s+\S/mu.test(acceptanceSection)) {
        issues.push(
          issue(
            'decomposition.chunk_acceptance',
            `Chunk ${index + 1} MUST include numbered acceptance criteria`,
          ),
        )
      }
    }

    if (!/\bDAG\b|directed acyclic graph/iu.test(content)) {
      issues.push(
        issue(
          'decomposition.dependency_graph',
          'Dependency graph MUST identify the chunk graph as a DAG',
        ),
      )
    }
  }

  return { status: issues.length === 0 ? 'passed' : 'failed', issues }
}

export function validateHarnessRepairIntake(
  input: HandlerInput,
): HandlerResult {
  const issues: HandlerResult['issues'] = []
  const content = readText(path.join(input.root, input.targetPath))
  const lower = content.toLowerCase()
  const parsed = parseMarkdown(content)
  const requiredHeadings = [
    'original report',
    'investigation scope',
    'evidence examined',
    'agent transcript coverage',
    'execution timeline',
    'findings',
    'root-cause remediation',
    'acceptance criteria',
    'validation plan',
    'installation and migration impact',
    'constraints and out of scope',
    'open questions and unknowns',
    'recommended next action',
  ]

  if (!hasHeading(parsed, 'harness repair intake', 1)) {
    issues.push(
      issue(
        'repair.title',
        'Harness repair intake MUST begin with # Harness repair intake',
      ),
    )
  }

  if (
    !operatorLeadPresent(content) ||
    !lower.slice(0, 700).includes('blocker')
  ) {
    issues.push(
      issue(
        'repair.operator_lead',
        'Harness repair intake MUST lead with State, Outcome, Blockers, and Next action',
      ),
    )
  }

  for (const heading of requiredHeadings) {
    if (!hasHeading(parsed, heading)) {
      issues.push(
        issue(
          'repair.section_missing',
          `Harness repair intake MUST include heading: ${heading}`,
        ),
      )
    }
  }

  const findingMatches = [...content.matchAll(/^#{3,6}\s+(HR-\d{3})\b.*$/gmu)]
  const findingIds = findingMatches.map((match) => match[1])

  if (findingIds.length === 0) {
    issues.push(
      issue(
        'repair.finding_id',
        'Harness repair intake MUST include at least one stable HR-### finding id',
      ),
    )
  } else if (new Set(findingIds).size !== findingIds.length) {
    issues.push(
      issue(
        'repair.finding_id_duplicate',
        'Harness repair finding ids MUST be unique',
      ),
    )
  }

  for (const [index, match] of findingMatches.entries()) {
    const start = match.index ?? 0
    const nextFinding = findingMatches[index + 1]?.index ?? content.length
    const remainder = content.slice(start, nextFinding)
    const nextTopLevelSection = /^##\s+/mu.exec(
      remainder.slice(match[0].length),
    )
    const end = nextTopLevelSection
      ? start + match[0].length + nextTopLevelSection.index
      : nextFinding
    const block = content.slice(start, Math.min(end, nextFinding))
    const blockLower = block.toLowerCase()
    const findingId = match[1]

    if (
      !HARNESS_REPAIR_CLASSIFICATIONS.some((classification) =>
        blockLower.includes(`classification:** ${classification}`),
      )
    ) {
      issues.push(
        issue(
          'repair.classification',
          `${findingId} MUST classify the finding as a harness bug, compliance issue, governance miss, agent execution error, target-repository defect, or unresolved hypothesis`,
        ),
      )
    }

    for (const label of [
      'severity',
      'evidence',
      'expected contract',
      'causal chain',
      'root cause',
      'affected surfaces',
    ]) {
      if (!blockLower.includes(`**${label}:**`)) {
        issues.push(
          issue('repair.finding_field', `${findingId} MUST include ${label}`),
        )
      }
    }
  }

  const acceptanceHeading = /^##\s+Acceptance criteria\s*$/imu.exec(content)
  const acceptanceRemainder = acceptanceHeading
    ? content.slice(acceptanceHeading.index + acceptanceHeading[0].length)
    : ''
  const nextAcceptanceHeading = /^##\s+/mu.exec(acceptanceRemainder)
  const acceptanceSection = acceptanceRemainder.slice(
    0,
    nextAcceptanceHeading?.index,
  )
  const criterionIds = [
    ...acceptanceSection.matchAll(/^\s*\d+\.\s+(AC-\d{3})\b/gmu),
  ].map((match) => match[1])

  if (criterionIds.length === 0) {
    issues.push(
      issue(
        'repair.acceptance_id',
        'Harness repair intake MUST include stable AC-### acceptance criteria',
      ),
    )
  } else if (new Set(criterionIds).size !== criterionIds.length) {
    issues.push(
      issue(
        'repair.acceptance_id_duplicate',
        'Harness repair acceptance criterion ids MUST be unique',
      ),
    )
  }

  if (!/^\s*\d+\.\s+AC-\d{3}\b/gmu.test(acceptanceSection)) {
    issues.push(
      issue(
        'repair.numbered_acceptance',
        'Acceptance criteria MUST be numbered and begin with stable AC-### ids',
      ),
    )
  }

  const transcriptHeading = /^##\s+Agent transcript coverage\s*$/imu.exec(
    content,
  )
  const transcriptRemainder = transcriptHeading
    ? content.slice(transcriptHeading.index + transcriptHeading[0].length)
    : ''
  const nextTranscriptHeading = /^##\s+/mu.exec(transcriptRemainder)
  const transcriptSection = transcriptRemainder.slice(
    0,
    nextTranscriptHeading?.index,
  )
  const transcriptLower = transcriptSection.toLowerCase()
  const transcriptStatusPresent =
    transcriptLower.includes('examined') ||
    transcriptLower.includes('unavailable') ||
    transcriptLower.includes('not applicable')

  if (!transcriptStatusPresent) {
    issues.push(
      issue(
        'repair.transcript_coverage',
        'Agent transcript coverage MUST mark transcript evidence as examined, unavailable, or not applicable',
      ),
    )
  }

  if (
    !transcriptLower.includes('delegation') ||
    !transcriptLower.includes('transcript')
  ) {
    issues.push(
      issue(
        'repair.transcript_distinction',
        'Harness repair intake MUST distinguish delegation evidence from agent transcripts',
      ),
    )
  }

  const nextActionHeading = /^##\s+Recommended next action\s*$/imu.exec(content)
  const nextActionSection = nextActionHeading
    ? content.slice(nextActionHeading.index + nextActionHeading[0].length)
    : ''

  if (!nextActionSection.includes('/pan-start')) {
    issues.push(
      issue(
        'repair.next_action',
        'Recommended next action MUST route the intake through /pan-start',
      ),
    )
  }

  return { status: issues.length === 0 ? 'passed' : 'failed', issues }
}

export function validateInvestigationArtifact(
  input: HandlerInput,
): HandlerResult {
  const issues: HandlerResult['issues'] = []
  const content = readText(path.join(input.root, input.targetPath))
  const parsed = parseMarkdown(content)
  const requiredHeadings = [
    'root cause',
    'acceptance criteria',
    'work mode',
    'next action',
    'work-001',
  ]

  for (const heading of requiredHeadings) {
    if (!hasHeading(parsed, heading)) {
      issues.push(
        issue(
          'investigation.section_missing',
          `Investigation MUST include heading: ${heading}`,
        ),
      )
    }
  }

  const modeLine = content
    .split('\n')
    .find((line) => line.toLowerCase().includes('work mode'))

  if (
    !modeLine ||
    ![...WORK_MODES].some((mode) => modeLine.toLowerCase().includes(mode))
  ) {
    issues.push(
      issue(
        'investigation.work_mode',
        'Investigation MUST declare exactly one work mode (systematic or lightweight)',
      ),
    )
  }

  const criteriaMatches = content.match(/^\s*\d+\.\s+/gmu) ?? []

  if (criteriaMatches.length === 0) {
    issues.push(
      issue(
        'investigation.numbered_criteria',
        'Investigation MUST include numbered acceptance criteria',
      ),
    )
  }

  const work001Section = content.toLowerCase()
  const thresholdChecks = [
    'coherent',
    'acceptance criteria',
    'three implementation files',
    'cross-module',
    'systematic',
  ]
  const thresholdHits = thresholdChecks.filter((item) =>
    work001Section.includes(item),
  ).length

  if (thresholdHits < 3) {
    issues.push(
      issue(
        'investigation.work001_threshold',
        'Investigation MUST evaluate WORK-001 lightweight eligibility thresholds',
      ),
    )
  }

  if (
    content.toLowerCase().includes('uncertain') &&
    !content.toLowerCase().includes('systematic')
  ) {
    issues.push(
      issue(
        'investigation.uncertainty_route',
        'Uncertainty MUST route to systematic work mode',
      ),
    )
  }

  return { status: issues.length === 0 ? 'passed' : 'failed', issues }
}

export function validateSpotfixOutcome(input: HandlerInput): HandlerResult {
  const issues: HandlerResult['issues'] = []
  const content = readText(path.join(input.root, input.targetPath))
  const lower = content.toLowerCase()

  if (lower.includes('status: success') && lower.includes('escalation')) {
    issues.push(
      issue(
        'spotfix.conflict',
        'Spotfix MUST NOT claim success and escalation simultaneously',
      ),
    )
  }

  const cycleMatches = content.match(/cycle\s+\d/giu) ?? []

  if (cycleMatches.length > 3) {
    issues.push(
      issue(
        'spotfix.cycle_limit',
        'Spotfix MUST NOT exceed three validation cycles',
      ),
    )
  }

  if (!/\bnpm run\b|\.\/bin\/pan\b/u.test(content)) {
    issues.push(
      issue(
        'spotfix.validation_command',
        'Spotfix MUST document configured validation command coverage',
      ),
    )
  }

  // Measure the declared workspace, not the installation root: on a detached
  // installation or a worktree run the two are different repositories.
  const diffResult = gitChangedFiles(workspaceRootFromInput(input))

  if (!diffResult.ok) {
    issues.push(gitUnavailableIssue(diffResult.error))
  } else {
    const diffFiles = diffResult.files
      .filter((file) => !file.startsWith('runtime/'))
      .filter((file) => !isSpotfixDiffExempt(file))

    if (diffFiles.length > 3) {
      issues.push(
        issue(
          'spotfix.diff_bounded',
          'Spotfix MUST keep implementation scope within three non-exempt files (WORK-001 exempts documentation, tests, generated projections, and .cursor/ paths)',
        ),
      )
    }
  }

  if (
    lower.includes('escalation') &&
    !hasHeading(parseMarkdown(content), 'escalation')
  ) {
    issues.push(
      issue(
        'spotfix.escalation_content',
        'Escalation MUST include a dedicated escalation heading and rationale',
      ),
    )
  }

  if (lower.includes('escalation')) {
    const requiredEscalationFields = [
      'acceptance criteria',
      'validation cycle',
      'blocker',
    ]
    const missing = requiredEscalationFields.filter(
      (field) => !lower.includes(field),
    )

    if (missing.length > 0) {
      issues.push(
        issue(
          'spotfix.escalation_incomplete',
          `Escalation MUST document: ${missing.join(', ')}`,
        ),
      )
    }
  }

  return { status: issues.length === 0 ? 'passed' : 'failed', issues }
}
