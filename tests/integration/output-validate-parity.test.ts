import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  materializeOutputSubmission,
  outputValidateScratchPath,
  prepareInvocation,
  resolveSubmitValidators,
  submitOutput,
  validateOutputForSubmission,
} from '../../src/lib/engine.js'
import { preSubmitRequirements } from '../../src/cli.js'
import { PanError } from '../../src/lib/errors.js'
import { HANDLERS } from '../../src/lib/requirements/handlers.js'
import { loadRegistry } from '../../src/lib/requirements/registry.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import { loadState } from '../../src/lib/state.js'
import { stageBySlug } from '../../src/lib/workflow.js'
import { checkpoint } from '../integration/delivery-helpers.js'
import {
  attachTargetInstructionEvidence,
  makeOutput,
  read,
  writeCanonicalDelegation,
  writeJson,
} from '../helpers.js'
import { submitAsSupervisor } from '../run-helpers.js'

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

test('the two output-validate callers work in separate scratch directories', () => {
  const {
    root,
    runId,
    state: failedState,
  } = checkpoint('delivery@implement-failed-once')
  const prior = failedState.stage_history[0]
  const invocation = prepareInvocation(root, runId).invocation

  assert.ok(invocation)

  const revision = {
    revises: prior.invocation_id,
    patch: { invocation_id: invocation.invocation_id },
  }
  const callerScratch = outputValidateScratchPath(
    runId,
    invocation.output.path,
    'output-validate',
  )
  const mirrorScratch = outputValidateScratchPath(
    runId,
    invocation.output.path,
    'submission-mirror',
  )

  // Both callers derive their path from one helper, and the helper is what
  // keeps them apart: each removes its own directory when it is done.
  assert.notEqual(path.dirname(callerScratch), path.dirname(mirrorScratch))

  // `pan output validate --file` on a revision resolves the envelope into its
  // own copy and hands that path to the submission mirror.
  const materialized = materializeOutputSubmission(
    root,
    loadState(root, runId),
    revision,
    invocation.invocation_id,
  )
  const callerAbsolute = path.join(root, callerScratch)

  writeJson(callerAbsolute, materialized.value)

  const callerBytes = readFileSync(callerAbsolute, 'utf8')
  const mirror = validateOutputForSubmission(
    root,
    runId,
    invocation,
    revision,
    {
      submittedPath: callerScratch,
    },
  )

  assert.ok(mirror.checks.some((check) => check.id.startsWith('validator.')))
  assert.equal(existsSync(path.join(root, mirrorScratch)), false)
  assert.equal(existsSync(callerAbsolute), true)
  assert.equal(readFileSync(callerAbsolute, 'utf8'), callerBytes)
})

test('a validator handler that throws leaves no scratch copy behind', () => {
  const { root, runId, invocation, workflow } = checkpoint(
    'delivery@implement-prepared',
  )

  assert.ok(invocation)

  // No file at the declared path and no submitted path: the mirror judges the
  // in-memory value through a scratch copy.
  const output = makeOutput(
    root,
    invocation,
    stageBySlug(workflow, 'implement'),
  )
  const scratch = path.join(
    root,
    outputValidateScratchPath(
      runId,
      invocation.output.path,
      'submission-mirror',
    ),
  )
  const entry = loadRegistry(root).entries.get(
    'IMPLEMENTATION-CLAIMS-VALIDATE-001',
  )

  assert.ok(entry)

  const original = HANDLERS[entry.handler]

  assert.ok(original)

  let scratchSeenByHandler = false

  HANDLERS[entry.handler] = () => {
    scratchSeenByHandler = existsSync(scratch)
    throw new Error('handler exploded')
  }

  try {
    assert.throws(
      () => validateOutputForSubmission(root, runId, invocation, output),
      /handler exploded/u,
    )
  } finally {
    HANDLERS[entry.handler] = original
  }

  assert.equal(scratchSeenByHandler, true)
  assert.equal(existsSync(scratch), false)
  assert.equal(existsSync(path.dirname(scratch)), false)
})

