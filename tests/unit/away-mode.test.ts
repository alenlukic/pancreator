import assert from 'node:assert/strict'
import test from 'node:test'

import {
  awayBlockerCanBeCleared,
  awayModeTrigger,
  parseAwayOptions,
  selectAwayOption,
  unknownAwayOption,
} from '../../src/lib/away-mode.js'
import { AWAY_MODE_ACTIONS } from '../../src/lib/project-config.js'
import type {
  AwayModeAction,
  ResolvedAwayModeConfig,
  RunState,
  StageHistoryItem,
} from '../../src/lib/types.js'

function option(rank: number, action: AwayModeAction): Record<string, unknown> {
  return {
    rank,
    action,
    feasible: true,
    rationale: `Use ${action}.`,
    evidence: ['runtime/logs/workflows/run/agent/state.json'],
    rollback_plan: {
      steps: ['Restore the prior run state.'],
      verification: 'Confirm the prior pending action.',
    },
    ...(action === 'revise' ? { note: 'Clarify the implementation.' } : {}),
    ...(action === 'set-stage' ? { stage: 'implement' } : {}),
    ...(action === 'waive-gate'
      ? {
          note: 'The baseline is stale rather than the change broken; route the run to ship.',
        }
      : {}),
  }
}

function awayConfig(
  guardrails: Partial<ResolvedAwayModeConfig['guardrails']> = {},
): ResolvedAwayModeConfig {
  return {
    enabled: true,
    guardrails: {
      allowed_actions: [...AWAY_MODE_ACTIONS],
      max_decisions_per_run: 3,
      max_remediation_attempts_per_agent: 2,
      ...guardrails,
    },
    source_sha256: 'a'.repeat(64),
  }
}

function runStateLiteral(overrides: Partial<RunState>): RunState {
  return {
    run_id: 'run-literal',
    status: 'running',
    current_stage: 'plan',
    pending_action: { type: 'prepare_invocation' },
    stage_history: [],
    pause_reason: null,
    ...overrides,
  } as unknown as RunState
}

function blockedHistoryItem(stage: string): StageHistoryItem {
  return {
    stage,
    attempt: 1,
    invocation_id: `1_${stage}-1_fixture`,
    output_path: 'runtime/logs/workflows/run/agent/outputs/fixture.json',
    outcome: 'blocked',
    submitted_at: '2026-08-21T12:00:00.000Z',
    workspace_fingerprint: 'fixture',
    validation_errors: [],
    deterministic: [],
  }
}

test('away mode rejects duplicate ranks and missing action details', () => {
  assert.throws(
    () =>
      parseAwayOptions({
        ranked_options: [{ ...option(1, 'resume'), action: 'push' }],
      }),
    /MUST be one of approve, reject, revise, resume, set-stage, waive-gate/u,
  )
  assert.throws(
    () =>
      parseAwayOptions({
        ranked_options: [option(1, 'resume'), option(1, 'approve')],
      }),
    /ranks MUST be unique/u,
  )
  assert.throws(
    () =>
      parseAwayOptions({
        ranked_options: [
          {
            ...option(1, 'resume'),
            evidence: ['The run waits for an operator decision.'],
          },
        ],
      }),
    /repository-relative path references/u,
  )

  const rollbackOptions = parseAwayOptions({
    ranked_options: [
      {
        ...option(1, 'resume'),
        rollback_plan: {
          steps: ['Run ./bin/pan run status --run run-id.'],
          verification: 'Confirm the prior run status.',
        },
      },
      {
        ...option(2, 'resume'),
        rollback_plan: {
          steps: ['Run ./bin/pan status run-id.'],
          verification: 'Confirm the prior run status.',
        },
      },
    ],
  })

  assert.equal(rollbackOptions[0]?.rollback_plan.complete, false)
  assert.match(
    rollbackOptions[0]?.rollback_plan.issues[0] ?? '',
    /Unknown pan command surface 'run status'/u,
  )
  assert.equal(rollbackOptions[1]?.rollback_plan.complete, true)
  assert.deepEqual(rollbackOptions[1]?.rollback_plan.issues, [])

  const rollbackSelection = selectAwayOption(rollbackOptions, awayConfig())

  assert.equal(rollbackSelection.selected?.rank, 2)
  assert.match(
    rollbackSelection.rejected[0]?.reason ?? '',
    /rollback plan is incomplete.*run status/iu,
  )

  const selection = selectAwayOption(
    parseAwayOptions({
      ranked_options: [
        { ...option(1, 'revise'), note: undefined },
        { ...option(2, 'set-stage'), stage: undefined },
      ],
    }),
    awayConfig(),
  )

  assert.equal(selection.selected, null)
  assert.deepEqual(
    selection.rejected.map((rejection) => rejection.reason),
    ['revise requires a non-empty note.', 'set-stage requires a target stage.'],
  )
})

