/**
 * The supervisor is the authority for every away-mode decision, and the
 * hypervisor checks agent liveness only. These cases hold the four contracts
 * that rule rests on:
 *
 * - The removed `pan away` subcommands are refused.
 * - `pan away decide`, a hypervisor tick, a scheduled job, and a horizon
 *   checkpoint send no prompt to any agent except the horizon arbiter.
 * - The old away ledger is ignored and left byte-identical.
 * - A config that still carries the retired guardrail keys loads.
 *
 * Retired names are built from parts and removed subcommands travel as argv
 * elements, so this file adds no match to the removal trace search.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  awayDecisionLedgerPath,
  readAwayDecisionLedger,
} from '../../src/lib/away-mode.js'
import { pauseRun, prepareInvocation } from '../../src/lib/engine.js'
import {
  checkpointHorizonSession,
  initHorizonSession,
  nextHorizonTask,
  startHorizonSession,
} from '../../src/lib/horizon.js'
import {
  agentRegistryPath,
  readAgentRegistry,
} from '../../src/lib/hypervisor.js'
import { parseOperatorInvolvement } from '../../src/lib/operator-involvement.js'
import { resolveAwayModeConfig } from '../../src/lib/project-config.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import { scheduleTick } from '../../src/lib/schedule.js'
import { validateAwayDecisionLedger } from '../../src/lib/validators/autonomy-state.js'
import { createFixture, read, writeJson } from '../helpers.js'
import { AWAY, AWAY_ALL, checkpoint } from '../integration/delivery-helpers.js'
import { createRun } from '../run-helpers.js'

const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')
const ARBITER_MARKER = 'You are the arbiter of a long-horizon session'
const PROMPT_END = '--- prompt end ---'
const RETIRED_KEYS = [
  ['max', 'decisions', 'per', 'run'],
  ['max', 'remediation', 'attempts', 'per', 'agent'],
].map((parts) => parts.join('_'))

/**
 * Run `body` with a fake `cursor-agent` that logs every prompt it receives.
 * The arbiter receives a hard block so a horizon checkpoint settles in one
 * exchange; any other prompt receives `{ ok: true }`.
 */
function withLoggingAgent<T>(
  root: string,
  body: () => T,
): { result: T; prompts: string[] } {
  const binary = path.join(root, 'logging-cursor-agent')
  const log = path.join(root, 'cursor-agent-prompts.log')
  const quote = (text: string): string => `'${text.replaceAll("'", "'\\''")}'`
  const arbiterReply = JSON.stringify({
    session_id: 'arbiter-session',
    result: JSON.stringify({
      verdict: 'hard_block',
      hard_block: 'LH-H2',
      reasoning: 'The fixture declares no worker executor.',
    }),
  })
  const otherReply = JSON.stringify({
    session_id: 'agent-session',
    result: JSON.stringify({ ok: true }),
  })

  writeFileSync(
    binary,
    [
      '#!/bin/sh',
      'input=$(cat)',
      `printf '%s\\n%s\\n' "$input" ${quote(PROMPT_END)} >> ${quote(log)}`,
      'case "$input" in',
      `  *${quote(ARBITER_MARKER)}*) printf '%s\\n' ${quote(arbiterReply)} ;;`,
      `  *) printf '%s\\n' ${quote(otherReply)} ;;`,
      'esac',
      '',
    ].join('\n'),
  )
  chmodSync(binary, 0o755)

  const previous = process.env.PANCREATOR_CURSOR_AGENT_BIN

  process.env.PANCREATOR_CURSOR_AGENT_BIN = binary

  try {
    const result = body()
    const prompts = existsSync(log)
      ? readFileSync(log, 'utf8')
          .split(`${PROMPT_END}\n`)
          .filter((prompt) => prompt.trim().length > 0)
      : []

    return { result, prompts }
  } finally {
    if (previous === undefined) {
      delete process.env.PANCREATOR_CURSOR_AGENT_BIN
    } else {
      process.env.PANCREATOR_CURSOR_AGENT_BIN = previous
    }
  }
}

function pan(
  root: string,
  args: string[],
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [CLI, ...args, '--json'], {
    cwd: root,
    encoding: 'utf8',
  })

  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

