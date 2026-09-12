import assert from 'node:assert/strict'
import test from 'node:test'

import { awayModeTrigger } from '../../src/lib/away-mode.js'
import {
  getRunState,
  prepareInvocation,
  resumeRun,
  resumeRunAsAway,
  setRunStageAsAway,
} from '../../src/lib/engine.js'
import { stageBySlug } from '../../src/lib/workflow.js'
import {
  checkpoint,
  checksVariant,
  fullFailsUntil,
  fullRuns,
  PASS,
  submitStageOutput,
} from './delivery-helpers.js'

test('the minimal level records the ship release gate as disabled and delegates without running full', () => {
  const { root, runId, workflow } = checkpoint(
    'delivery@verify-prepared',
    checksVariant(
      'verification=minimal,checks=full-always-fails',
      {
        static: { probes: [], commands: [PASS] },
        fast: { probes: [], commands: [PASS] },
        full: {
          probes: [],
          commands: [fullFailsUntil(Number.MAX_SAFE_INTEGER)],
        },
        configuration: { probes: [], commands: [PASS] },
      },
      { verification: 'minimal' },
    ),
  )

  submitStageOutput(root, runId, stageBySlug(workflow, 'verify'), 'success')

  const ship = prepareInvocation(root, runId)

  assert.ok(ship.invocation)
  assert.equal(fullRuns(root), 0)

  const gate = ship.state.entry_gates?.ship

  assert.ok(gate)
  assert.equal(gate.failures, 0)
  assert.equal(gate.last_result.disabled, true)
  assert.equal(gate.last_result.verification_level, 'minimal')
})

test('a third release-gate failure pauses for an operator-only decision that away mode cannot take', () => {
  const { root, runId, workflow } = checkpoint(
    'delivery@verify-prepared',
    checksVariant('checks=full-always-fails', {
      static: { probes: [], commands: [PASS] },
      fast: { probes: [], commands: [PASS] },
      full: { probes: [], commands: [fullFailsUntil(Number.MAX_SAFE_INTEGER)] },
      configuration: { probes: [], commands: [PASS] },
    }),
  )
  const remediateStage = stageBySlug(workflow, 'remediate')

  submitStageOutput(root, runId, stageBySlug(workflow, 'verify'), 'success')

  // Two repair loops through remediate, then the third failure pauses.
  for (const loop of [1, 2]) {
    const routed = prepareInvocation(root, runId)

    assert.equal(routed.invocation, null)
    assert.equal(routed.state.current_stage, 'remediate')
    assert.equal(routed.state.entry_gates?.ship?.failures, loop)
    assert.equal(fullRuns(root), loop)

    const remediated = submitStageOutput(root, runId, remediateStage, 'success')

    assert.equal(remediated.state.current_stage, 'ship')
  }

  const paused = prepareInvocation(root, runId)

  assert.equal(paused.invocation, null)
  assert.equal(fullRuns(root), 3)
  assert.equal(paused.state.status, 'paused')
  assert.equal(paused.state.current_stage, 'ship')
  assert.equal(paused.state.entry_gates?.ship?.failures, 3)
  assert.deepEqual(paused.state.pending_action, {
    type: 'operator_decision',
    operator_only: true,
  })
  assert.match(paused.state.pause_reason ?? '', /failed 3 times/u)
  assert.match(
    paused.state.pause_reason ?? '',
    /ship-entry-3-ship\.full_suite/u,
  )

  // Away mode neither sees a trigger nor may continue the run.
  assert.equal(
    awayModeTrigger({
      ...paused.state,
      away_mode: {
        enabled: true,
        guardrails: {
          allowed_actions: ['approve'],
          max_decisions_per_run: 1,
          max_remediation_attempts_per_agent: 1,
        },
        source_sha256: 'fixture',
      },
    }),
    null,
  )
  assert.throws(
    () => resumeRunAsAway(root, runId, 'remediate', 'away continues'),
    { code: 'AWAY_ACTION_FORBIDDEN' },
  )
  assert.throws(
    () => setRunStageAsAway(root, runId, 'remediate', 'away redirects'),
    { code: 'AWAY_ACTION_FORBIDDEN' },
  )
  assert.equal(getRunState(root, runId).status, 'paused')

  // The operator decides; the loop counter starts over.
  const resumed = resumeRun(root, runId, 'remediate', 'Operator sends back.')

  assert.equal(resumed.status, 'running')
  assert.equal(resumed.current_stage, 'remediate')
  assert.equal(resumed.entry_gates?.ship?.failures, 0)
  assert.equal(resumed.entry_gates?.ship?.routed_to, undefined)
})
