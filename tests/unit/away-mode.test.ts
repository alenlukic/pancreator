import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { Worker } from 'node:worker_threads'

import {
  awayDecisionLedgerPath,
  awayModeTrigger,
  countAwayDecisions,
  parseAwayOptions,
  readAwayDecisionLedger,
  recordAwayApplyResult,
  recordAwayEvaluation,
  recordAwayEvaluationFailure,
  recordDeterministicShipApproval,
  recordHypervisorQuarantine,
  selectAwayOption,
} from '../../src/lib/away-mode.js'
import { createRun } from '../../src/lib/engine.js'
import {
  AWAY_MODE_ACTIONS,
  resolveAwayModeConfig,
} from '../../src/lib/project-config.js'
import type {
  AwayModeAction,
  AwayModeGuardrails,
  ResolvedAwayModeConfig,
  RunState,
  StageHistoryItem,
} from '../../src/lib/types.js'
import { createFixture } from '../helpers.js'

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
  }
}

function scratchRoot(): string {
  return mkdtempSync(path.join(tmpdir(), 'pancreator-away-mode-'))
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

/** A run state that carries only the fields awayModeTrigger reads. */
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

function successfulShipGate(state: RunState): void {
  state.current_stage = 'ship'
  state.status = 'awaiting_operator'
  state.pending_action = {
    type: 'operator_approval',
    stage: 'ship',
    proposed_transition: 'complete',
  }
}

function blockedRun(root: string): RunState {
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })

  state.status = 'paused'
  state.pending_action = {
    type: 'operator_decision',
  }

  return state
}

test('new runs snapshot resolved away-mode guardrails', () => {
  const root = createFixture()

  enableAwayMode(root, {
    allowed_actions: ['resume'],
    max_decisions_per_run: 2,
  })
  const state = blockedRun(root)

  assert.equal(state.away_mode?.enabled, true)
  assert.deepEqual(state.away_mode?.guardrails.allowed_actions, ['resume'])
  assert.equal(state.away_mode?.guardrails.max_decisions_per_run, 2)
  assert.equal(
    state.away_mode?.guardrails.max_remediation_attempts_per_agent,
    2,
  )
  assert.match(state.away_mode?.source_sha256 ?? '', /^[a-f0-9]{64}$/u)
})

test('away mode skips options outside operator guardrails', () => {
  const root = createFixture()

  enableAwayMode(root, { allowed_actions: ['resume'] })
  const state = blockedRun(root)
  const blocker = awayModeTrigger(state)

  assert.ok(blocker)
  const record = recordAwayEvaluation(
    root,
    state,
    blocker,
    { ranked_options: [option(1, 'approve'), option(2, 'resume')] },
    '2026-08-21T12:00:00.000Z',
  )

  assert.equal(record.result, 'accepted')
  assert.equal(record.selected_action?.action, 'resume')
  assert.match(record.rejected_options[0]?.reason ?? '', /guardrails/u)

  const applied = recordAwayApplyResult(root, record, 'applied')
  const ledger = readAwayDecisionLedger(root)

  assert.equal(applied.linked_decision_id, record.decision_id)
  assert.equal(ledger.length, 2)
  assert.notEqual(ledger[0]?.decision_id, ledger[1]?.decision_id)

  const shipState = { ...state }

  successfulShipGate(shipState)
  assert.throws(
    () => recordDeterministicShipApproval(root, shipState, []),
    /outside operator guardrails/u,
  )
  assert.equal(readAwayDecisionLedger(root).length, 2)
})

test('away mode rejects malformed evaluator output', () => {
  assert.throws(
    () =>
      parseAwayOptions({
        ranked_options: [{ ...option(1, 'resume'), action: 'push' }],
      }),
    /MUST be approve/u,
  )
})

