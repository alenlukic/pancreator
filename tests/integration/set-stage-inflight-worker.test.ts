import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  getRunState,
  inFlightEvidenceWorkers,
  prepareInvocation,
  recordDelegatedWorker,
  setRunStage,
} from '../../src/lib/engine.js'
import type { Invocation } from '../../src/lib/types.js'
import { createFixture, writeCanonicalDelegation } from '../helpers.js'
import { createRun } from '../run-helpers.js'

/** A delegated verify invocation, whose stage declares two evidence workers. */
function delegatedVerifyRun(): {
  root: string
  runId: string
  invocation: Invocation
} {
  const root = createFixture()
  const run = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })

  setRunStage(root, run.run_id, 'verify', 'Verify the current workspace.')

  const invocation = prepareInvocation(root, run.run_id).invocation

  assert.ok(invocation)
  writeCanonicalDelegation(root, invocation)

  return { root, runId: run.run_id, invocation }
}

// A stage return silently orphaned two launched review workers: their reports
// landed against an invocation that was no longer current, so the next
// verification consolidated nothing and nobody could tell why.
test('a stage return that would abandon an in-flight evidence worker names the roles', () => {
  const { root, runId, invocation } = delegatedVerifyRun()
  const roles = (invocation.evidence_workers ?? []).map((worker) => worker.role)

  assert.ok(roles.length >= 2)
  recordDelegatedWorker(root, runId, {
    handle: 'bc-review-01',
    role: roles[0],
  })

  assert.deepEqual(
    inFlightEvidenceWorkers(root, getRunState(root, runId)).map(
      (worker) => worker.role,
    ),
    roles,
  )

  assert.throws(
    () => setRunStage(root, runId, 'implement', 'Back to implement.'),
    (error: unknown) => {
      const failure = error as { code?: string; message: string }

      assert.equal(failure.code, 'EVIDENCE_WORKERS_IN_FLIGHT')

      for (const role of roles) {
        assert.match(failure.message, new RegExp(role, 'u'))
      }

      assert.match(failure.message, /bc-review-01/u)
      assert.match(failure.message, /--abandon-workers/u)

      return true
    },
  )

  // The operator owns the call; the harness only refuses to make it silently.
  const confirmed = setRunStage(
    root,
    runId,
    'implement',
    'Back to implement.',
    {
      abandonWorkers: true,
    },
  )

  assert.equal(confirmed.current_stage, 'implement')
})

test('a stage return after every declared report is written behaves as it does today', () => {
  const { root, runId, invocation } = delegatedVerifyRun()

  for (const worker of invocation.evidence_workers ?? []) {
    writeFileSync(path.join(root, worker.evidence_path), `# ${worker.role}\n`)
  }

  assert.deepEqual(inFlightEvidenceWorkers(root, getRunState(root, runId)), [])

  const returned = setRunStage(root, runId, 'implement', 'Back to implement.')

  assert.equal(returned.current_stage, 'implement')
  assert.equal(returned.current_invocation, null)
  assert.equal(returned.pending_action.type, 'prepare_invocation')
})

// A stage nobody launched has no worker to abandon, so the return that a
// supervisor makes while assembling a run must stay unblocked.
test('a stage return before the launch is not treated as an abandonment', () => {
  const root = createFixture()
  const run = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })

  setRunStage(root, run.run_id, 'verify', 'Verify the current workspace.')
  assert.deepEqual(
    inFlightEvidenceWorkers(root, getRunState(root, run.run_id)),
    [],
  )
  prepareInvocation(root, run.run_id)

  assert.deepEqual(
    inFlightEvidenceWorkers(root, getRunState(root, run.run_id)),
    [],
  )
  assert.equal(
    setRunStage(root, run.run_id, 'implement', 'Back to implement.')
      .current_stage,
    'implement',
  )
})
