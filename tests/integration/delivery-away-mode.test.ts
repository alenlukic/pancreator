import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  decideRunAsAway,
  getRunState,
  pauseRun,
  resumeRun,
  resumeRunAsAway,
} from '../../src/lib/engine.js'
import {
  awayModeTrigger,
  readAwayDecisionLedger,
} from '../../src/lib/away-mode.js'
import { decideAwayAsSupervisor } from '../../src/lib/away-orchestration.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import { createFixture, PLANNING_FIXTURE_SPECS } from '../helpers.js'
import { createRun } from '../run-helpers.js'
import { AWAY, checkpoint } from './delivery-helpers.js'

const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')

test('enabled away mode approves a ratified planning gate via decideAwayAsSupervisor', () => {
  const { root, state } = checkpoint('planning@plan-awaiting-operator', AWAY)
  const blocker = awayModeTrigger(state)

  assert.ok(blocker)

  const { state: next, record } = decideAwayAsSupervisor(root, state, {
    action: 'approve',
    note: 'Approve the ratified plan.',
  })

  assert.equal(next.status, 'succeeded')
  assert.equal(next.pending_action.type, 'none')
  assert.equal(record.result, 'applied')
  assert.equal(record.action, 'approve')
  assert.equal(record.author, 'supervisor')

  const ledger = readAwayDecisionLedger(root)

  assert.equal(ledger.length, 1)
  assert.equal(ledger[0]?.result, 'applied')
})

test('pan away decide approves a ratified plan via CLI', () => {
  const { root, runId, state } = checkpoint(
    'planning@plan-awaiting-operator',
    AWAY,
  )
  const blocker = awayModeTrigger(state)

  assert.ok(blocker)

  const cli = (...args: string[]): Record<string, unknown> =>
    JSON.parse(
      execFileSync(process.execPath, [CLI, ...args, '--json'], {
        cwd: root,
        encoding: 'utf8',
      }),
    ) as Record<string, unknown>

  // The child specification the plan names is gone, so the routing hook
  // that follows the approval fails. The approval is durable before the
  // hook runs, so the failure is reported beside it.
  rmSync(path.join(root, PLANNING_FIXTURE_SPECS.child))

  const result = cli(
    'away',
    'decide',
    runId,
    '--action',
    'approve',
    '--note',
    'Approve the ratified plan.',
  ) as {
    state: { status: string }
    decision: { result: string; action: string }
    autostart?: { status: string }
  }

  assert.equal(result.state.status, 'succeeded')
  assert.equal(result.decision.result, 'applied')
  assert.equal(result.decision.action, 'approve')
  assert.equal(result.autostart?.status, 'failed')

  const ledger = readAwayDecisionLedger(root)

  assert.equal(ledger.length, 1)
  assert.equal(ledger[0]?.result, 'applied')
})

test('away resume cannot ratify workspace changes made during a pause', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Away ratification fixture',
  })
  const runId = state.run_id

  pauseRun(root, runId, 'Pause without workspace edits.')

  const awayResumed = resumeRunAsAway(root, runId)

  assert.equal(awayResumed.status, 'running')
  assert.equal(awayResumed.pending_action.type, 'prepare_invocation')
  assert.equal(awayResumed.operator_pause, null)
  assert.equal(awayResumed.operator_workspace_ratifications, undefined)
  assert.match(
    readFileSync(resolveRunLayout(root, runId).events.absolute, 'utf8'),
    /away_run_resumed/u,
  )

  pauseRun(root, runId, 'Pause before an external edit.')
  writeFileSync(
    path.join(root, 'src', 'base.ts'),
    'export const base = true\nexport const externalEdit = true\n',
  )

  assert.throws(
    () => resumeRunAsAway(root, runId, 'implement', 'Resume past the edit.'),
    /cannot ratify workspace changes/u,
  )
  assert.equal(getRunState(root, runId).status, 'paused')

  const resumed = resumeRun(
    root,
    runId,
    'implement',
    'Authorized operator fix.',
  )

  assert.equal(resumed.status, 'running')
  assert.equal(resumed.operator_workspace_ratifications?.length, 1)
})

test('away revise re-runs the stage without an operator revision allowance', () => {
  const { root, runId, state } = checkpoint('planning@plan-awaiting-operator')

  assert.equal(state.pending_action.type, 'operator_approval')

  const revised = decideRunAsAway(
    root,
    runId,
    'revise',
    'Narrow the plan scope.',
  )

  assert.equal(revised.current_stage, 'plan')
  assert.equal(revised.pending_action.type, 'prepare_invocation')
  assert.equal(revised.operator_revisions?.plan, undefined)

  const feedback = revised.operator_feedback?.at(-1)

  assert.equal(feedback?.decision, 'revise')
  assert.equal(feedback?.source, 'away')
  assert.match(feedback?.path ?? '', /away-feedback-1\.md$/u)
})