test('away mode rejects duplicate ranks and missing action details', () => {
  assert.throws(
    () =>
      parseAwayOptions({
        ranked_options: [option(1, 'resume'), option(1, 'approve')],
      }),
    /ranks MUST be unique/u,
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

test('away mode rejects evidence that is not a repository path', () => {
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
})

test('hypervisor quarantine appends a decision when away mode is disabled', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })

  const shipState = { ...state }

  successfulShipGate(shipState)
  assert.throws(
    () => recordDeterministicShipApproval(root, shipState, []),
    /Away mode is disabled for this run/u,
  )
  assert.equal(readAwayDecisionLedger(root).length, 0)

  const record = recordHypervisorQuarantine(
    root,
    state,
    {
      health: 'dead',
      summary: 'The same recovery signature failed twice.',
      evidence_reference: 'runtime/logs/hypervisor/events.jsonl',
    },
    '2026-08-21T12:00:00.000Z',
  )

  assert.equal(record.result, 'rejected')
  assert.equal(record.blocker.type, 'hypervisor_incident')
  assert.equal(record.blocker.agent_health, 'dead')
  assert.deepEqual(record.evidence_references, [
    'runtime/logs/hypervisor/events.jsonl',
  ])
  assert.equal(readAwayDecisionLedger(root).length, 1)
})

test('away mode records successful ship approval outside the decision budget', () => {
  const root = createFixture()

  enableAwayMode(root, { allowed_actions: ['approve'] })
  const state = blockedRun(root)

  assert.throws(
    () => recordDeterministicShipApproval(root, state, []),
    /does not have a successful ship packet/u,
  )

  successfulShipGate(state)
  state.pending_action = {
    type: 'operator_approval',
    stage: 'ship',
    proposed_transition: 'complete',
    outcome: 'failure',
  }
  assert.throws(
    () => recordDeterministicShipApproval(root, state, []),
    /does not have a successful ship packet/u,
  )
  assert.equal(readAwayDecisionLedger(root).length, 0)

  successfulShipGate(state)
  const record = recordDeterministicShipApproval(root, state, [
    'runtime/logs/workflows/run/agent/state.json',
  ])

  assert.equal(record.result, 'accepted')
  assert.equal(record.decision_kind, 'deterministic_ship_approval')
  assert.equal(record.selected_action?.action, 'approve')
  assert.equal(countAwayDecisions(root, state.run_id), 0)
})

test('legacy accepted records remain budgeted as evaluated decisions', () => {
  const root = scratchRoot()
  const ledgerPath = awayDecisionLedgerPath(root)
  // A record written before decision_kind existed carries no such field.
  const legacy = {
    schema_version: 1,
    decision_id: '00000000-0000-4000-8000-000000000001',
    run_id: 'run-legacy',
    result: 'accepted',
    selected_action: option(1, 'resume'),
    rejected_options: [],
    recorded_at: '2026-08-21T12:00:00.000Z',
  }

  mkdirSync(path.dirname(ledgerPath), { recursive: true })
  writeFileSync(ledgerPath, `${JSON.stringify(legacy)}\n`)

  assert.equal(countAwayDecisions(root, 'run-legacy'), 1)
  assert.equal(readAwayDecisionLedger(root)[0]?.decision_kind, undefined)
})

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

test('the decision limit also bounds evaluator failure records', () => {
  const root = createFixture()

  enableAwayMode(root, { max_decisions_per_run: 1 })
  const state = blockedRun(root)
  const blocker = awayModeTrigger(state)

  assert.ok(blocker)
  const failure = recordAwayEvaluationFailure(
    root,
    state,
    blocker,
    'The evaluator failed.',
    '2026-08-21T12:00:00.000Z',
  )

  assert.equal(failure.result, 'rejected')
  assert.equal(failure.selected_action, null)
  assert.equal(failure.error, 'The evaluator failed.')
  assert.equal(readAwayDecisionLedger(root).length, 1)

  assert.throws(
    () => recordAwayEvaluationFailure(root, state, blocker, 'It failed again.'),
    /decision limit for this run is exhausted/u,
  )
  assert.throws(
    () =>
      recordAwayEvaluation(root, state, blocker, {
        ranked_options: [option(1, 'resume')],
      }),
    /decision limit for this run is exhausted/u,
  )
  assert.equal(readAwayDecisionLedger(root).length, 1)
})

interface ConcurrentEvaluationResult {
  outcome: 'success' | 'error'
  code?: string
  message?: string
}

