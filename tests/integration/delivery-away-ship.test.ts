import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { decideRunAsAway } from '../../src/lib/engine.js'
import {
  countAwayDecisions,
  readAwayDecisionLedger,
  recordAwayApplyResult,
  recordDeterministicShipApproval,
} from '../../src/lib/away-mode.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import { AWAY, checkpoint } from './delivery-helpers.js'

test('enabled away mode completes ship through a deterministic approval', () => {
  const { root, runId, state } = checkpoint(
    'delivery@ship-awaiting-operator',
    AWAY,
  )
  const shipOutputPath = state.stage_history.at(-1)?.output_path ?? ''

  assert.equal(state.stage_history.at(-1)?.stage, 'ship')

  const decision = recordDeterministicShipApproval(root, state, [
    resolveRunLayout(root, runId).state.relative,
    shipOutputPath,
  ])
  const next = decideRunAsAway(
    root,
    runId,
    'approve',
    decision.selected_action?.rationale ?? '',
  )

  recordAwayApplyResult(root, decision, 'applied')
  assert.equal(next.status, 'succeeded')
  assert.equal(next.pending_action.type, 'none')

  const ledger = readAwayDecisionLedger(root)

  // Delivery holds no plan gate, so the run reaches ship without spending an
  // evaluated away decision; the deterministic ship approval is not budgeted.
  assert.equal(countAwayDecisions(root, runId), 0)
  assert.deepEqual(
    ledger.map((record) => record.decision_kind),
    ['deterministic_ship_approval', 'deterministic_ship_approval'],
  )

  const events = readFileSync(
    resolveRunLayout(root, runId).events.absolute,
    'utf8',
  )

  assert.doesNotMatch(events, /operator_decision_recorded/u)
  assert.match(events, /away_decision_applied/u)
})
