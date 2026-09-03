import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  prepareInvocation,
  resolveSubmitValidators,
  submitOutput,
  validateOutputForSubmission,
} from '../../src/lib/engine.js'
import { PanError } from '../../src/lib/errors.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import { loadState } from '../../src/lib/state.js'
import { stageBySlug } from '../../src/lib/workflow.js'
import { checkpoint } from '../integration/delivery-helpers.js'
import {
  attachTargetInstructionEvidence,
  makeOutput,
  read,
  submitAsSupervisor,
  writeCanonicalDelegation,
  writeJson,
} from '../helpers.js'

const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')

/** Registry ids of the harness validation records a run persisted. */
function persistedHarnessValidatorIds(root: string, runId: string): string[] {
  const directory = resolveRunLayout(root, runId).validation('.').absolute
  const ids = new Set<string>()

  for (const name of readdirSync(directory)) {
    if (!name.endsWith('.json')) {
      continue
    }

    const record = read(path.join(directory, name)) as Record<string, unknown>

    if (
      record.executor === 'harness' &&
      typeof record.registry_id === 'string'
    ) {
      ids.add(record.registry_id)
    }
  }

  return [...ids].sort()
}

test('pan output validate and pan submit resolve the same validator set for one invocation', () => {
  const { root, runId, invocation, workflow } = checkpoint(
    'delivery@implement-prepared',
  )

  assert.ok(invocation)

  const implementStage = stageBySlug(workflow, 'implement')
  const output = makeOutput(root, invocation, implementStage)

  attachTargetInstructionEvidence(root, output, ['AGENTS.md'])
  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)

  const resolvedIds = resolveSubmitValidators(
    root,
    invocation,
    output as unknown as Record<string, unknown>,
  )
    .map((item) => item.requirement.registry_id)
    .sort()

  // The claims validator is the one run 63311 lost an attempt to.
  assert.ok(resolvedIds.includes('IMPLEMENTATION-CLAIMS-VALIDATE-001'))

  // `pan output validate` runs exactly the resolved set, one check per id.
  const mirror = validateOutputForSubmission(root, runId, invocation, output)
  const mirroredIds = mirror.checks
    .filter((check) => check.id.startsWith('validator.'))
    .map((check) => check.id.slice('validator.'.length))
    .sort()

  assert.deepEqual(mirroredIds, resolvedIds)
  assert.equal(mirror.passed, true, JSON.stringify(mirror.checks))

  // The mirror persists nothing; the submission persists every resolved id.
  const layout = resolveRunLayout(root, runId)
  const before = persistedHarnessValidatorIds(root, runId)

  for (const id of resolvedIds) {
    assert.ok(
      !before.includes(id),
      `${id} was persisted before submit under ${layout.validation('.').relative}`,
    )
  }

  const submitted = submitAsSupervisor(root, runId, invocation.output.path)
  const after = persistedHarnessValidatorIds(root, runId)

  assert.equal(submitted.record.outcome, 'success')

  for (const id of resolvedIds) {
    assert.ok(after.includes(id), `${id} has no submit validation record`)
  }

  assert.equal(loadState(root, runId).stage_history.length, 1)
})

test('pan output validate --file judges the named file, not a stale copy at the declared output path', () => {
  const { root, runId, invocation, workflow } = checkpoint(
    'delivery@implement-prepared',
  )

  assert.ok(invocation)

  writeFileSync(path.join(root, 'src/base.ts'), 'export const base = false\n')
  writeFileSync(path.join(root, 'src/extra.ts'), 'export const extra = 1\n')

  const stage = stageBySlug(workflow, 'implement')
  const valid = makeOutput(root, invocation, stage)
  const validImplementation = valid.data.implementation as Record<
    string,
    unknown
  >

  validImplementation.changed_files = ['src/base.ts', 'src/extra.ts']
  attachTargetInstructionEvidence(root, valid, ['AGENTS.md'])
  // A valid output already sits at the declared path.
  writeJson(path.join(root, invocation.output.path), valid)

  const invalid = makeOutput(root, invocation, stage)
  const invalidImplementation = invalid.data.implementation as Record<
    string,
    unknown
  >

  invalidImplementation.changed_files = ['src/base.ts']
  attachTargetInstructionEvidence(root, invalid, ['AGENTS.md'])

  const submittedPath = 'runtime/inbox/draft-output.json'

  writeJson(path.join(root, submittedPath), invalid)

  const mirror = validateOutputForSubmission(root, runId, invocation, invalid, {
    submittedPath,
  })
  const claims = mirror.checks.find(
    (check) => check.id === 'validator.IMPLEMENTATION-CLAIMS-VALIDATE-001',
  )

  assert.equal(mirror.passed, false)
  assert.ok(claims)
  assert.match(claims.message, /not listed in changed_files: src\/extra\.ts/u)
})

