import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { submitOutput } from '../../src/lib/engine.js'
import {
  DELEGATION_CADENCE_EXTENDED,
  formatSessionStartLine,
  readWatchRecord,
  watchInvocation,
  watchRecordPath,
} from '../../src/lib/watch.js'
import {
  fillPreparedOutput,
  multiplexedTargets,
  preparedRun,
  writeAgentStateEvidence,
} from './watch-helpers.js'
import { runCli } from './watch-repair-helpers.js'

test('AC-001: cadence authority', () => {
  // The default needs no authority and resolves to the one 60-second cadence.
  const defaultRun = preparedRun()

  fillPreparedOutput(defaultRun.root, defaultRun.state)

  const defaultEvidence = writeAgentStateEvidence(
    defaultRun.root,
    defaultRun.state,
    defaultRun.invocationId,
  )
  const defaultResult = runCli(defaultRun.root, [
    'watch',
    defaultRun.state.run_id,
    '--agent-state',
    'completed',
    '--agent-state-evidence',
    defaultEvidence,
    '--json',
  ])

  assert.equal(defaultResult.status, 0, defaultResult.stderr)
  assert.equal(
    readWatchRecord(
      defaultRun.root,
      defaultRun.state.run_id,
      defaultRun.invocationId,
    )[0]?.cadence_seconds,
    60,
  )

  // An undirected exception is refused before anything is written.
  const undirected = preparedRun()
  const refused = runCli(undirected.root, [
    'watch',
    undirected.state.run_id,
    '--cadence-seconds',
    '300',
    '--json',
  ])

  assert.notEqual(refused.status, 0)
  assert.match(refused.stderr, /WATCH_CADENCE_UNAUTHORIZED/u)
  assert.equal(
    existsSync(
      path.join(
        undirected.root,
        watchRecordPath(
          undirected.root,
          undirected.state.run_id,
          undirected.invocationId,
        ),
      ),
    ),
    false,
    'a refused cadence writes no ledger',
  )

  // An empty reason is no authority.
  const empty = preparedRun()
  const emptyResult = runCli(empty.root, [
    'watch',
    empty.state.run_id,
    '--cadence-seconds',
    '300',
    '--cadence-directed-by-operator',
    '   ',
    '--json',
  ])

  assert.notEqual(emptyResult.status, 0)
  assert.match(emptyResult.stderr, /WATCH_CADENCE_UNAUTHORIZED/u)

  // A directed exception is recorded on the session it authorizes.
  const directed = preparedRun()

  fillPreparedOutput(directed.root, directed.state)

  const directedEvidence = writeAgentStateEvidence(
    directed.root,
    directed.state,
    directed.invocationId,
  )
  const directedResult = runCli(directed.root, [
    'watch',
    directed.state.run_id,
    '--cadence-seconds',
    '300',
    '--cadence-directed-by-operator',
    'operator directed 300s for the slow suite',
    '--agent-state',
    'completed',
    '--agent-state-evidence',
    directedEvidence,
    '--json',
  ])

  assert.equal(directedResult.status, 0, directedResult.stderr)

  const sessionStart = readWatchRecord(
    directed.root,
    directed.state.run_id,
    directed.invocationId,
  ).find((entry) => entry.event === 'session_started')

  assert.equal(sessionStart?.cadence_seconds, 300)
  assert.equal(
    sessionStart?.cadence_authority,
    'operator directed 300s for the slow suite',
  )
})

test('AC-002: cadence floor', () => {
  const authority = ['--cadence-directed-by-operator', 'floor probe']

  for (const [value, code] of [
    ['0', 'WATCH_CADENCE_BELOW_MINIMUM'],
    ['-1', 'WATCH_CADENCE_BELOW_MINIMUM'],
    ['0.049', 'WATCH_CADENCE_BELOW_MINIMUM'],
    ['Infinity', 'WATCH_CADENCE_BELOW_MINIMUM'],
    ['NaN', 'INVALID_ARGUMENT'],
  ] as const) {
    const { root, state } = preparedRun()
    const result = runCli(root, [
      'watch',
      state.run_id,
      '--cadence-seconds',
      value,
      ...authority,
      '--json',
    ])

    assert.notEqual(result.status, 0, `${value} must be refused`)
    assert.match(result.stderr, new RegExp(code), value)
  }

  // The floor itself is accepted with its authority, with no test-only bypass.
  const { root, state, invocationId } = preparedRun()

  fillPreparedOutput(root, state)

  const evidence = writeAgentStateEvidence(root, state, invocationId)
  const accepted = runCli(root, [
    'watch',
    state.run_id,
    '--cadence-seconds',
    '0.05',
    ...authority,
    '--agent-state',
    'completed',
    '--agent-state-evidence',
    evidence,
    '--json',
  ])

  assert.equal(accepted.status, 0, accepted.stderr)
  assert.equal(JSON.parse(accepted.stdout).cadence_seconds, 0.05)
})

