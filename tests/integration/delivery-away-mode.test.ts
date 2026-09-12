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
  countAwayDecisions,
  readAwayDecisionLedger,
  recordAwayApplyResult,
  recordAwayEvaluation,
} from '../../src/lib/away-mode.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import { createFixture, createRun, PLANNING_FIXTURE_SPECS } from '../helpers.js'
import { AWAY, checkpoint, withFakeEvaluator } from './delivery-helpers.js'

const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')

test('enabled away mode approves a ratified planning gate', () => {
  const { root, runId, state } = checkpoint(
    'planning@plan-awaiting-operator',
    AWAY,
  )
  const planOutputPath = state.stage_history.at(-1)?.output_path ?? ''
  const blocker = awayModeTrigger(state)

  assert.ok(blocker)

  const decision = recordAwayEvaluation(root, state, blocker, {
    ranked_options: [
      {
        rank: 1,
        action: 'approve',
        feasible: true,
        rationale: 'Approve the ratified plan.',
        evidence: [planOutputPath],
        rollback_plan: {
          steps: ['Start a later planning run from the same request.'],
          verification: 'Confirm the later run starts at plan.',
        },
      },
    ],
  })
  const next = decideRunAsAway(
    root,
    runId,
    'approve',
    decision.selected_action?.rationale ?? '',
  )

  recordAwayApplyResult(root, decision, 'applied')
  assert.equal(next.status, 'succeeded')
  assert.equal(next.pending_action.type, 'none')
  assert.equal(countAwayDecisions(root, runId), 1)
  assert.deepEqual(
    readAwayDecisionLedger(root).map((record) => record.decision_kind),
    ['evaluated', 'evaluated'],
  )
})

test('a routing failure after an away approval leaves one applied record and no failed one', () => {
  const { root, runId, state } = checkpoint(
    'planning@plan-awaiting-operator',
    AWAY,
  )
  const planOutputPath = state.stage_history.at(-1)?.output_path ?? ''
  const cli = (...args: string[]): Record<string, unknown> =>
    JSON.parse(
      execFileSync(process.execPath, [CLI, ...args, '--json'], {
        cwd: root,
        encoding: 'utf8',
      }),
    ) as Record<string, unknown>

  withFakeEvaluator(
    root,
    {
      ranked_options: [
        {
          rank: 1,
          action: 'approve',
          feasible: true,
          rationale: 'Approve the ratified plan.',
          evidence: [planOutputPath],
          rollback_plan: {
            steps: ['Start a later planning run from the same request.'],
            verification: 'Confirm the later run starts at plan.',
          },
        },
      ],
    },
    () => {
      const evaluated = cli('away', 'evaluate', runId) as {
        decision_id: string
        selected_action: { action: string } | null
      }

      assert.equal(evaluated.selected_action?.action, 'approve')

      // The child specification the plan names is gone, so the routing hook
      // that follows the approval fails. The approval is durable before the
      // hook runs, so the failure is reported beside it and never recorded as
      // a failed apply.
      rmSync(path.join(root, PLANNING_FIXTURE_SPECS.child))

      const applied = cli(
        'away',
        'apply',
        runId,
        '--decision',
        evaluated.decision_id,
      ) as {
        state: { status: string }
        decision: { result: string }
        autostart?: { status: string }
      }

      assert.equal(applied.state.status, 'succeeded')
      assert.equal(applied.decision.result, 'applied')
      assert.equal(applied.autostart?.status, 'failed')
      assert.deepEqual(
        readAwayDecisionLedger(root).map((record) => record.result),
        ['accepted', 'applied'],
      )
    },
  )
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