/** An old-format away ledger the harness no longer reads. */
function writeOldLedger(root: string): { path: string; bytes: Buffer } {
  const file = path.join(
    root,
    'runtime',
    'logs',
    'away-mode',
    'decisions.jsonl',
  )
  const record = {
    schema_version: 1,
    decision_id: 'old-ledger-record',
    run_id: 'old-run',
    author: 'away',
    [['ranked', 'options'].join('_')]: [{ rank: 1, action: 'resume' }],
    result: 'accepted',
  }

  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(record)}\nnot json at all\n`)

  return { path: file, bytes: readFileSync(file) }
}

test('pan away refuses the removed subcommands on an existing run', () => {
  const { root, runId } = checkpoint(
    'planning@plan-awaiting-operator',
    AWAY_ALL,
  )
  const statePath = resolveRunLayout(root, runId).state.absolute
  const before = readFileSync(statePath)
  const { prompts } = withLoggingAgent(root, () => {
    for (const subcommand of ['evaluate', 'apply']) {
      const result = pan(root, ['away', subcommand, runId])

      assert.notEqual(result.status, 0, subcommand)
      assert.equal(
        (JSON.parse(result.stderr) as { error: string }).error,
        'UNKNOWN_COMMAND',
        subcommand,
      )
    }
  })

  assert.deepEqual(prompts, [])
  assert.deepEqual(readFileSync(statePath), before)
  assert.equal(existsSync(awayDecisionLedgerPath(root)), false)
})

test('decide, hypervisor tick, scheduled job, and horizon checkpoint prompt only the arbiter', () => {
  // A supervisor decision through the CLI.
  const gate = checkpoint('planning@plan-awaiting-operator', AWAY)
  const decided = withLoggingAgent(gate.root, () =>
    pan(gate.root, [
      'away',
      'decide',
      gate.runId,
      '--action',
      'approve',
      '--note',
      'Approve the ratified plan.',
    ]),
  )

  assert.equal(decided.result.status, 0, decided.result.stderr)
  assert.deepEqual(decided.prompts, [])

  // A hypervisor tick that quarantines a dead agent.
  const tickRoot = createFixture()

  writeJson(path.join(tickRoot, 'config.json'), {
    ...(read(path.join(tickRoot, 'config.json')) as Record<string, unknown>),
    away_mode: { enabled: true, guardrails: { allowed_actions: ['resume'] } },
  })

  const tickRun = createRun(tickRoot, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })

  prepareInvocation(tickRoot, tickRun.run_id)

  const registry = readAgentRegistry(tickRoot)

  writeJson(agentRegistryPath(tickRoot), {
    ...registry,
    agents: registry.agents.map((agent) => ({
      ...agent,
      process_id: 2_147_483_647,
      health: 'dead',
    })),
  })

  const ticked = withLoggingAgent(tickRoot, () =>
    pan(tickRoot, ['hypervisor', 'tick']),
  )

  assert.equal(ticked.result.status, 0, ticked.result.stderr)
  assert.equal(
    (
      JSON.parse(ticked.result.stdout) as {
        tick: { quarantine_events: unknown[] }
      }
    ).tick.quarantine_events.length,
    1,
  )
  assert.deepEqual(ticked.prompts, [])
  assert.deepEqual(readAwayDecisionLedger(tickRoot), [])

  // A scheduled workflow job driven by the real headless driver.
  const scheduleRoot = createFixture()

  writeJson(path.join(scheduleRoot, 'config.json'), {
    ...(read(path.join(scheduleRoot, 'config.json')) as Record<
      string,
      unknown
    >),
    schedule: {
      enabled: true,
      catch_up_window_minutes: 30,
      grace_period_minutes: 30,
      jobs: [
        {
          id: 'planning-job',
          enabled: true,
          hour: 10,
          minute: 10,
          timezone: 'UTC',
          workspace: '.',
          action: {
            kind: 'workflow',
            workflow: 'planning',
            request_path: 'request.md',
            involvement: 'long-horizon',
          },
        },
      ],
    },
  })

  const scheduled = withLoggingAgent(scheduleRoot, () =>
    scheduleTick(scheduleRoot, { now: new Date('2026-01-05T10:10:02.137Z') }),
  )

  assert.equal(scheduled.result.decisions.length, 1)
  assert.deepEqual(
    scheduled.prompts.filter((prompt) => !prompt.includes(ARBITER_MARKER)),
    [],
  )
  assert.deepEqual(readAwayDecisionLedger(scheduleRoot), [])

  // A headless horizon checkpoint at a gate pause, beside an old ledger.
  const horizonRoot = createFixture()
  const requestPath = path.posix.join('runtime', 'inbox', 'queue', 'first.md')

  mkdirSync(path.join(horizonRoot, 'runtime', 'inbox', 'queue'), {
    recursive: true,
  })
  writeFileSync(path.join(horizonRoot, requestPath), '# Request for first\n')
  writeJson(path.join(horizonRoot, 'runtime', 'queue.json'), {
    schema_version: 1,
    tasks: [
      {
        id: 'first',
        title: 'first task',
        kind: 'workflow',
        workflow: 'planning',
        request_path: requestPath,
      },
    ],
  })

  const oldLedger = writeOldLedger(horizonRoot)
  const session = initHorizonSession(horizonRoot, 'runtime/queue.json', {
    sessionId: 'authority-session',
    involvement: 'long-horizon',
  })

  startHorizonSession(horizonRoot, session.session_id, {
    attestSupervisorCard: true,
  })

  const opened = nextHorizonTask(horizonRoot, session.session_id)
  const runId = opened.run?.run_id as string
  const checkpointed = withLoggingAgent(horizonRoot, () => {
    pauseRun(horizonRoot, runId, 'A blocker holds the run.')

    return checkpointHorizonSession(horizonRoot, session.session_id)
  })

  assert.match(
    checkpointed.result.driven.handoff_reason ?? '',
    /^The run waits for a supervisor away-mode decision: /u,
  )
  assert.ok(checkpointed.prompts.length > 0)

  for (const prompt of checkpointed.prompts) {
    assert.ok(prompt.includes(ARBITER_MARKER), prompt.slice(0, 200))
    assert.doesNotMatch(prompt, /old-ledger-record/u)
  }

  assert.deepEqual(readFileSync(oldLedger.path), oldLedger.bytes)
})

test('the old away ledger is ignored and left byte-identical', () => {
  const { root, runId } = checkpoint(
    'planning@plan-awaiting-operator',
    AWAY_ALL,
  )
  const oldLedger = writeOldLedger(root)
  const status = pan(root, ['away', 'status', runId])

  assert.equal(status.status, 0, status.stderr)
  assert.equal(
    (JSON.parse(status.stdout) as { decisions: number }).decisions,
    0,
  )

  const decided = pan(root, [
    'away',
    'decide',
    runId,
    '--action',
    'revise',
    '--note',
    'Narrow the plan.',
  ])

  assert.equal(decided.status, 0, decided.stderr)
  assert.deepEqual(
    readAwayDecisionLedger(root).map((record) => record.decision_id),
    [
      (JSON.parse(decided.stdout) as { decision: { decision_id: string } })
        .decision.decision_id,
    ],
  )
  assert.equal(
    validateAwayDecisionLedger({ root } as Parameters<
      typeof validateAwayDecisionLedger
    >[0]).status,
    'passed',
  )
  assert.deepEqual(readFileSync(oldLedger.path), oldLedger.bytes)
})

test('a config that still carries the retired guardrail keys loads', () => {
  const root = createFixture()
  const retired = Object.fromEntries(RETIRED_KEYS.map((key) => [key, 3]))
  const guardrails = { allowed_actions: ['approve', 'resume'], ...retired }
  const overridesPath = path.join(root, 'config_overrides.json')

  writeJson(overridesPath, { away_mode: { enabled: true, guardrails } })

  const overrides = readFileSync(overridesPath)

  assert.deepEqual(resolveAwayModeConfig(root).guardrails, {
    allowed_actions: ['approve', 'resume'],
  })
  assert.deepEqual(
    parseOperatorInvolvement({
      operator_involvement: {
        active: 'away',
        profiles: {
          away: {
            summary: 'Away with retired keys.',
            away_mode: { enabled: true, guardrails },
          },
        },
      },
    }).profiles.away?.away_mode?.guardrails,
    { allowed_actions: ['approve', 'resume'] },
  )

  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })

  assert.deepEqual(state.away_mode?.guardrails, {
    allowed_actions: ['approve', 'resume'],
  })
  assert.deepEqual(readFileSync(overridesPath), overrides)
})