test('AC-003: submitted cadence', async () => {
  const { root, state, invocationId, outputPath } = preparedRun()

  fillPreparedOutput(root, state)

  const evidence = writeAgentStateEvidence(root, state, invocationId)

  // A 60-second session, then a directed 300-second session: the submitted
  // record must retain the exception rather than the ledger's first cadence.
  await watchInvocation(root, state.run_id, {
    agentState: 'completed',
    agentStateEvidence: evidence,
  })
  await watchInvocation(root, state.run_id, {
    cadenceSeconds: 300,
    cadenceAuthority: 'operator directed 300s for the slow suite',
    agentState: 'completed',
    agentStateEvidence: evidence,
  })

  const submitted = submitOutput(root, state.run_id, outputPath)
  const watch = submitted.record.delegation_observation?.watch

  assert.ok(watch)
  assert.deepEqual(watch.cadence_exceptions, [
    {
      cadence_seconds: 300,
      authority: 'operator directed 300s for the slow suite',
    },
  ])

  const advisory = submitted.advisories.find((item) =>
    item.message.includes(DELEGATION_CADENCE_EXTENDED),
  )

  assert.ok(advisory, 'an extended cadence is advised even when directed')
  assert.match(advisory.message, /300s/u)
  assert.match(advisory.message, /operator directed 300s/u)
  assert.match(advisory.message, new RegExp(state.run_id, 'u'))
  assert.match(advisory.message, new RegExp(invocationId, 'u'))
})

test('AC-008: timeout bounds', () => {
  // A true short timeout is refused on a pending fixture, before observation.
  const pending = preparedRun()
  const shortPending = runCli(pending.root, [
    'watch',
    pending.state.run_id,
    '--timeout-seconds',
    '30',
    '--json',
  ])

  assert.notEqual(shortPending.status, 0)
  assert.match(shortPending.stderr, /WATCH_TIMEOUT_BELOW_CADENCE/u)
  assert.equal(
    existsSync(
      path.join(
        pending.root,
        watchRecordPath(
          pending.root,
          pending.state.run_id,
          pending.invocationId,
        ),
      ),
    ),
    false,
    'a refused bound appends no wake',
  )

  // The already-complete fixture takes the same refusal: no initial-output
  // shortcut skips the bound check.
  const complete = preparedRun()

  fillPreparedOutput(complete.root, complete.state)

  const completeEvidence = writeAgentStateEvidence(
    complete.root,
    complete.state,
    complete.invocationId,
  )
  const shortComplete = runCli(complete.root, [
    'watch',
    complete.state.run_id,
    '--timeout-seconds',
    '30',
    '--agent-state',
    'completed',
    '--agent-state-evidence',
    completeEvidence,
    '--json',
  ])

  assert.notEqual(shortComplete.status, 0)
  assert.match(shortComplete.stderr, /WATCH_TIMEOUT_BELOW_CADENCE/u)

  // The intake's genuine counterexample: a directed 5-second cadence with a
  // 4-second timeout is a true short bound.
  const directed = preparedRun()

  fillPreparedOutput(directed.root, directed.state)

  const directedEvidence = writeAgentStateEvidence(
    directed.root,
    directed.state,
    directed.invocationId,
  )
  const shortDirected = runCli(directed.root, [
    'watch',
    directed.state.run_id,
    '--cadence-seconds',
    '5',
    '--cadence-directed-by-operator',
    'fast fixture',
    '--timeout-seconds',
    '4',
    '--agent-state',
    'completed',
    '--agent-state-evidence',
    directedEvidence,
    '--json',
  ])

  assert.notEqual(shortDirected.status, 0)
  assert.match(shortDirected.stderr, /WATCH_TIMEOUT_BELOW_CADENCE/u)

  // The intake's original 5/6 case fails on cadence authority, not on the
  // bound: six exceeds five, so the timeout itself is valid.
  const undirected = preparedRun()
  const undirectedResult = runCli(undirected.root, [
    'watch',
    undirected.state.run_id,
    '--cadence-seconds',
    '5',
    '--timeout-seconds',
    '6',
    '--json',
  ])

  assert.notEqual(undirectedResult.status, 0)
  assert.match(undirectedResult.stderr, /WATCH_CADENCE_UNAUTHORIZED/u)

  // Equality passes the bound validation.
  const equal = preparedRun()

  fillPreparedOutput(equal.root, equal.state)

  const equalEvidence = writeAgentStateEvidence(
    equal.root,
    equal.state,
    equal.invocationId,
  )
  const equalResult = runCli(equal.root, [
    'watch',
    equal.state.run_id,
    '--timeout-seconds',
    '60',
    '--agent-state',
    'completed',
    '--agent-state-evidence',
    equalEvidence,
    '--json',
  ])

  assert.equal(equalResult.status, 0, equalResult.stderr)
})

