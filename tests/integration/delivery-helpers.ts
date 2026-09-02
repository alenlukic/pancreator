import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  decideRun,
  getRunState,
  prepareInvocation,
  setRunStage,
} from '../../src/lib/engine.js'
import { syncCursorProjection } from '../../src/lib/projection.js'
import type {
  Invocation,
  RunState,
  StageDefinition,
  StageOutcome,
  StageOutput,
  WorkflowDefinition,
} from '../../src/lib/types.js'
import { loadWorkflowFile, stageBySlug } from '../../src/lib/workflow.js'
import {
  cloneTree as cloneSharedTree,
  createFixture,
  createRun,
  makeOutput,
  writeCanonicalDelegation,
  writeJson,
  submitAsSupervisor,
} from '../helpers.js'

/** A verify payload whose verdict matches a failed stage. */
export function failingVerify(findingId: string): Record<string, unknown> {
  return {
    verdict: 'fail_remedial',
    findings: [
      {
        id: findingId,
        severity: 'blocker',
        source: 'qa',
        statement: 'The workflow fixture does not advance.',
        evidence: ['fixture'],
      },
    ],
    qa_cases: [
      {
        id: 'TP-01',
        steps: 'Run workflow fixture',
        expected: 'advance',
        actual: 'stalled',
        result: 'fail',
      },
    ],
    acceptance_results: [
      { id: 'AC-01', result: 'fail', evidence: ['fixture'] },
    ],
    remediation_guidance:
      'Rerun the workflow fixture; the run stalls before ship.',
  }
}

/** Prepare, fill, and submit the given stage's output. */
export function submitStageOutput(
  root: string,
  runId: string,
  stage: StageDefinition,
  result: StageOutcome,
  failedCriterionIds: string[] = [],
  mutate?: (output: StageOutput) => void,
) {
  const invocation = prepareInvocation(root, runId).invocation

  assert.ok(invocation)

  const output = makeOutput(root, invocation, stage, result)
  output.result = result

  for (const criterion of output.criteria) {
    criterion.result = failedCriterionIds.includes(criterion.id)
      ? 'fail'
      : 'pass'
  }

  mutate?.(output)

  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)

  return submitAsSupervisor(root, runId, invocation.output.path)
}

/** The workflow definition a run snapshotted at creation. */
export function runWorkflow(root: string, state: RunState): WorkflowDefinition {
  return loadWorkflowFile(root, path.join(root, state.workflow_snapshot.path))
}

/**
 * Prepare, fill, and submit whatever stage the run is at, for any workflow.
 * A claude-code stage leaves the delegation artifact to the harness.
 */
export function submitCurrentStage(
  root: string,
  runId: string,
  result: StageOutcome = 'success',
  failedCriterionIds: string[] = [],
  mutate?: (output: StageOutput) => void,
) {
  const prepared = prepareInvocation(root, runId)
  const invocation = prepared.invocation

  assert.ok(invocation)

  const stage = stageBySlug(
    runWorkflow(root, prepared.state),
    invocation.stage.slug,
  )
  const output = makeOutput(root, invocation, stage, result, prepared.state)

  output.result = result

  for (const criterion of output.criteria) {
    criterion.result = failedCriterionIds.includes(criterion.id)
      ? 'fail'
      : 'pass'
  }

  mutate?.(output)
  writeJson(path.join(root, invocation.output.path), output)

  if (invocation.delegation?.executor !== 'claude-code') {
    writeCanonicalDelegation(root, invocation)
  }

  return {
    invocation,
    ...submitAsSupervisor(root, runId, invocation.output.path),
  }
}

export const CLAUDE_CODE_SPEC =
  'claude-code:claude-opus-5[permission-mode=default,session-resume=true]'

/**
 * Stand-in for the Claude Code CLI. It answers `--version`, treats a
 * positional `-p` prompt as the credential probe, and reads invocations from
 * stdin. CLAUDE_STUB_MODE selects the simulated failure.
 */