function runConcurrentEvaluation(input: {
  root: string
  state: RunState
  blocker: NonNullable<ReturnType<typeof awayModeTrigger>>
  start: SharedArrayBuffer
}): Promise<ConcurrentEvaluationResult> {
  const workerSource = `
    const { parentPort, workerData } = require('node:worker_threads')
    const start = new Int32Array(workerData.start)
    const setup = workerData.tsxApiUrl
      ? import(workerData.tsxApiUrl).then((api) => api.register())
      : Promise.resolve()

    setup
      .then(() => {
        Atomics.wait(start, 0, 0)

        return import(workerData.moduleUrl)
      })
      .then(({ recordAwayEvaluation }) => {
        try {
          recordAwayEvaluation(
            workerData.root,
            workerData.state,
            workerData.blocker,
            workerData.value,
          )
          parentPort.postMessage({ outcome: 'success' })
        } catch (error) {
          parentPort.postMessage({
            outcome: 'error',
            code: error && typeof error === 'object' ? error.code : undefined,
            message: error instanceof Error ? error.message : String(error),
          })
        }
      })
      .catch((error) => {
        parentPort.postMessage({
          outcome: 'error',
          message: error instanceof Error ? error.message : String(error),
        })
      })
  `
  // A tsx source run resolves the .js specifier onto the TypeScript module
  // through hooks tsx only installs on the main thread, so the worker must
  // register the tsx API itself. The compiled dist run needs no hooks.
  const tsxLoaderArg = process.execArgv.find((argument) =>
    argument.endsWith('/tsx/dist/loader.mjs'),
  )
  const tsxApiUrl = tsxLoaderArg
    ? new URL('./esm/api/index.mjs', tsxLoaderArg).href
    : undefined
  const worker = new Worker(workerSource, {
    eval: true,
    workerData: {
      ...input,
      tsxApiUrl,
      moduleUrl: new URL('../../src/lib/away-mode.js', import.meta.url).href,
      value: { ranked_options: [option(1, 'resume')] },
    },
  })

  return new Promise((resolve, reject) => {
    worker.once('message', (result: ConcurrentEvaluationResult) => {
      resolve(result)
    })
    worker.once('error', reject)
    worker.once('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`Concurrent evaluation worker exited with ${code}.`))
      }
    })
  })
}

test('concurrent evaluations append one valid decision at the limit', async () => {
  const root = createFixture()

  enableAwayMode(root, { max_decisions_per_run: 1 })
  const state = blockedRun(root)
  const blocker = awayModeTrigger(state)

  assert.ok(blocker)
  const start = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
  const first = runConcurrentEvaluation({ root, state, blocker, start })
  const second = runConcurrentEvaluation({ root, state, blocker, start })

  Atomics.store(new Int32Array(start), 0, 1)
  Atomics.notify(new Int32Array(start), 0, 2)

  const results = await Promise.all([first, second])
  const successes = results.filter((result) => result.outcome === 'success')
  const errors = results.filter((result) => result.outcome === 'error')

  assert.equal(successes.length, 1, JSON.stringify(results))
  assert.equal(errors.length, 1)
  assert.ok(
    errors[0]?.code === 'AWAY_DECISION_LIMIT' ||
      errors[0]?.code === 'RUN_OPERATION_IN_PROGRESS',
    JSON.stringify(errors[0]),
  )

  const ledger = readAwayDecisionLedger(root)

  assert.equal(ledger.length, 1)
  assert.equal(ledger[0]?.result, 'accepted')
  assert.equal(ledger[0]?.selected_action?.action, 'resume')
  assert.match(ledger[0]?.decision_id ?? '', /^[0-9a-f-]{36}$/u)
})

test('a malformed ledger line fails with the ledger path', () => {
  const root = scratchRoot()
  const ledgerPath = awayDecisionLedgerPath(root)

  mkdirSync(path.dirname(ledgerPath), { recursive: true })
  writeFileSync(ledgerPath, 'not json\n')

  assert.throws(
    () => readAwayDecisionLedger(root),
    /Invalid away-mode ledger:/u,
  )
})

test('away mode rejects unsupported configured actions', () => {
  const root = createFixture()

  enableAwayMode(root, {
    allowed_actions: ['push' as AwayModeAction],
  })

  assert.throws(
    () => resolveAwayModeConfig(root),
    /allowed_actions MUST contain only/u,
  )
})
