import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { Worker } from 'node:worker_threads'

import {
  awayDecisionLedgerPath,
  awayModeTrigger,
  parseAwayOptions,
  readAwayDecisionLedger,
  recordAwayApplyResult,
  recordAwayEvaluation,
  recordAwayEvaluationFailure,
  recordHypervisorQuarantine,
} from '../../src/lib/away-mode.js'
import { createRun } from '../../src/lib/engine.js'
import { resolveAwayModeConfig } from '../../src/lib/project-config.js'
import type {
  AwayModeAction,
  AwayModeGuardrails,
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

function blockedRun(root: string): RunState {
  const state = createRun(root, {
    workflowSlug: 'dev',
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
})

test('away mode records malformed evaluator output as rejected', () => {
  const root = createFixture()

  enableAwayMode(root)
  const state = blockedRun(root)
  const blocker = awayModeTrigger(state)

  assert.ok(blocker)
  const record = recordAwayEvaluation(
    root,
    state,
    blocker,
    { ranked_options: [{ ...option(1, 'resume'), action: 'push' }] },
    '2026-08-21T12:00:00.000Z',
  )

  assert.equal(record.result, 'rejected')
  assert.equal(record.selected_action, null)
  assert.match(record.error ?? '', /MUST be approve/u)
  assert.equal(readAwayDecisionLedger(root).length, 1)
})

test('away mode rejects duplicate ranks and missing action details', () => {
  assert.throws(
    () =>
      parseAwayOptions({
        ranked_options: [option(1, 'resume'), option(1, 'approve')],
      }),
    /ranks MUST be unique/u,
  )

  const root = createFixture()

  enableAwayMode(root)
  const state = blockedRun(root)
  const blocker = awayModeTrigger(state)

  assert.ok(blocker)
  const record = recordAwayEvaluation(root, state, blocker, {
    ranked_options: [
      { ...option(1, 'revise'), note: undefined },
      { ...option(2, 'set-stage'), stage: undefined },
    ],
  })

  assert.equal(record.result, 'rejected')
  assert.equal(record.selected_action, null)
  assert.deepEqual(
    record.rejected_options.map((rejection) => rejection.reason),
    ['revise requires a non-empty note.', 'set-stage requires a target stage.'],
  )
})

test('away mode skips infeasible options before selecting a rollback', () => {
  const root = createFixture()

  enableAwayMode(root)
  const state = blockedRun(root)
  const blocker = awayModeTrigger(state)

  assert.ok(blocker)
  const record = recordAwayEvaluation(root, state, blocker, {
    ranked_options: [
      { ...option(1, 'resume'), feasible: false },
      option(2, 'revise'),
    ],
  })

  assert.equal(record.result, 'accepted')
  assert.equal(record.selected_action?.action, 'revise')
  assert.deepEqual(record.rejected_options, [
    {
      rank: 1,
      reason: 'The evaluator marked this option infeasible.',
    },
  ])
})

test('away mode records evaluator process failures as rejected', () => {
  const root = createFixture()

  enableAwayMode(root)
  const state = blockedRun(root)
  const blocker = awayModeTrigger(state)

  assert.ok(blocker)
  const record = recordAwayEvaluationFailure(
    root,
    state,
    blocker,
    'The evaluator process ended before it returned options.',
    '2026-08-21T12:00:00.000Z',
  )

  assert.equal(record.result, 'rejected')
  assert.equal(record.selected_action, null)
  assert.equal(
    record.error,
    'The evaluator process ended before it returned options.',
  )
  assert.equal(readAwayDecisionLedger(root).length, 1)
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
    workflowSlug: 'dev',
    requestPath: 'request.md',
  })
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

test('away mode cannot approve a shipping checkpoint', () => {
  const root = createFixture()

  enableAwayMode(root, { allowed_actions: ['approve'] })
  const state = blockedRun(root)
  state.current_stage = 'ship'
  state.pending_action = {
    type: 'operator_approval',
    stage: 'ship',
    proposed_transition: 'complete',
  }
  const blocker = awayModeTrigger(state)

  assert.ok(blocker)
  const record = recordAwayEvaluation(root, state, blocker, {
    ranked_options: [option(1, 'approve')],
  })

  assert.equal(record.result, 'rejected')
  assert.equal(record.selected_action, null)
  assert.match(
    record.rejected_options[0]?.reason ?? '',
    /cannot approve shipping/u,
  )
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
  const root = createFixture()

  enableAwayMode(root)
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
  })

  state.stage_history.push(blockedHistoryItem('intake'))

  assert.equal(awayModeTrigger(state), null)

  state.status = 'paused'
  state.pending_action = { type: 'operator_decision' }

  const blocker = awayModeTrigger(state)

  assert.equal(blocker?.type, 'stage_blocked')
  assert.equal(blocker?.stage, 'intake')
})

test('the decision limit also bounds evaluator failure records', () => {
  const root = createFixture()

  enableAwayMode(root, { max_decisions_per_run: 1 })
  const state = blockedRun(root)
  const blocker = awayModeTrigger(state)

  assert.ok(blocker)
  recordAwayEvaluationFailure(root, state, blocker, 'The evaluator failed.')

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

    Atomics.wait(start, 0, 0)

    import(workerData.moduleUrl)
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
  const worker = new Worker(workerSource, {
    eval: true,
    workerData: {
      ...input,
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

  assert.equal(successes.length, 1)
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

test('away mode triggers only for named blocker classes', () => {
  const disabledRoot = createFixture()
  const disabled = createRun(disabledRoot, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
  })

  assert.equal(awayModeTrigger(disabled), null)

  const enabledRoot = createFixture()
  enableAwayMode(enabledRoot)
  const running = createRun(enabledRoot, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
  })

  assert.equal(awayModeTrigger(running), null)
  assert.equal(
    awayModeTrigger(running, {
      health: 'dead',
      summary: 'The process ended.',
    })?.type,
    'hypervisor_incident',
  )
})

test('a malformed ledger line fails with the ledger path', () => {
  const root = createFixture()
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