const CLAUDE_STUB = `#!/usr/bin/env node
const args = process.argv.slice(2)
const mode = process.env.CLAUDE_STUB_MODE || 'success'

if (args.includes('--version')) {
  console.log('2.1.0 (Claude Code)')
  process.exit(0)
}

const pIndex = args.indexOf('-p')
const positional =
  pIndex !== -1 && args[pIndex + 1] && !args[pIndex + 1].startsWith('--')
    ? args[pIndex + 1]
    : null

if (positional !== null) {
  if (mode === 'auth-failure') {
    console.log(JSON.stringify({
      type: 'result', subtype: 'error', is_error: true,
      result: 'Not authenticated',
    }))
    process.exit(1)
  }
  console.log(JSON.stringify({
    type: 'result', subtype: 'success', is_error: false,
    result: 'pong', session_id: 'stub-probe',
  }))
  process.exit(0)
}

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => { input += chunk })
process.stdin.on('end', () => {
  const resumeIndex = args.indexOf('--resume')
  const resumedFrom = resumeIndex === -1 ? null : args[resumeIndex + 1]

  if (mode === 'nonzero') { process.stderr.write('stub failure\\n'); process.exit(3) }
  if (mode === 'malformed') { console.log('not json at all'); process.exit(0) }
  if (mode === 'resume-fail' && resumedFrom !== null) {
    process.stderr.write('no conversation found\\n')
    process.exit(1)
  }

  const sessionId = resumedFrom !== null
    ? 'resumed-from-' + resumedFrom
    : 'stub-session-' + String(input.length)

  console.log(JSON.stringify({
    type: 'result', subtype: 'success', is_error: false,
    result: 'stage complete', session_id: sessionId,
  }))
})
`

export function claudeStubPath(root: string): string {
  return path.join(root, 'claude-stub.cjs')
}

/**
 * Route the personas to the claude-code executor and install the stub binary.
 * Commits both, so the workspace stays clean for fingerprinting. Returns the
 * stub path for PANCREATOR_CLAUDE_BIN.
 */
export function installClaudeCodeFixture(
  root: string,
  personas: string[],
): string {
  const stubPath = claudeStubPath(root)

  writeFileSync(stubPath, CLAUDE_STUB)
  chmodSync(stubPath, 0o755)

  const configPath = path.join(root, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
    defaults: Record<string, string>
    configs?: Record<string, { personas?: Record<string, string> }>
  }

  // A named entry under `configs` overrides `defaults`, so clear the routing
  // there too. Otherwise the fixture depends on the checked-in `active_config`.
  for (const persona of personas) {
    config.defaults[persona] = CLAUDE_CODE_SPEC

    for (const named of Object.values(config.configs ?? {})) {
      delete named.personas?.[persona]
    }
  }

  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
  syncCursorProjection(root, { write: true })
  execFileSync('git', ['add', 'config.json', 'claude-stub.cjs'], { cwd: root })
  // Amend instead of commit. The ship-stage release validator needs the
  // baseline commit to be the one that introduced the current VERSION.
  execFileSync('git', ['commit', '-q', '--amend', '-m', 'fixture'], {
    cwd: root,
  })

  return stubPath
}

export function withStub<T>(
  stubPath: string,
  mode: string | null,
  body: () => T,
): T {
  const previousBin = process.env.PANCREATOR_CLAUDE_BIN
  const previousMode = process.env.CLAUDE_STUB_MODE

  process.env.PANCREATOR_CLAUDE_BIN = stubPath

  if (mode === null) {
    delete process.env.CLAUDE_STUB_MODE
  } else {
    process.env.CLAUDE_STUB_MODE = mode
  }

  try {
    return body()
  } finally {
    if (previousBin === undefined) {
      delete process.env.PANCREATOR_CLAUDE_BIN
    } else {
      process.env.PANCREATOR_CLAUDE_BIN = previousBin
    }

    if (previousMode === undefined) {
      delete process.env.CLAUDE_STUB_MODE
    } else {
      process.env.CLAUDE_STUB_MODE = previousMode
    }
  }
}

