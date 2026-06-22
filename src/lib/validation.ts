import {spawnSync} from 'node:child_process'
import {readdirSync} from 'node:fs'
import path from 'node:path'

import {errorMessage, isNodeError} from './errors.js'
import {
  fileExists,
  isRecord,
  readText,
  resolveInside,
  sha256,
  writeTextAtomic,
} from './io.js'
import {gitWorkspaceSnapshot, snapshotChanged, workspaceDelta} from './git.js'
import {
  loadPolicyCatalog,
  readPolicyLookupTable,
  resolvePolicies,
} from './policies.js'
import {listWorkflowSlugs, loadWorkflow} from './workflow.js'
import type {
  ArtifactReference,
  Criterion,
  CriterionEvaluation,
  DeterministicResult,
  Invocation,
  JsonTypeName,
  RepositoryValidationResult,
  RunState,
  StageDefinition,
  StageOutput,
  StageOutcome,
  WorkspaceSnapshot,
} from './types.js'

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

    return [{path: item.path, description: item.description}]
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

  return {errors, output}
}

function runShellCheck(
  root: string,
  runDirectory: string,
  stage: StageDefinition,
  criterion: Criterion,
  workspaceFingerprint: string,
): DeterministicResult {
  const command = criterion.command ?? ''
  const startedAt = new Date().toISOString()
  const result = spawnSync(command, {
    cwd: root,
    encoding: 'utf8',
    shell: true,
    timeout: criterion.timeout_ms ?? 120_000,
    maxBuffer: 10 * 1024 * 1024,
    env: {...process.env, PAN_WORKFLOW_STAGE: stage.slug},
  })
  const safeCriterionId = criterion.id.replaceAll(/[^a-zA-Z0-9_.-]/g, '-')
  const evidencePath = path.join(
    runDirectory,
    'evidence',
    `${stage.slug}-${safeCriterionId}.log`,
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
    command,
    exit_code: result.status,
    timed_out: isNodeError(result.error) && result.error.code === 'ETIMEDOUT',
    evidence_path: path.relative(root, evidencePath).split(path.sep).join('/'),
    workspace_fingerprint: workspaceFingerprint,
  }
}

function evaluateStateCriterion(
  state: RunState,
  criterion: Criterion,
  workspaceFingerprint: string,
): DeterministicResult {
  let passed = true
  let explanation = 'No specialized state evaluator was required.'

  if (criterion.id === 'ship.prior_gates_current') {
    const review = [...state.stage_history]
      .reverse()
      .find((item) => item.stage === 'review' && item.outcome === 'success')
    const test = [...state.stage_history]
      .reverse()
      .find((item) => item.stage === 'test' && item.outcome === 'success')

    passed = Boolean(
      review && test && test.workspace_fingerprint === workspaceFingerprint,
    )
    explanation = passed
      ? 'Review and QA passed against the current workspace fingerprint.'
      : 'Passing review/QA evidence is missing or stale.'
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

export function evaluateDeterministicCriteria(
  root: string,
  runDirectory: string,
  state: RunState,
  stage: StageDefinition,
  beforeSnapshot: WorkspaceSnapshot,
): {results: DeterministicResult[]; workspace: WorkspaceSnapshot} {
  const afterSnapshot = gitWorkspaceSnapshot(root)
  const results: DeterministicResult[] = []

  if (stage.workspace_policy !== 'source_allowed') {
    const changed = snapshotChanged(beforeSnapshot, afterSnapshot)

    results.push({
      id: 'scope.no_unapproved_changes',
      type: 'state',
      hard: true,
      passed: !changed,
      explanation: changed
        ? 'Workspace changed during a stage that forbids source changes.'
        : 'Workspace fingerprint is unchanged.',
      delta: changed
        ? workspaceDelta(beforeSnapshot, afterSnapshot)
        : {added: [], removed: []},
      workspace_fingerprint: afterSnapshot.fingerprint,
    })
  }

  for (const criterion of stage.criteria) {
    if (criterion.type === 'shell') {
      results.push(
        runShellCheck(
          root,
          runDirectory,
          stage,
          criterion,
          afterSnapshot.fingerprint,
        ),
      )
    } else if (criterion.type === 'state') {
      results.push(
        evaluateStateCriterion(state, criterion, afterSnapshot.fingerprint),
      )
    }
  }

  return {results, workspace: afterSnapshot}
}

function listMarkdownFiles(directory: string): string[] {
  const files: string[] = []

  for (const entry of readdirSync(directory, {withFileTypes: true})) {
    const absolute = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      files.push(...listMarkdownFiles(absolute))
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(absolute)
    }
  }

  return files
}

function validateGovernance(root: string, errors: string[]): void {
  const governanceRoot = path.join(root, 'governance')
  const directivePattern = /\b(?:MUST(?: NOT)?|SHOULD(?: NOT)?|MAY)\b/u

  for (const filePath of listMarkdownFiles(governanceRoot)) {
    const relative = path.relative(root, filePath).split(path.sep).join('/')
    const content = readText(filePath)

    if (!content.includes('RFC 2119')) {
      errors.push(`${relative} MUST declare RFC 2119 directive semantics`)
    }
  }

  for (const policy of loadPolicyCatalog(root).values()) {
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
}

export function validateRepository(root: string): RepositoryValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  const required = [
    'AGENTS.md',
    'package.json',
    'prettier.config.js',
    'tsconfig.json',
    'governance/policy_lookup_table.json',
    'governance/handbooks/typescript/style-guide.md',
    'library/schemas/stage-output.schema.json',
    'library/schemas/workflow.schema.json',
    'library/schemas/stage.schema.json',
    '.cursor/commands/pan-start.md',
    '.cursor/commands/pan-resume.md',
    'src/cli.ts',
  ]

  for (const relative of required) {
    if (!fileExists(path.join(root, relative))) {
      errors.push(`missing required file: ${relative}`)
    }
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

    validateGovernance(root, errors)
  } catch (error) {
    errors.push(errorMessage(error))
  }

  for (const slug of listWorkflowSlugs(root)) {
    try {
      const workflow = loadWorkflow(root, slug)

      for (const stage of workflow.stages) {
        resolvePolicies(root, {
          persona: stage.persona,
          workflow: workflow.slug,
          stage: stage.slug,
        })

        const personaPath = path.join(
          root,
          'library',
          'personas',
          `${stage.persona}.md`,
        )

        if (!fileExists(personaPath)) {
          errors.push(`missing persona: library/personas/${stage.persona}.md`)
        }
      }
    } catch (error) {
      errors.push(errorMessage(error))
    }
  }

  for (const directory of ['.cursor/agents', '.cursor/commands', 'src/lib']) {
    const absolute = path.join(root, directory)

    if (fileExists(absolute) && readdirSync(absolute).length === 0) {
      warnings.push(`${directory} is empty`)
    }
  }

  const legacyModules = [
    ...readdirSync(path.join(root, 'src'), {recursive: true}),
    ...readdirSync(path.join(root, 'tests'), {recursive: true}),
  ].filter((entry) => typeof entry === 'string' && entry.endsWith('.mjs'))

  if (legacyModules.length > 0) {
    errors.push('src/ and tests/ MUST NOT contain legacy .mjs modules')
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    fingerprint: sha256({errors, warnings}),
  }
}