test('full and revision outputs validate the same effective document', () => {
  const {
    root,
    runId,
    state: failedState,
    workflow,
  } = checkpoint('delivery@implement-failed-once')
  const prior = failedState.stage_history[0]
  const prepared = prepareInvocation(root, runId)
  const invocation = prepared.invocation

  assert.ok(invocation)
  assert.ok(invocation.requirements)

  const output = makeOutput(
    root,
    invocation,
    stageBySlug(workflow, 'implement'),
  )
  const implementation = output.data.implementation as Record<string, unknown>

  implementation.remediation = [
    {
      cause: 'The first output reported failure.',
      action: 'The retry supplies complete evidence.',
      evidence: ['request.md'],
    },
  ]
  output.artifacts = [
    {
      path: 'request.md',
      description: 'Artifact target fixture.',
    },
  ]
  attachTargetInstructionEvidence(root, output, ['AGENTS.md'])

  invocation.requirements.validation_requirements.push({
    policy_id: 'STE-001',
    requirement_id: 'revision-artifact-parity',
    registry_id: 'SIMPLIFIED-ENGLISH-VALIDATE-001',
    registry_version: '1',
    kind: 'validator',
    phase: 'pre_submit',
    executor: 'agent',
    target: 'artifact:0',
    arguments: {},
    enforcement: 'required',
    failure_route: 'retry',
    evidence_class: 'validation-result',
    success_condition: 'The artifact passes simplified English validation.',
  })

  const invocationPath = resolveRunLayout(root, runId).invocation(
    invocation.invocation_id,
    '.json',
  ).relative
  writeJson(path.join(root, invocationPath), invocation)

  const fullPath = 'runtime/inbox/full-output.json'
  writeJson(path.join(root, fullPath), output)

  const revision = {
    revises: prior.invocation_id,
    patch: output,
  }
  const revisionPath = 'runtime/inbox/revision-output.json'

  writeJson(path.join(root, revisionPath), revision)

  const validate = (submittedPath: string) => {
    const stdout = execFileSync(
      process.execPath,
      [
        CLI,
        'output',
        'validate',
        runId,
        '--file',
        submittedPath,
        '--invocation',
        invocationPath,
        '--json',
      ],
      { cwd: root, encoding: 'utf8' },
    )

    return JSON.parse(stdout) as {
      passed: boolean
      submission_checks: Array<{
        id: string
        passed: boolean
        message: string
      }>
      results: Array<{
        requirement: { registry_id: string }
        result: { status: string; target_path: string }
      }>
    }
  }

  const full = validate(fullPath)
  const revised = validate(revisionPath)

  assert.equal(full.passed, true)
  assert.equal(revised.passed, true)
  assert.deepEqual(revised.submission_checks, full.submission_checks)
  assert.equal(full.results.length, 1)
  assert.equal(revised.results.length, 1)
  assert.equal(full.results[0]?.result.target_path, 'request.md')
  assert.equal(revised.results[0]?.result.target_path, 'request.md')

  writeJson(path.join(root, invocation.output.path), revision)
  writeCanonicalDelegation(root, invocation)

  const submitted = submitAsSupervisor(root, runId, invocation.output.path)

  assert.equal(submitted.record.outcome, 'success')
})

test('invalid revision envelopes fail before structural validation', () => {
  const cases = [
    {
      name: 'non-object patch',
      revision: (prior: string, current: string) => ({
        revises: prior,
        patch: 'invalid',
        invocation_id: current,
      }),
    },
    {
      name: 'missing base attempt',
      revision: (_prior: string, current: string) => ({
        revises: 'implement-1-missing',
        patch: { invocation_id: current },
      }),
    },
    {
      name: 'wrong current invocation',
      revision: (prior: string) => ({
        revises: prior,
        patch: { invocation_id: 'implement-2-wrong' },
      }),
    },
  ]

  for (const item of cases) {
    const {
      root,
      runId,
      state: failedState,
    } = checkpoint('delivery@implement-failed-once')
    const prior = failedState.stage_history[0]
    const prepared = prepareInvocation(root, runId)
    const invocation = prepared.invocation

    assert.ok(invocation)

    const revision = item.revision(
      prior.invocation_id,
      invocation.invocation_id,
    )
    const outputPath = path.join(root, invocation.output.path)

    writeJson(outputPath, revision)

    for (const operation of [
      () =>
        validateOutputForSubmission(root, runId, invocation, revision, {
          submittedPath: invocation.output.path,
        }),
      () => submitOutput(root, runId, invocation.output.path),
    ]) {
      assert.throws(
        operation,
        (error: unknown) =>
          error instanceof PanError && error.code === 'INVALID_REVISION',
        item.name,
      )
    }
  }
})
