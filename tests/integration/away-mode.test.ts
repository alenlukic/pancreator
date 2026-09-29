import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  appendSupervisorDecision,
  awayDecisionLedgerPath,
  awayModeTrigger,
  readAwayDecisionLedger,
  type AwayBlocker,
  type SupervisorDecisionRecord,
} from '../../src/lib/away-mode.js'
import { decideAwayAsSupervisor } from '../../src/lib/away-orchestration.js'
import { pauseRun } from '../../src/lib/engine.js'
import {
  AWAY_MODE_ACTIONS,
  resolveAwayModeConfig,
} from '../../src/lib/project-config.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import { validateAwayDecisionLedger } from '../../src/lib/validators/autonomy-state.js'
import type {
  AwayModeAction,
  AwayModeGuardrails,
  RunState,
  StageHistoryItem,
} from '../../src/lib/types.js'
import { createFixture } from '../helpers.js'
import { createTestTempDirectory } from '../temp.js'
import { AWAY, AWAY_ALL, checkpoint } from './delivery-helpers.js'

function enableAwayMode(
  root: string,
  guardrails: AwayModeGuardrails = {},
): void {
  const configPath = path.join(root, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<
    string,
    unknown
  >

  writeFileSync(
    configPath,
    `${JSON.stringify(
      { ...config, away_mode: { enabled: true, guardrails } },
      null,
      2,
    )}\n`,
  )
}

function awayConfig(
  root: string,
  guardrails: AwayModeGuardrails = {},
): ReturnType<typeof resolveAwayModeConfig> {
  return resolveAwayModeConfig(root, {
    enabled: true,
    guardrails: {
      allowed_actions: [
        'approve',
        'reject',
        'revise',
        'resume',
        'set-stage',
        'waive-gate',
      ],
      ...guardrails,
    },
  })
}

function pausedRunState(
  root: string,
  runId: string,
  pendingAction: RunState['pending_action'] = { type: 'operator_decision' },
  stageHistory: StageHistoryItem[] = [],
): RunState {
  const away = awayConfig(root)

  return {
    run_id: runId,
    status: 'paused',
    current_stage: 'implement',
    pending_action: pendingAction,
    stage_history: stageHistory,
    pause_reason: 'Stage implement reported blocked.',
    away_mode: away,
  } as unknown as RunState
}

function blockedHistoryItem(runId: string, stage: string): StageHistoryItem {
  return {
    stage,
    attempt: 1,
    invocation_id: `1_${stage}-1_fixture`,
    output_path: path.join(
      'runtime',
      'logs',
      'workflows',
      runId,
      'agent',
      'outputs',
      '01_implement-1_fixture.json',
    ),
    outcome: 'blocked',
    submitted_at: '2026-08-21T12:00:00.000Z',
    workspace_fingerprint: 'fixture',
    validation_errors: [],
    deterministic: [],
  } as unknown as StageHistoryItem
}

function supervisorRecord(
  runId: string,
  action: AwayModeAction,
  blocker: AwayBlocker,
  overrides: Partial<SupervisorDecisionRecord> = {},
): SupervisorDecisionRecord {
  return {
    schema_version: 1,
    decision_id: 'decision-id-fixture',
    author: 'supervisor',
    run_id: runId,
    invocation_id: null,
    blocker,
    action,
    reason: 'Continuing the run.',
    guardrails: {
      allowed_actions: [
        'approve',
        'reject',
        'revise',
        'resume',
        'set-stage',
        'waive-gate',
      ],
    },
    result: 'applied',
    evidence_references: [],
    recorded_at: '2026-09-28T00:00:00.000Z',
    ...overrides,
  }
}

test('readAwayDecisionLedger returns empty array when ledger is absent', () => {
  const tmp = createTestTempDirectory('away-')

  assert.deepEqual(readAwayDecisionLedger(tmp), [])
})

test('appendSupervisorDecision and readAwayDecisionLedger round-trip', () => {
  const tmp = createTestTempDirectory('away-')
  const blocker: AwayBlocker = {
    type: 'stage_blocked',
    summary: 'Stage implement reported blocked.',
    stage: 'implement',
  }
  const record = supervisorRecord('run-1', 'resume', blocker)

  mkdirSync(path.join(tmp, 'runtime', 'logs', 'away-mode'), { recursive: true })
  appendSupervisorDecision(tmp, record)

  const ledger = readAwayDecisionLedger(tmp)

  assert.equal(ledger.length, 1)
  assert.equal(ledger[0]?.decision_id, record.decision_id)
  assert.equal(ledger[0]?.author, 'supervisor')
  assert.equal(ledger[0]?.action, 'resume')
  assert.equal(ledger[0]?.result, 'applied')
})

test('awayDecisionLedgerPath points at supervisor-decisions.jsonl', () => {
  const tmp = createTestTempDirectory('away-')
  const ledgerPath = awayDecisionLedgerPath(tmp)

  assert.ok(ledgerPath.endsWith('supervisor-decisions.jsonl'))
})

// ─── validateAwayDecisionLedger ───────────────────────────────────────────────

test('validateAwayDecisionLedger accepts a valid SupervisorDecisionRecord', () => {
  const tmp = createTestTempDirectory('away-')
  const blocker: AwayBlocker = {
    type: 'operator_decision',
    summary: 'The run waits for a decision.',
    stage: 'implement',
  }
  const record = supervisorRecord('run-1', 'approve', blocker)

  mkdirSync(path.join(tmp, 'runtime', 'logs', 'away-mode'), { recursive: true })
  appendSupervisorDecision(tmp, record)

  const input = { root: tmp } as Parameters<
    typeof validateAwayDecisionLedger
  >[0]
  const result = validateAwayDecisionLedger(input)

  assert.equal(result.status, 'passed')
})

test('validateAwayDecisionLedger rejects a record with wrong author', () => {
  const tmp = createTestTempDirectory('away-')
  const ledgerPath = awayDecisionLedgerPath(tmp)
  const blocker: AwayBlocker = {
    type: 'stage_blocked',
    summary: 'Blocked.',
    stage: 'plan',
  }
  const record = supervisorRecord('run-1', 'resume', blocker, {
    author: 'hypervisor' as unknown as 'supervisor',
  })

  mkdirSync(path.join(tmp, 'runtime', 'logs', 'away-mode'), { recursive: true })
  writeFileSync(ledgerPath, `${JSON.stringify(record)}\n`)

  const input = { root: tmp } as Parameters<
    typeof validateAwayDecisionLedger
  >[0]
  const result = validateAwayDecisionLedger(input)

  assert.equal(result.status, 'failed')
})

test('validateAwayDecisionLedger names each broken record rule', () => {
  const blocker: AwayBlocker = {
    type: 'operator_decision',
    summary: 'The run waits for a decision.',
    stage: 'implement',
  }
  const cases: Array<[string, Partial<SupervisorDecisionRecord>]> = [
    [
      'away.decision.action',
      { guardrails: { allowed_actions: ['resume'] }, action: 'approve' },
    ],
    [
      'away.decision.blocker',
      { blocker: { ...blocker, type: 'agent_stalled' as AwayBlocker['type'] } },
    ],
    ['away.decision.reason', { reason: ' ' }],
    ['away.decision.error', { result: 'failed' }],
    [
      'away.decision.evidence',
      { evidence_references: ['/abs/state.json', '../outside.json'] },
    ],
  ]

  for (const [code, overrides] of cases) {
    const tmp = createTestTempDirectory('away-')

    mkdirSync(path.dirname(awayDecisionLedgerPath(tmp)), { recursive: true })
    writeFileSync(
      awayDecisionLedgerPath(tmp),
      `${JSON.stringify(supervisorRecord('run-1', 'approve', blocker, overrides))}\n`,
    )

    const result = validateAwayDecisionLedger({ root: tmp } as Parameters<
      typeof validateAwayDecisionLedger
    >[0])

    assert.equal(result.status, 'failed', code)
    assert.ok(
      result.issues.some((issue) => issue.code === code),
      `${code}: ${JSON.stringify(result.issues)}`,
    )
  }
})

// ─── decideAwayAsSupervisor ───────────────────────────────────────────────────

test('decideAwayAsSupervisor refuses when away mode is disabled', () => {
  const tmp = createFixture()
  const runId = 'test-run-disabled'
  const state = pausedRunState(tmp, runId)

  ;(state.away_mode as { enabled: boolean }).enabled = false

  assert.throws(
    () =>
      decideAwayAsSupervisor(tmp, state, {
        action: 'resume',
        note: 'Continue.',
      }),
    (error) => error instanceof Error && /disabled/i.test(error.message),
  )
})

test('decideAwayAsSupervisor refuses a forbidden action', () => {
  const tmp = createFixture()
  const runId = 'test-run-forbidden'

  enableAwayMode(tmp, { allowed_actions: ['approve'] })

  const resolved = resolveAwayModeConfig(tmp)
  const state = pausedRunState(tmp, runId)

  ;(state as { away_mode: typeof resolved }).away_mode = resolved
  state.status = 'paused'
  state.pending_action = { type: 'operator_decision' }

  assert.throws(
    () =>
      decideAwayAsSupervisor(tmp, state, {
        action: 'resume',
        note: 'Continue.',
      }),
    (error) =>
      error instanceof Error &&
      /outside operator guardrails/i.test(error.message),
  )
})

test('decideAwayAsSupervisor refuses when no blocker exists', () => {
  const tmp = createFixture()
  const runId = 'test-run-no-blocker'
  const resolved = awayConfig(tmp)
  const state: RunState = {
    run_id: runId,
    status: 'running',
    current_stage: 'implement',
    pending_action: { type: 'invoke_agent' },
    stage_history: [],
    pause_reason: null,
    away_mode: resolved,
  } as unknown as RunState

  assert.throws(
    () =>
      decideAwayAsSupervisor(tmp, state, {
        action: 'resume',
        note: 'Continue.',
      }),
    (error) => error instanceof Error && /no blocker/i.test(error.message),
  )
})

test('decideAwayAsSupervisor refuses when note is absent', () => {
  const tmp = createFixture()
  const runId = 'test-run-no-note'
  const state = pausedRunState(tmp, runId)

  state.status = 'paused'
  state.pending_action = { type: 'operator_decision' }

  assert.throws(
    () =>
      decideAwayAsSupervisor(tmp, state, {
        action: 'resume',
        note: null,
      }),
    (error) => error instanceof Error && /note/i.test(error.message),
  )
})

test('awayModeTrigger returns null on a running, unblocked run', () => {
  const tmp = createFixture()
  const resolved = awayConfig(tmp)
  const state: RunState = {
    run_id: 'run-1',
    status: 'running',
    current_stage: 'plan',
    pending_action: { type: 'prepare_invocation' },
    stage_history: [],
    pause_reason: null,
    away_mode: resolved,
  } as unknown as RunState

  assert.equal(awayModeTrigger(state), null)
})

test('awayModeTrigger detects a stage_blocked pause', () => {
  const tmp = createFixture()
  const resolved = awayConfig(tmp)
  const historyItem = blockedHistoryItem('run-1', 'implement')
  const state: RunState = {
    run_id: 'run-1',
    status: 'paused',
    current_stage: 'implement',
    pending_action: { type: 'operator_decision' },
    stage_history: [historyItem],
    pause_reason: 'Stage implement reported blocked.',
    away_mode: resolved,
  } as unknown as RunState

  const blocker = awayModeTrigger(state)

  assert.equal(blocker?.type, 'stage_blocked')
  assert.equal(blocker?.stage, 'implement')
})

// ─── pan away CLI ─────────────────────────────────────────────────────────────

const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')

interface CliResult {
  status: number | null
  stdout: string
  stderr: string
}

function pan(root: string, args: string[]): CliResult {
  const result = spawnSync(process.execPath, [CLI, ...args, '--json'], {
    cwd: root,
    encoding: 'utf8',
  })

  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

function errorCode(result: CliResult): string {
  return (JSON.parse(result.stderr) as { error: string }).error
}

function decide(
  root: string,
  runId: string,
  action: string,
  ...extra: string[]
): CliResult {
  return pan(root, ['away', 'decide', runId, '--action', action, ...extra])
}

function decided(result: CliResult): {
  state: RunState
  decision: SupervisorDecisionRecord
  autostart?: { status: string; worktree?: string }
} {
  assert.equal(result.status, 0, result.stderr)

  return JSON.parse(result.stdout) as ReturnType<typeof decided>
}

/** Bytes a refused decision must leave untouched. */
function durableBytes(root: string, runId: string): [string, string | null] {
  const ledger = awayDecisionLedgerPath(root)

  return [
    readFileSync(resolveRunLayout(root, runId).state.absolute, 'utf8'),
    existsSync(ledger) ? readFileSync(ledger, 'utf8') : null,
  ]
}

test('pan away status prints exactly its six fields and counts decisions', () => {
  const { root, runId } = checkpoint(
    'planning@plan-awaiting-operator',
    AWAY_ALL,
  )
  const status = (): Record<string, unknown> => {
    const result = pan(root, ['away', 'status', runId])

    assert.equal(result.status, 0, result.stderr)

    return JSON.parse(result.stdout) as Record<string, unknown>
  }
  const before = status()

  assert.deepEqual(Object.keys(before).sort(), [
    'allowed_actions',
    'blocker',
    'decisions',
    'enabled',
    'open_operator_question',
    'run_id',
  ])
  assert.equal(before.run_id, runId)
  assert.equal(before.enabled, true)
  assert.equal((before.blocker as AwayBlocker).type, 'operator_approval')
  assert.deepEqual(before.allowed_actions, [...AWAY_MODE_ACTIONS])
  assert.equal(before.open_operator_question, null)
  assert.equal(before.decisions, 0)

  decided(decide(root, runId, 'revise', '--note', 'Narrow the plan.'))

  const after = status()

  assert.equal(after.decisions, 1)
  assert.equal(after.blocker, null)
})

test('pan away decide refuses in order and leaves state and ledger untouched', () => {
  const approveNote = ['--note', 'Approve the ratified plan.']
  const cases: Array<{
    name: string
    code: string
    setup: () => { root: string; runId: string }
    args: (runId: string) => string[]
  }> = [
    {
      name: 'away mode disabled',
      code: 'AWAY_MODE_DISABLED',
      setup: () => checkpoint('planning@plan-awaiting-operator'),
      args: (runId) => [
        'away',
        'decide',
        runId,
        '--action',
        'approve',
        ...approveNote,
      ],
    },
    {
      name: 'unanswered operator question',
      code: 'AWAY_OPERATOR_QUESTION_OPEN',
      setup: () => {
        const clone = checkpoint('planning@plan-awaiting-operator', AWAY_ALL)
        const outputPath = path.join(
          clone.root,
          clone.state.stage_history.at(-1)?.output_path ?? 'missing',
        )
        const output = JSON.parse(readFileSync(outputPath, 'utf8')) as Record<
          string,
          unknown
        >

        writeFileSync(
          outputPath,
          `${JSON.stringify({
            ...output,
            operator_question: {
              question: 'Which scope does the operator want?',
            },
          })}\n`,
        )

        return clone
      },
      args: (runId) => [
        'away',
        'decide',
        runId,
        '--action',
        'approve',
        ...approveNote,
      ],
    },
    {
      name: 'no permitted blocker',
      code: 'AWAY_TRIGGER_UNAVAILABLE',
      setup: () => checkpoint('planning@plan-prepared', AWAY_ALL),
      args: (runId) => [
        'away',
        'decide',
        runId,
        '--action',
        'resume',
        ...approveNote,
      ],
    },
    {
      name: 'action outside allowed_actions',
      code: 'AWAY_ACTION_FORBIDDEN',
      setup: () => checkpoint('planning@plan-awaiting-operator', AWAY),
      args: (runId) => [
        'away',
        'decide',
        runId,
        '--action',
        'reject',
        ...approveNote,
      ],
    },
    {
      name: 'missing note',
      code: 'INVALID_ARGUMENT',
      setup: () => checkpoint('planning@plan-awaiting-operator', AWAY_ALL),
      args: (runId) => ['away', 'decide', runId, '--action', 'approve'],
    },
    {
      name: 'set-stage without --stage',
      code: 'INVALID_ARGUMENT',
      setup: () => checkpoint('planning@plan-awaiting-operator', AWAY_ALL),
      args: (runId) => [
        'away',
        'decide',
        runId,
        '--action',
        'set-stage',
        ...approveNote,
      ],
    },
    {
      name: 'unknown option',
      code: 'UNKNOWN_OPTION',
      setup: () => checkpoint('planning@plan-awaiting-operator', AWAY_ALL),
      args: (runId) => [
        'away',
        'decide',
        runId,
        '--action',
        'approve',
        '--decision',
        'd-1',
        ...approveNote,
      ],
    },
  ]

  for (const item of cases) {
    const { root, runId } = item.setup()
    const before = durableBytes(root, runId)
    const result = pan(root, item.args(runId))

    assert.notEqual(result.status, 0, item.name)
    assert.equal(errorCode(result), item.code, item.name)
    assert.deepEqual(durableBytes(root, runId), before, item.name)
  }
})

test('pan away decide reject and revise reach the operator command state with away authorship', () => {
  for (const action of ['reject', 'revise']) {
    const away = checkpoint('planning@plan-awaiting-operator', AWAY_ALL)
    const operator = checkpoint('planning@plan-awaiting-operator', AWAY_ALL)
    const note = `The supervisor chose ${action}.`
    const result = decided(
      decide(away.root, away.runId, action, '--note', note),
    )
    const manual = pan(operator.root, [
      'decide',
      operator.runId,
      action,
      '--note',
      note,
    ])

    assert.equal(manual.status, 0, manual.stderr)

    const expected = JSON.parse(manual.stdout) as {
      status: string
      next_stage: string
      pending_action: RunState['pending_action']
    }

    assert.equal(result.state.status, expected.status, action)
    assert.equal(result.state.current_stage, expected.next_stage, action)
    assert.equal(
      result.state.pending_action.type,
      expected.pending_action.type,
      action,
    )
    assert.equal(result.decision.author, 'supervisor')
    assert.equal(result.decision.action, action)
    assert.equal(result.decision.reason, note)
    assert.equal(result.decision.result, 'applied')
    assert.doesNotMatch(
      readFileSync(
        resolveRunLayout(away.root, away.runId).events.absolute,
        'utf8',
      ),
      /operator_decision_recorded/u,
    )
  }
})

test('pan away decide resumes a paused run and sets a stage', () => {
  const paused = checkpoint('planning@plan-prepared', AWAY_ALL)

  pauseRun(paused.root, paused.runId, 'Pause for the away resume case.')

  const resumed = decided(
    decide(paused.root, paused.runId, 'resume', '--note', 'Resume the plan.'),
  )

  assert.equal(resumed.state.status, 'running')
  assert.equal(resumed.decision.action, 'resume')

  const gate = checkpoint('planning@plan-awaiting-operator', AWAY_ALL)
  const staged = decided(
    decide(
      gate.root,
      gate.runId,
      'set-stage',
      '--stage',
      'plan',
      '--note',
      'Re-run the plan stage.',
    ),
  )

  assert.equal(staged.state.current_stage, 'plan')
  assert.equal(staged.state.pending_action.type, 'prepare_invocation')
  assert.equal(staged.decision.stage, 'plan')
  assert.deepEqual(
    readAwayDecisionLedger(gate.root).map((record) => record.result),
    ['applied'],
  )
})

test('pan away decide waives a gate with away authorship and the note as its directive', () => {
  const { root, runId } = checkpoint(
    'planning@plan-awaiting-operator',
    AWAY_ALL,
  )
  // A waiver past a gate is refused unless its directive names the gate or
  // the destination, so the supervisor's note carries the reason and route.
  const note =
    'Waive the operator gate of plan: the plan is ratified, so route the run to succeeded.'
  const result = decided(decide(root, runId, 'waive-gate', '--note', note))
  const events = readFileSync(
    resolveRunLayout(root, runId).events.absolute,
    'utf8',
  )

  assert.equal(result.decision.result, 'applied')
  assert.equal(result.decision.reason, note)
  assert.match(events, /away_gate_waived/u)
  assert.doesNotMatch(events, /operator_gate_waived/u)
})

test('a refused apply appends one failed record and exits non-zero', () => {
  const { root, runId } = checkpoint(
    'planning@plan-awaiting-operator',
    AWAY_ALL,
  )
  const result = decide(
    root,
    runId,
    'set-stage',
    '--stage',
    'no-such-stage',
    '--note',
    'Move to a stage the workflow does not have.',
  )

  assert.notEqual(result.status, 0)

  const ledger = readAwayDecisionLedger(root)

  assert.equal(ledger.length, 1)
  assert.equal(ledger[0]?.result, 'failed')
  assert.equal(ledger[0]?.action, 'set-stage')
  assert.ok((ledger[0]?.error ?? '').length > 0)
  assert.equal(
    validateAwayDecisionLedger({ root } as Parameters<
      typeof validateAwayDecisionLedger
    >[0]).status,
    'passed',
  )
})

test('pan away decide --worktree binds the routed delivery run to the named worktree', () => {
  const { root, runId } = checkpoint(
    'planning@plan-awaiting-operator',
    AWAY_ALL,
  )
  const created = pan(root, ['worktree', 'create', 'away-target'])

  assert.equal(created.status, 0, created.stderr)

  const result = decided(
    decide(
      root,
      runId,
      'approve',
      '--note',
      'Approve the single-chunk plan.',
      '--worktree',
      'away-target',
    ),
  )

  assert.equal(result.autostart?.status, 'started', JSON.stringify(result))
  assert.match(result.autostart?.worktree ?? '', /away-target/u)
  assert.deepEqual(
    readAwayDecisionLedger(root).map((record) => [
      record.action,
      record.result,
    ]),
    [['approve', 'applied']],
  )
})