// A fixture root holds the whole run state and no absolute path, so a driven
// run can be cloned. Each variant key owns its own template chain.

type CreateRunOptions = Parameters<typeof createRun>[1]

export interface CheckpointVariant {
  /** Template cache key. Distinct keys never share a template. */
  key: string
  /** Fixture edits applied before createRun (repository-checks.json, config). */
  fixture?: (root: string) => void
  run?: Partial<CreateRunOptions>
  /** How to decide the plan gate. The default is an operator approval. */
  decidePlan?: (root: string, runId: string) => void
}

export interface CheckpointClone {
  root: string
  runId: string
  state: RunState
  invocation: Invocation | null
  workflow: WorkflowDefinition
}

export const BRIEFS: CheckpointVariant = {
  key: 'briefs',
  run: { operatorArtifacts: true },
}

/** A variant whose fixture writes the given repository-check profiles. */
export function checksVariant(
  key: string,
  profiles: Record<string, unknown>,
  run?: Partial<CreateRunOptions>,
): CheckpointVariant {
  return {
    key,
    fixture: (root) =>
      writeJson(path.join(root, 'runtime/repository-checks.json'), {
        schema_version: 1,
        profiles,
      }),
    ...(run ? { run } : {}),
  }
}

interface Family {
  createRun: (root: string, run: Partial<CreateRunOptions>) => RunState
  /** Wrap every drive step. The claude-code family needs its stub on PATH. */
  wrap?: <T>(root: string, body: () => T) => T
}

interface StepDefinition {
  parent: string | null
  drive: (
    root: string,
    runId: string,
    variant: CheckpointVariant | undefined,
  ) => void
}

const CLONE_TIMEOUT_MS = 180_000

const FAMILIES: Record<string, Family> = {
  delivery: {
    createRun: (root, run) =>
      createRun(root, {
        workflowSlug: 'delivery',
        requestPath: 'request.md',
        title: 'Checkpoint fixture run',
        ...run,
      }),
  },
  'delivery[td]': {
    createRun: (root, run) =>
      createRun(root, {
        workflowSlug: 'delivery',
        requestPath: 'request.md',
        title: 'Checkpoint technical-director run',
        involvement: 'technical-director',
        ...run,
      }),
  },
  'delivery[claude-code:planner]': {
    createRun: (root, run) => {
      const stubPath = installClaudeCodeFixture(root, ['planner'])

      return withStub(stubPath, null, () =>
        createRun(root, {
          workflowSlug: 'delivery',
          requestPath: 'request.md',
          ...run,
        }),
      )
    },
    wrap: (root, body) => withStub(claudeStubPath(root), null, body),
  },
  'delivery-candidate': {
    createRun: (root, run) =>
      createRun(root, {
        workflowSlug: 'delivery-candidate',
        requestPath: 'request.md',
        title: 'Checkpoint candidate run',
        ...run,
      }),
  },
  prototype: {
    createRun: (root, run) =>
      createRun(root, {
        workflowSlug: 'prototype',
        requestPath: 'request.md',
        title: 'Checkpoint spike',
        ...run,
      }),
  },
}

function prepare(root: string, runId: string): void {
  assert.ok(prepareInvocation(root, runId).invocation)
}

function submitSuccess(root: string, runId: string): void {
  const submitted = submitCurrentStage(root, runId, 'success')

  assert.equal(
    submitted.record.outcome,
    'success',
    `${submitted.invocation.stage.slug}: ${JSON.stringify(
      submitted.record.evaluation,
    )}`,
  )
}