test('invalid revision envelopes fail before structural validation', () => {
  const {
    root,
    runId,
    state: failedState,
  } = checkpoint('delivery@implement-failed-once')
  const prior = failedState.stage_history[0]
  const prepared = prepareInvocation(root, runId)
  const invocation = prepared.invocation

  const invalidRevisions: unknown[] = []

  assert.ok(invocation)

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
    {
      // The expectation used to be derived from the submitted value when the
      // caller supplied none, so a patch naming the superseded attempt
      // satisfied a parity check against itself.
      name: 'patch names the superseded invocation',
      revision: (prior: string) => ({
        revises: prior,
        patch: { invocation_id: prior },
      }),
    },
  ]

  for (const item of cases) {
    const revision = item.revision(
      prior.invocation_id,
      invocation.invocation_id,
    )

    invalidRevisions.push(revision)

    assert.throws(
      () =>
        materializeOutputSubmission(
          root,
          failedState,
          revision,
          invocation.invocation_id,
        ),
      (error: unknown) =>
        error instanceof PanError && error.code === 'INVALID_REVISION',
      item.name,
    )
  }

  writeJson(path.join(root, invocation.output.path), invalidRevisions[0])
  assert.throws(
    () => submitOutput(root, runId, invocation.output.path),
    (error: unknown) =>
      error instanceof PanError && error.code === 'INVALID_REVISION',
  )
})

// AC-015. Selection by executor kept the claims validator — a harness-executor
// entry that is both deterministic and side-effect free — out of the pre-submit
// set by construction, so the one command that exists to catch a claim defect
// before it costs an attempt could never run the check that catches it.
test('the pre-submit set is chosen by side-effect freedom, not by executor', () => {
  const { root, invocation } = checkpoint('delivery@implement-prepared')

  assert.ok(invocation)

  const catalog = loadRegistry(root)
  const selected = preSubmitRequirements(root, invocation)

  assert.ok(
    selected.some(
      (item) => item.registry_id === 'IMPLEMENTATION-CLAIMS-VALIDATE-001',
    ),
    selected.map((item) => item.registry_id).join(', '),
  )

  for (const item of selected) {
    const entry = catalog.entries.get(item.registry_id)

    assert.equal(entry?.deterministic, true, item.registry_id)
    assert.equal(entry?.side_effect_free, true, item.registry_id)
  }

  // Nothing in the phase was dropped for its executor alone: every eligible
  // requirement the registry declares safe is present.
  const eligible = [
    ...(invocation.requirements?.validation_requirements ?? []),
    ...(invocation.requirements?.automation_requirements ?? []),
  ].filter((item) => {
    const entry = catalog.entries.get(item.registry_id)

    return (
      (item.phase === 'pre_submit' || item.phase === 'before_operation') &&
      item.enforcement !== 'advisory' &&
      entry?.deterministic === true &&
      entry.side_effect_free === true
    )
  })

  assert.deepEqual(
    selected.map((item) => item.requirement_id).sort(),
    eligible.map((item) => item.requirement_id).sort(),
  )
})

// AC-016. A claim defect costs seconds to report and a suite costs minutes, so
// the order is the whole value: the gates must not run first.
test('claim validation decides the submission before any repository-check gate runs', () => {
  const { root, runId, invocation, workflow } = checkpoint(
    'delivery@implement-prepared',
  )

  assert.ok(invocation)

  const output = makeOutput(
    root,
    invocation,
    stageBySlug(workflow, 'implement'),
  )

  attachTargetInstructionEvidence(root, output, ['AGENTS.md'])
  output.workspace_changes = {
    attribution: 'internal',
    paths: ['src/lib/engine.ts'],
    explanation: 'The stage edited the engine.',
  }
  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)

  const submitted = submitAsSupervisor(root, runId, invocation.output.path)
  const gates = submitted.record.evaluation.deterministic.filter((result) =>
    result.command?.includes('repository-check'),
  )

  assert.notEqual(submitted.record.outcome, 'success')
  assert.ok(gates.length > 0, 'the implement stage declares repository gates')

  for (const gate of gates) {
    assert.match(
      gate.explanation ?? '',
      /harness validator IMPLEMENTATION-CLAIMS-VALIDATE-001 rejected the output/u,
      gate.id,
    )
  }
})
