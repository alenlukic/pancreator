import assert from 'node:assert/strict'
import { readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  resolveSubmitValidators,
  validateOutputForSubmission,
} from '../../src/lib/engine.js'
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

test('pan output validate reports a changed-files omission the way submit rejects it', () => {
  const { root, runId, invocation, workflow } = checkpoint(
    'delivery@implement-prepared',
  )

  assert.ok(invocation)

  writeFileSync(path.join(root, 'src/base.ts'), 'export const base = false\n')
  writeFileSync(path.join(root, 'src/extra.ts'), 'export const extra = 1\n')

  const output = makeOutput(
    root,
    invocation,
    stageBySlug(workflow, 'implement'),
  )
  const implementation = output.data.implementation as Record<string, unknown>

  implementation.changed_files = ['src/base.ts']
  attachTargetInstructionEvidence(root, output, ['AGENTS.md'])
  writeJson(path.join(root, invocation.output.path), output)

  const mirror = validateOutputForSubmission(root, runId, invocation, output)
  const claims = mirror.checks.find(
    (check) => check.id === 'validator.IMPLEMENTATION-CLAIMS-VALIDATE-001',
  )

  assert.equal(mirror.passed, false)
  assert.ok(claims)
  assert.equal(claims.passed, false)
  assert.match(claims.message, /not listed in changed_files: src\/extra\.ts/u)
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