function approvePlan(
  root: string,
  runId: string,
  variant: CheckpointVariant | undefined,
): void {
  assert.equal(getRunState(root, runId).status, 'awaiting_operator')

  if (variant?.decidePlan) {
    variant.decidePlan(root, runId)
  } else {
    decideRun(root, runId, 'approve', 'fixture approval')
  }
}

const STEPS: Record<string, StepDefinition> = {
  'delivery@created': { parent: null, drive: () => {} },
  'delivery@plan-prepared': { parent: 'delivery@created', drive: prepare },
  'delivery@plan-awaiting-operator': {
    parent: 'delivery@plan-prepared',
    drive: submitSuccess,
  },
  'delivery@implement-prepared': {
    parent: 'delivery@created',
    drive: (root, runId) => {
      setRunStage(root, runId, 'implement', 'Checkpoint: enter implement.')
      prepare(root, runId)
    },
  },
  'delivery@implement-failed-once': {
    parent: 'delivery@implement-prepared',
    drive: (root, runId) => {
      const failed = submitCurrentStage(root, runId, 'failure', [
        'implement.acceptance_claimed',
      ])

      assert.equal(failed.record.outcome, 'failure')
    },
  },
  'delivery@implement-baselined': {
    parent: 'delivery@implement-prepared',
    drive: submitSuccess,
  },
  'delivery@verify-prepared': {
    parent: 'delivery@implement-baselined',
    drive: (root, runId) => {
      assert.equal(getRunState(root, runId).current_stage, 'verify')
      prepare(root, runId)
    },
  },
  'delivery@verify-failed-once': {
    parent: 'delivery@verify-prepared',
    drive: (root, runId) => {
      const failed = submitCurrentStage(
        root,
        runId,
        'failure',
        ['verify.acceptance_met'],
        (output) => {
          output.data.verify = failingVerify('VF-CHECKPOINT-1')
        },
      )

      assert.equal(failed.record.outcome, 'failure')
      assert.equal(failed.state.current_stage, 'remediate')
    },
  },
  'delivery@verify-failed-once-remediated': {
    parent: 'delivery@verify-failed-once',
    drive: submitSuccess,
  },
  'delivery@ship-prepared': {
    parent: 'delivery@created',
    drive: (root, runId) => {
      setRunStage(root, runId, 'ship', 'Checkpoint: enter ship.')
      prepare(root, runId)
    },
  },
  'delivery@ship-awaiting-operator': {
    parent: 'delivery@plan-awaiting-operator',
    drive: (root, runId, variant) => {
      approvePlan(root, runId, variant)
      submitSuccess(root, runId) // implement
      submitSuccess(root, runId) // verify
      submitSuccess(root, runId) // ship
      assert.equal(getRunState(root, runId).status, 'awaiting_operator')
    },
  },
  'delivery[td]@created': { parent: null, drive: () => {} },
  'delivery[td]@plan-submitted': {
    parent: 'delivery[td]@created',
    drive: submitSuccess,
  },
  'delivery[td]@verify-prepared': {
    parent: 'delivery[td]@plan-submitted',
    drive: (root, runId, variant) => {
      approvePlan(root, runId, variant)
      submitSuccess(root, runId) // implement
      prepare(root, runId)
    },
  },
  'delivery[td]@verify-submitted': {
    parent: 'delivery[td]@verify-prepared',
    drive: submitSuccess,
  },
  'delivery[claude-code:planner]@created': { parent: null, drive: () => {} },
  'delivery[claude-code:planner]@plan-prepared': {
    parent: 'delivery[claude-code:planner]@created',
    drive: prepare,
  },
  'delivery[claude-code:planner]@plan-approved': {
    parent: 'delivery[claude-code:planner]@plan-prepared',
    drive: (root, runId, variant) => {
      submitSuccess(root, runId)
      approvePlan(root, runId, variant)
    },
  },
  'delivery-candidate@created': { parent: null, drive: () => {} },
  'delivery-candidate@plan-prepared': {
    parent: 'delivery-candidate@created',
    drive: prepare,
  },
  'delivery-candidate@plan-awaiting-supervisor': {
    parent: 'delivery-candidate@plan-prepared',
    drive: (root, runId) => {
      submitSuccess(root, runId)
      assert.equal(
        getRunState(root, runId).pending_action.type,
        'supervisor_assessment',
      )
    },
  },
  'prototype@created': { parent: null, drive: () => {} },
  'prototype@build-prepared': {
    parent: 'prototype@created',
    drive: (root, runId) => {
      submitSuccess(root, runId) // intake
      decideRun(root, runId, 'approve')
      submitSuccess(root, runId) // approach
      assert.equal(getRunState(root, runId).current_stage, 'build')
      prepare(root, runId)
    },
  },
}

