import assert from 'node:assert/strict'
import test from 'node:test'

import { createRun as createEngineRun, pauseRun } from '../../src/lib/engine.js'
import { driveRun } from '../../src/lib/headless-driver.js'
import { checkpoint, type CheckpointVariant } from './delivery-helpers.js'

function unattestedVariant(key: string): CheckpointVariant {
  return {
    key,
    createRun: (root) =>
      createEngineRun(root, {
        workflowSlug: 'delivery',
        requestPath: 'request.md',
        title: key,
      }),
  }
}

test('a second driven run inherits no counter, attester, or stop state', () => {
  const authorized = checkpoint(
    'delivery@created',
    unattestedVariant('headless-authorized'),
  )
  const unauthorized = checkpoint(
    'delivery@created',
    unattestedVariant('headless-unauthorized'),
  )

  // The first run is driven to a stop that sets every field the second run
  // could inherit: a non-zero step count, a named attester, and a step-limit
  // stop with no handoff reason of the unattested kind.
  const first = driveRun(authorized.root, authorized.runId, {
    attestSupervisorCard: true,
    attestedBy: 'first-driver',
    maxSteps: 1,
  })

  assert.equal(first.supervisor_card_attested_by, 'first-driver')
  assert.equal(first.steps, 1)
  assert.equal(first.stop.type, 'step_limit')
  assert.equal(
    first.state.supervisor_card?.attested_sha256,
    first.state.supervisor_card?.sha256,
  )

  // The second run is differently shaped and must reach a different stop with
  // none of the first run's values. Each assertion below fails if the step
  // counter, the attester, or the stop state were hoisted out of the call.
  const second = driveRun(unauthorized.root, unauthorized.runId)

  assert.equal(second.steps, 0)
  assert.equal(second.supervisor_card_attested_by, null)
  assert.equal(second.stop.type, 'unresolved')
  assert.match(second.handoff_reason ?? '', /not attested/u)
  assert.deepEqual(second.decisions_applied, [])
  assert.notEqual(
    second.state.supervisor_card?.attested_sha256,
    second.state.supervisor_card?.sha256,
  )
})

test('the driver returns an operator pause without changing transitions', () => {
  const run = checkpoint('delivery@created')
  const paused = pauseRun(run.root, run.runId, 'ladder exhausted')

  const result = driveRun(run.root, run.runId)

  assert.equal(result.stop.type, 'operator_pause')
  assert.equal(result.stop.reason, 'ladder exhausted')
  assert.equal(result.state.transition_count, paused.transition_count)
})