test('away mode skips infeasible options before selecting a rollback', () => {
  const selection = selectAwayOption(
    parseAwayOptions({
      ranked_options: [
        { ...option(1, 'resume'), feasible: false },
        option(2, 'revise'),
      ],
    }),
    awayConfig(),
  )

  assert.equal(selection.selected?.action, 'revise')
  assert.deepEqual(selection.rejected, [
    {
      rank: 1,
      reason: 'The evaluator marked this option infeasible.',
    },
  ])
})

test('an option an away subcommand does not accept is named, not ignored', () => {
  assert.equal(
    unknownAwayOption('apply', ['apply', 'run-1', '--decision', 'd-1']),
    null,
  )
  assert.equal(
    unknownAwayOption('apply', ['apply', 'run-1', '--action', 'resume']),
    null,
  )
  assert.equal(
    unknownAwayOption('apply', ['apply', 'run-1', '--dceision', 'd-1']),
    '--dceision',
  )
  assert.equal(
    unknownAwayOption('status', ['status', 'run-1', '--decision', 'd-1']),
    '--decision',
  )
  // An unrecognized subcommand is the subcommand handler's refusal, not this
  // guard's, so it claims nothing about the options.
  assert.equal(unknownAwayOption('sttaus', ['sttaus', '--json']), null)
})

test('a stale blocked outcome does not trigger on a progressing run', () => {
  assert.equal(
    awayModeTrigger(
      runStateLiteral({
        away_mode: { ...awayConfig(), enabled: false },
        status: 'paused',
        pending_action: { type: 'operator_decision' },
      }),
    ),
    null,
  )

  const running = runStateLiteral({ away_mode: awayConfig() })

  assert.equal(awayModeTrigger(running), null)
  assert.equal(
    awayModeTrigger(running, {
      health: 'dead',
      summary: 'The process ended.',
    })?.type,
    'hypervisor_incident',
  )

  const state = runStateLiteral({
    away_mode: awayConfig(),
    stage_history: [blockedHistoryItem('plan')],
  })

  assert.equal(awayModeTrigger(state), null)

  state.status = 'paused'
  state.pending_action = { type: 'operator_decision' }

  const blocker = awayModeTrigger(state)

  assert.equal(blocker?.type, 'stage_blocked')
  assert.equal(blocker?.stage, 'plan')
})

test('blocker recovery predicate rejects every human-only exit a session meets', () => {
  // Each human-only class AC-21 names reaches the session the same way: the
  // ranked options survive nothing, so `selectAwayOption` selects none. The
  // predicate reads that selection and nothing the caller asserts about it.
  const deniedDecision = selectAwayOption(
    parseAwayOptions({ ranked_options: [option(1, 'approve')] }),
    awayConfig(),
    { operator_decision: true },
  )
  const guardrailFiltered = selectAwayOption(
    parseAwayOptions({
      ranked_options: [option(1, 'resume'), option(2, 'set-stage')],
    }),
    awayConfig({ allowed_actions: ['approve'] }),
  )
  const unsupportedQuarantine = selectAwayOption(
    parseAwayOptions({
      ranked_options: [{ ...option(1, 'resume'), feasible: false }],
    }),
    awayConfig(),
  )
  const recoverable = selectAwayOption(
    parseAwayOptions({ ranked_options: [option(1, 'resume')] }),
    awayConfig(),
  )

  assert.equal(deniedDecision.selected, null)
  assert.match(
    deniedDecision.rejected[0]?.reason ?? '',
    /declares an operator decision/u,
  )
  assert.equal(awayBlockerCanBeCleared(deniedDecision), false)
  assert.equal(guardrailFiltered.rejected.length, 2)
  assert.equal(awayBlockerCanBeCleared(guardrailFiltered), false)
  assert.match(unsupportedQuarantine.rejected[0]?.reason ?? '', /infeasible/u)
  assert.equal(awayBlockerCanBeCleared(unsupportedQuarantine), false)
  assert.equal(recoverable.selected?.action, 'resume')
  assert.equal(awayBlockerCanBeCleared(recoverable), true)
})