export type Checkpoint =
  | 'delivery@plan-prepared'
  | 'delivery@plan-awaiting-operator'
  | 'delivery@implement-prepared'
  | 'delivery@implement-failed-once'
  | 'delivery@implement-baselined'
  | 'delivery@verify-prepared'
  | 'delivery@verify-failed-once'
  | 'delivery@verify-failed-once-remediated'
  | 'delivery@ship-prepared'
  | 'delivery@ship-awaiting-operator'
  | 'delivery[td]@plan-submitted'
  | 'delivery[td]@verify-prepared'
  | 'delivery[td]@verify-submitted'
  | 'delivery[claude-code:planner]@plan-prepared'
  | 'delivery[claude-code:planner]@plan-approved'
  | 'delivery-candidate@plan-prepared'
  | 'delivery-candidate@plan-awaiting-supervisor'
  | 'prototype@build-prepared'

interface Template {
  root: string
  runId: string
}

const templates = new Map<string, Template>()

function cloneTree(template: string): string {
  const root = mkdtempSync(path.join(tmpdir(), 'pancreator-v2-cp-'))

  cloneSharedTree(template, root, { timeout: CLONE_TIMEOUT_MS })

  return root
}

function familyOf(name: string): Family {
  const family = FAMILIES[name.slice(0, name.indexOf('@'))]

  assert.ok(family, `unknown checkpoint family for ${name}`)

  return family
}

function template(
  name: string,
  variant: CheckpointVariant | undefined,
): Template {
  const key = `${name}|${variant?.key ?? ''}`
  const existing = templates.get(key)

  if (existing) {
    return existing
  }

  const step = STEPS[name]

  assert.ok(step, `unknown checkpoint ${name}`)

  const family = familyOf(name)
  const wrap = family.wrap ?? ((_root, body) => body())
  let built: Template

  if (step.parent === null) {
    const root = createFixture()

    variant?.fixture?.(root)

    const runId = family.createRun(root, variant?.run ?? {}).run_id

    built = { root, runId }
  } else {
    const parent = template(step.parent, variant)
    const root = cloneTree(parent.root)

    wrap(root, () => step.drive(root, parent.runId, variant))
    built = { root, runId: parent.runId }
  }

  templates.set(key, built)

  return built
}

function readClone(root: string, runId: string): CheckpointClone {
  const state = getRunState(root, runId)
  const invocation = state.current_invocation
    ? (JSON.parse(
        readFileSync(
          path.join(root, state.current_invocation.json_path),
          'utf8',
        ),
      ) as Invocation)
    : null

  return { root, runId, state, invocation, workflow: runWorkflow(root, state) }
}

/**
 * A fresh clone of a run driven to the named checkpoint. The first call for a
 * (checkpoint, variant) pair builds the template. Every call returns its own
 * root, so a test can mutate the clone freely.
 */
export function checkpoint(
  name: Checkpoint,
  variant?: CheckpointVariant,
): CheckpointClone {
  const built = template(name, variant)

  return readClone(cloneTree(built.root), built.runId)
}
