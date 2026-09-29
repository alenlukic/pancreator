import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { readAwayDecisionLedger } from '../../src/lib/away-mode.js'
import { decideAwayAsSupervisor } from '../../src/lib/away-orchestration.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import { AWAY, checkpoint } from './delivery-helpers.js'

test('enabled away mode completes ship through an approve supervisor decision', () => {
  const { root, runId, state } = checkpoint(
    'delivery@ship-awaiting-operator',
    AWAY,
  )

  assert.equal(state.stage_history.at(-1)?.stage, 'ship')

  const { state: next, record } = decideAwayAsSupervisor(root, state, {
    action: 'approve',
    note: 'The ship packet succeeded, so the supervisor approves it.',
  })

  assert.equal(next.status, 'succeeded')
  assert.equal(next.pending_action.type, 'none')
  assert.equal(record.result, 'applied')
  assert.equal(record.action, 'approve')

  const ledger = readAwayDecisionLedger(root)

  assert.equal(ledger.length, 1)
  assert.equal(ledger[0]?.result, 'applied')
  assert.equal(ledger[0]?.author, 'supervisor')

  const events = readFileSync(
    resolveRunLayout(root, runId).events.absolute,
    'utf8',
  )

  assert.doesNotMatch(events, /operator_decision_recorded/u)
  assert.match(events, /away_decision_applied/u)
})