test('AC-009: stall bound', async () => {
  // A wake count of 1 is refused by name, in the focused form.
  const one = preparedRun()
  const refused = runCli(one.root, [
    'watch',
    one.state.run_id,
    '--stall-wakes',
    '1',
    '--json',
  ])

  assert.notEqual(refused.status, 0)
  assert.match(refused.stderr, /WATCH_STALL_WAKES_TOO_SMALL/u)

  // ... and in the multiplexed form.
  const multi = multiplexedTargets(2)
  const targetArgument = multi.targets
    .map((target) => `${target.runId}:${target.invocationId}`)
    .join(',')
  const refusedMulti = runCli(multi.root, [
    'watch',
    '--targets',
    targetArgument,
    '--stall-wakes',
    '1',
    '--json',
  ])

  assert.notEqual(refusedMulti.status, 0)
  assert.match(refusedMulti.stderr, /WATCH_STALL_WAKES_TOO_SMALL/u)

  // Malformed and conflicting forms are argument errors.
  const malformed = runCli(one.root, [
    'watch',
    one.state.run_id,
    '--stall-wakes',
    'abc',
    '--json',
  ])

  assert.notEqual(malformed.status, 0)
  assert.match(malformed.stderr, /INVALID_ARGUMENT/u)

  const conflict = runCli(one.root, [
    'watch',
    one.state.run_id,
    '--stall-wakes',
    '2',
    '--stall-timeout-seconds',
    '5',
    '--json',
  ])

  assert.notEqual(conflict.status, 0)
  assert.match(conflict.stderr, /INVALID_ARGUMENT/u)

  // A supported count converts to a duration against the resolved cadence.
  const converted = preparedRun()

  fillPreparedOutput(converted.root, converted.state)

  const convertedEvidence = writeAgentStateEvidence(
    converted.root,
    converted.state,
    converted.invocationId,
  )
  const accepted = runCli(converted.root, [
    'watch',
    converted.state.run_id,
    '--stall-wakes',
    '2',
    '--agent-state',
    'completed',
    '--agent-state-evidence',
    convertedEvidence,
    '--json',
  ])

  assert.equal(accepted.status, 0, accepted.stderr)
  assert.equal(JSON.parse(accepted.stdout).stall_timeout_seconds, 120)

  // No flag keeps the five-minute default.
  const defaulted = preparedRun()

  fillPreparedOutput(defaulted.root, defaulted.state)

  const defaultedEvidence = writeAgentStateEvidence(
    defaulted.root,
    defaulted.state,
    defaulted.invocationId,
  )
  const defaultResult = runCli(defaulted.root, [
    'watch',
    defaulted.state.run_id,
    '--agent-state',
    'completed',
    '--agent-state-evidence',
    defaultedEvidence,
    '--json',
  ])

  assert.equal(defaultResult.status, 0, defaultResult.stderr)
  assert.equal(JSON.parse(defaultResult.stdout).stall_timeout_seconds, 300)
})

test('AC-016: arming bound', async () => {
  // The default bound is named as the default.
  const defaulted = preparedRun()

  fillPreparedOutput(defaulted.root, defaulted.state)

  const defaultedEvidence = writeAgentStateEvidence(
    defaulted.root,
    defaulted.state,
    defaulted.invocationId,
  )
  const lines: string[] = []

  await watchInvocation(defaulted.root, defaulted.state.run_id, {
    agentState: 'completed',
    agentStateEvidence: defaultedEvidence,
    onSessionStart: (entry) => lines.push(formatSessionStartLine(entry)),
  })

  assert.equal(lines.length, 1)
  assert.match(lines[0] ?? '', /cadence 60s/u)
  assert.match(lines[0] ?? '', /timeout 3600s \(default bound\)/u)

  // An override names the exact value.
  const custom = preparedRun()

  fillPreparedOutput(custom.root, custom.state)

  const customEvidence = writeAgentStateEvidence(
    custom.root,
    custom.state,
    custom.invocationId,
  )
  const customLines: string[] = []
  const customResult = await watchInvocation(custom.root, custom.state.run_id, {
    agentState: 'completed',
    agentStateEvidence: customEvidence,
    timeoutSeconds: 90,
    onSessionStart: (entry) => customLines.push(formatSessionStartLine(entry)),
  })

  assert.match(customLines[0] ?? '', /timeout 90s/u)
  assert.doesNotMatch(customLines[0] ?? '', /default bound/u)
  // The machine result carries the same resolved bound.
  assert.equal(customResult.timeout_seconds, 90)

  const cli = runCli(custom.root, [
    'watch',
    custom.state.run_id,
    '--timeout-seconds',
    '90',
    '--agent-state',
    'completed',
    '--agent-state-evidence',
    customEvidence,
    '--json',
  ])

  assert.equal(cli.status, 0, cli.stderr)
  assert.equal(JSON.parse(cli.stdout).timeout_seconds, 90)

  // The arming line reaches a piped stderr, which is what an agent shell has.
  const piped = runCli(custom.root, [
    'watch',
    custom.state.run_id,
    '--timeout-seconds',
    '90',
    '--agent-state',
    'completed',
    '--agent-state-evidence',
    customEvidence,
  ])

  assert.equal(piped.status, 0, piped.stderr)
  assert.match(
    piped.stderr.split('\n')[0] ?? '',
    /armed at .*: cadence 60s, timeout 90s$/u,
  )
})
