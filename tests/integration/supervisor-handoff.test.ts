/**
 * Integration tests for AC-5, AC-11, AC-12, AC-13, AC-14: run-layer
 * eligibility, note writing, record transitions, and fence behavior.
 *
 * These tests use a real fixture tree (no Swift helper or UI).
 * AC-20 is operator-owned and recorded as environment-blocked.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { runHandoffDriver } from '../../src/lib/cursor-handoff/driver.js'
import {
  ensureHelper,
  findSwiftc,
  SWIFT_SOURCE_RELATIVE,
} from '../../src/lib/cursor-handoff/helper.js'
import { PanError } from '../../src/lib/errors.js'
import { resolveInside } from '../../src/lib/io.js'
import { renderStatus } from '../../src/lib/render.js'
import { loadState } from '../../src/lib/state.js'
import { persist } from '../../src/lib/state.js'
import { acquireWatchLock, watchLockPath } from '../../src/lib/watch.js'
import {
  applyHandoffAccepted,
  appendSendingRecord,
  checkHandoffEligibility,
  markHandoffAborted,
  markHandoffSent,
  prepareHandoff,
  latestHandoffRecord,
  sendingRecordCallback,
  type SendingRecordAttempt,
} from '../../src/lib/supervisor-handoff.js'
import {
  assertSupervisorCardAttested,
  attestSupervisorCard,
} from '../../src/lib/governance/supervisor-card.js'
import {
  EFFORT,
  MODEL,
  makeStatefulBridge,
} from '../fixtures/cursor-handoff/fake-bridge.js'
import { createFixture } from '../helpers.js'
import { createRun } from '../run-helpers.js'
import { createTestTempDirectory } from '../temp.js'
import type { RunState, SupervisorHandoffRecord } from '../../src/lib/types.js'

// ---------------------------------------------------------------------------
// Helper: mutate run state directly for eligibility test setup
// ---------------------------------------------------------------------------

function runningRun(root: string): RunState {
  return createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })
}

function terminalRun(
  root: string,
  status: 'succeeded' | 'failed' | 'canceled',
): RunState {
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })
  state.status = status
  persist(root, state, 'test_terminal')
  return loadState(root, state.run_id)
}

function sessionBoundRun(root: string): RunState {
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })
  state.cohort = { cohort_id: 'test-cohort', cohort_index: 1, chunk: 'chunk-1' }
  persist(root, state, 'test_session_bound')
  return loadState(root, state.run_id)
}

function workerInFlightRun(root: string): RunState {
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })
  state.pending_action = {
    type: 'invoke_agent',
    persona: 'coder',
    path: 'test.md',
  }
  persist(root, state, 'test_worker_in_flight')
  return loadState(root, state.run_id)
}

function pendingHandoffRun(root: string, status: 'sending' | 'sent'): RunState {
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })
  state.supervisor_handoffs = [
    {
      id: 'test-handoff-id',
      status,
      from_session_generation: state.supervisor_card?.session_generation ?? 0,
      prompt: '/pan-resume test',
      model: 'Claude Opus 5.5',
      effort: 'High',
      initiated_at: new Date().toISOString(),
    },
  ]
  persist(root, state, 'test_pending_handoff')
  return loadState(root, state.run_id)
}

// ---------------------------------------------------------------------------
// AC-11: Eligibility checks
// ---------------------------------------------------------------------------

test('AC-11: running run with clean pending_action is eligible', () => {
  const root = createFixture()
  const state = runningRun(root)
  const result = checkHandoffEligibility(root, state)
  assert.ok(result.ok, `Expected ok but got: ${result.message ?? ''}`)
})

test('AC-11: succeeded run is refused with HANDOFF_RUN_TERMINAL', () => {
  const root = createFixture()
  const state = terminalRun(root, 'succeeded')
  const result = checkHandoffEligibility(root, state)
  assert.equal(result.ok, false)
  assert.equal(result.code, 'HANDOFF_RUN_TERMINAL')
})

test('AC-11: failed run is refused with HANDOFF_RUN_TERMINAL', () => {
  const root = createFixture()
  const state = terminalRun(root, 'failed')
  const result = checkHandoffEligibility(root, state)
  assert.equal(result.ok, false)
  assert.equal(result.code, 'HANDOFF_RUN_TERMINAL')
})

test('AC-11: session-bound run is refused with HANDOFF_SESSION_UNSUPPORTED', () => {
  const root = createFixture()
  const state = sessionBoundRun(root)
  const result = checkHandoffEligibility(root, state)
  assert.equal(result.ok, false)
  assert.equal(result.code, 'HANDOFF_SESSION_UNSUPPORTED')
})

test('AC-11: worker in-flight run is refused with HANDOFF_WORKER_IN_FLIGHT', () => {
  const root = createFixture()
  const state = workerInFlightRun(root)
  const result = checkHandoffEligibility(root, state)
  assert.equal(result.ok, false)
  assert.equal(result.code, 'HANDOFF_WORKER_IN_FLIGHT')
})

test('AC-11: run with sending handoff is refused with HANDOFF_ALREADY_PENDING', () => {
  const root = createFixture()
  const state = pendingHandoffRun(root, 'sending')
  const result = checkHandoffEligibility(root, state)
  assert.equal(result.ok, false)
  assert.equal(result.code, 'HANDOFF_ALREADY_PENDING')
})

test('AC-11: run with sent handoff is refused with HANDOFF_ALREADY_PENDING', () => {
  const root = createFixture()
  const state = pendingHandoffRun(root, 'sent')
  const result = checkHandoffEligibility(root, state)
  assert.equal(result.ok, false)
  assert.equal(result.code, 'HANDOFF_ALREADY_PENDING')
})

test('AC-11: a live pan watch lock refuses with HANDOFF_WATCH_OPEN', () => {
  const root = createFixture()
  const state = runningRun(root)
  const lock = acquireWatchLock(
    root,
    state.run_id,
    '01_implement-1_live',
    'sess',
  )

  try {
    const result = checkHandoffEligibility(root, state)
    assert.equal(result.ok, false)
    assert.equal(result.code, 'HANDOFF_WATCH_OPEN')
  } finally {
    lock.release()
  }
})

test('AC-11: a watch lock whose owner is dead stays eligible', () => {
  const root = createFixture()
  const state = runningRun(root)
  const lockAbsolute = resolveInside(
    root,
    watchLockPath(root, state.run_id, '01_implement-1_dead'),
  )

  mkdirSync(path.dirname(lockAbsolute), { recursive: true })
  writeFileSync(
    lockAbsolute,
    `${JSON.stringify({
      schema_version: 1,
      run_id: state.run_id,
      invocation_id: '01_implement-1_dead',
      watch_session_id: 'dead-session',
      pid: 2 ** 22 + 17,
      process_identity: null,
      armed_at: new Date().toISOString(),
    })}\n`,
  )

  const result = checkHandoffEligibility(root, state)
  assert.ok(result.ok, `Expected ok but got: ${result.message ?? ''}`)
})

// AC-11: accepted statuses pass
for (const status of [
  'awaiting_supervisor',
  'awaiting_operator',
  'paused',
] as const) {
  test(`AC-11: ${status} run is eligible`, () => {
    const root = createFixture()
    const state = runningRun(root)
    state.status = status
    persist(root, state, `test_${status}`)
    const fresh = loadState(root, state.run_id)
    const result = checkHandoffEligibility(root, fresh)
    assert.ok(result.ok, `${status} should be eligible`)
  })
}

// ---------------------------------------------------------------------------
// AC-12: Note required for non-dry-run; note written to evidence before UI
// ---------------------------------------------------------------------------

test('AC-12: prepareHandoff throws HANDOFF_NOTE_MISSING without note in non-dry-run', () => {
  const root = createFixture()
  const state = runningRun(root)

  assert.throws(
    () =>
      prepareHandoff(root, {
        runId: state.run_id,
        prompt: `/pan-resume ${state.run_id}`,
        model: 'Claude Opus 5.5',
        effort: 'High',
        dryRun: false,
      }),
    (err: unknown) => {
      assert.ok(err instanceof Error)
      const e = err as { code?: string }
      assert.equal(e.code, 'HANDOFF_NOTE_MISSING')
      return true
    },
  )
})

test('AC-12: prepareHandoff writes note to evidence before returning', () => {
  const root = createFixture()
  const state = runningRun(root)

  const result = prepareHandoff(root, {
    runId: state.run_id,
    prompt: `/pan-resume ${state.run_id}`,
    model: 'Claude Opus 5.5',
    effort: 'High',
    note: 'Test note content',
    dryRun: false,
  })

  assert.ok(typeof result.notePath === 'string', 'notePath must be set')
  const noteAbsolute = path.join(root, result.notePath!)
  assert.ok(existsSync(noteAbsolute), 'note file must exist on disk')
})

test('AC-12: dry-run does not require a note', () => {
  const root = createFixture()
  const state = runningRun(root)

  const result = prepareHandoff(root, {
    runId: state.run_id,
    prompt: `/pan-resume ${state.run_id}`,
    model: 'Claude Opus 5.5',
    effort: 'High',
    dryRun: true,
  })

  // Should succeed without note
  assert.ok(typeof result.handoffId === 'string')
})

// ---------------------------------------------------------------------------
// AC-5: Dry-run leaves run state unchanged
// ---------------------------------------------------------------------------

test('AC-5: dry-run prepareHandoff does not change run revision', () => {
  const root = createFixture()
  const state = runningRun(root)
  const revisionBefore = state.revision

  prepareHandoff(root, {
    runId: state.run_id,
    prompt: `/pan-resume ${state.run_id}`,
    model: 'Claude Opus 5.5',
    effort: 'High',
    dryRun: true,
  })

  const fresh = loadState(root, state.run_id)
  assert.equal(
    fresh.revision,
    revisionBefore,
    'dry-run must not change run revision',
  )
  assert.equal(
    fresh.supervisor_handoffs ?? null,
    null,
    'dry-run must not write handoff records',
  )
})

// ---------------------------------------------------------------------------
// AC-13: sending/sent record with required fields
// ---------------------------------------------------------------------------

test('AC-13: appendSendingRecord writes a sending record with all required fields', () => {
  const root = createFixture()
  const state = runningRun(root)
  const generation = state.supervisor_card?.session_generation ?? 0
  const handoffId = 'test-sending-id'

  appendSendingRecord(root, state.run_id, {
    id: handoffId,
    from_session_generation: generation,
    prompt: `/pan-resume ${state.run_id}`,
    model: 'Claude Opus 5.5',
    effort: 'High',
    initiated_at: new Date().toISOString(),
    note_path: 'runtime/logs/test/note.md',
  })

  const fresh = loadState(root, state.run_id)
  const latest = latestHandoffRecord(fresh)

  assert.ok(latest, 'should have a handoff record')
  assert.equal(latest?.status, 'sending')
  assert.equal(latest?.id, handoffId)
  assert.equal(latest?.from_session_generation, generation)
  assert.equal(latest?.prompt, `/pan-resume ${state.run_id}`)
  assert.equal(latest?.model, 'Claude Opus 5.5')
  assert.equal(latest?.effort, 'High')
  assert.ok(typeof latest?.initiated_at === 'string')
  assert.equal(latest?.note_path, 'runtime/logs/test/note.md')
})

test('AC-13: markHandoffSent transitions to sent with verified_label and sent_at', () => {
  const root = createFixture()
  const state = runningRun(root)
  const handoffId = 'test-sent-id'
  const generation = state.supervisor_card?.session_generation ?? 0

  appendSendingRecord(root, state.run_id, {
    id: handoffId,
    from_session_generation: generation,
    prompt: `/pan-resume ${state.run_id}`,
    model: 'Claude Opus 5.5',
    effort: 'High',
    initiated_at: new Date().toISOString(),
  })

  markHandoffSent(root, state.run_id, handoffId, 'Claude Opus 5.5 High')

  const fresh = loadState(root, state.run_id)
  const latest = latestHandoffRecord(fresh)

  assert.equal(latest?.status, 'sent')
  assert.equal(latest?.verified_label, 'Claude Opus 5.5 High')
  assert.ok(typeof latest?.sent_at === 'string', 'sent_at must be set')
})

// ---------------------------------------------------------------------------
// AC-14: Fence: prepare and submit refused while sending/sent
// ---------------------------------------------------------------------------

test('AC-14: assertSupervisorCardAttested throws SUPERVISOR_HANDED_OFF while handoff is sent', () => {
  const root = createFixture()
  const state = runningRun(root)
  const generation = state.supervisor_card?.session_generation ?? 0
  const handoffId = 'test-fence-id'

  appendSendingRecord(root, state.run_id, {
    id: handoffId,
    from_session_generation: generation,
    prompt: `/pan-resume ${state.run_id}`,
    model: 'Claude Opus 5.5',
    effort: 'High',
    initiated_at: new Date().toISOString(),
  })

  markHandoffSent(root, state.run_id, handoffId, 'Claude Opus 5.5 High')

  const fresh = loadState(root, state.run_id)

  assert.throws(
    () => assertSupervisorCardAttested(root, fresh, 'prepare'),
    (err: unknown) => {
      assert.ok(err instanceof Error)
      const e = err as { code?: string }
      assert.equal(e.code, 'SUPERVISOR_HANDED_OFF')
      return true
    },
  )
})

test('AC-14: fence is lifted after markHandoffAborted', () => {
  const root = createFixture()
  const state = runningRun(root)
  const generation = state.supervisor_card?.session_generation ?? 0
  const handoffId = 'test-abort-id'

  appendSendingRecord(root, state.run_id, {
    id: handoffId,
    from_session_generation: generation,
    prompt: `/pan-resume ${state.run_id}`,
    model: 'Claude Opus 5.5',
    effort: 'High',
    initiated_at: new Date().toISOString(),
  })

  markHandoffAborted(root, state.run_id, handoffId, 'HANDOFF_PRESS_FAILED')

  const fresh = loadState(root, state.run_id)
  const latest = latestHandoffRecord(fresh)

  assert.equal(latest?.status, 'aborted')
  assert.equal(latest?.aborted_code, 'HANDOFF_PRESS_FAILED')

  // assertSupervisorCardAttested must not throw (fence is lifted)
  // The card may be unattested for other reasons (e.g. SUPERVISOR_CARD_UNATTESTED)
  // but SUPERVISOR_HANDED_OFF must not be thrown
  let threwHandedOff = false
  try {
    assertSupervisorCardAttested(root, fresh, 'prepare')
  } catch (err: unknown) {
    const e = err as { code?: string }
    if (e.code === 'SUPERVISOR_HANDED_OFF') {
      threwHandedOff = true
    }
    // Other errors (SUPERVISOR_CARD_UNATTESTED etc.) are expected
  }
  assert.ok(
    !threwHandedOff,
    'SUPERVISOR_HANDED_OFF must not be thrown after abort',
  )
})

test('AC-14: applyHandoffAccepted marks record accepted and records new session generation', () => {
  const root = createFixture()
  const state = runningRun(root)
  const generation = state.supervisor_card?.session_generation ?? 0

  state.supervisor_handoffs = [
    {
      id: 'test-accept-id',
      status: 'sent',
      from_session_generation: generation,
      prompt: `/pan-resume ${state.run_id}`,
      model: 'Claude Opus 5.5',
      effort: 'High',
      initiated_at: new Date().toISOString(),
      sent_at: new Date().toISOString(),
      verified_label: 'Claude Opus 5.5 High',
    },
  ]

  const acceptedId = applyHandoffAccepted(state, generation + 1)

  assert.equal(acceptedId, 'test-accept-id')
  const latest = latestHandoffRecord(state)
  assert.equal(latest?.status, 'accepted')
  assert.equal(latest?.accepted_session_generation, generation + 1)
})

// ---------------------------------------------------------------------------
// AC-1, AC-4, AC-12: the `pan handoff` command entry point
// ---------------------------------------------------------------------------

function panHandoff(
  root: string,
  args: string[],
): { status: number | null; error: { error?: string; message?: string } } {
  const result = spawnSync(
    process.execPath,
    [path.join(process.cwd(), 'dist', 'src', 'cli.js'), 'handoff', ...args],
    { cwd: root, encoding: 'utf8', timeout: 60_000 },
  )

  return {
    status: result.status,
    error: JSON.parse(result.stderr || '{}') as {
      error?: string
      message?: string
    },
  }
}

test('AC-1: pan handoff reads the run id before trailing flags', () => {
  const root = createFixture()
  const result = panHandoff(root, ['missing-run', '--dry-run', '--json'])

  assert.equal(result.status, 1)
  assert.equal(result.error.error, 'RUN_NOT_FOUND')
  assert.match(result.error.message ?? '', /Unknown run: missing-run/u)
})

test('AC-1: pan handoff refuses an undeclared option', () => {
  const root = createFixture()
  const result = panHandoff(root, ['missing-run', '--bogus'])

  assert.equal(result.status, 1)
  assert.equal(result.error.error, 'INVALID_ARGUMENT')
  assert.match(result.error.message ?? '', /--bogus/u)
})

test('AC-12: pan handoff without a note refuses with HANDOFF_NOTE_MISSING', () => {
  const root = createFixture()
  const state = runningRun(root)
  const result = panHandoff(root, [state.run_id, '--json'])

  assert.equal(result.status, 1)
  assert.equal(result.error.error, 'HANDOFF_NOTE_MISSING')
})

test('AC-10: --capture-tree outside runtime/ is refused before the helper runs', () => {
  const root = createFixture()
  const result = panHandoff(root, [
    '--self-check',
    '--capture-tree',
    'src/cli.ts',
    '--json',
  ])

  assert.equal(result.status, 1)
  assert.equal(result.error.error, 'INVALID_ARGUMENT')
  assert.match(result.error.message ?? '', /under runtime\//u)
})

test('AC-10: --capture-tree refuses an existing file under runtime/', () => {
  const root = createFixture()
  const existing = 'runtime/capture-existing.json'
  writeFileSync(path.join(root, existing), '{}\n')

  const result = panHandoff(root, [
    '--self-check',
    '--capture-tree',
    existing,
    '--json',
  ])

  assert.equal(result.status, 1)
  assert.equal(result.error.error, 'INVALID_ARGUMENT')
  assert.match(result.error.message ?? '', /already exists/u)
})

// ---------------------------------------------------------------------------
// AC-13: the record exists before Send, through the driver
// ---------------------------------------------------------------------------

function preparedAttempt(root: string, runId: string): SendingRecordAttempt {
  const prompt = `/pan-resume ${runId}`
  const prepared = prepareHandoff(root, {
    runId,
    prompt,
    model: MODEL,
    effort: EFFORT,
    note: 'Resume at verify.',
  })

  return { ...prepared, prompt, model: MODEL, effort: EFFORT }
}

test('AC-13: the production pre-Send callback writes every record field before Send is pressed', async () => {
  const root = createFixture()
  const state = runningRun(root)
  const attempt = preparedAttempt(root, state.run_id)
  let recordAtSend: SupervisorHandoffRecord | null = null
  const { bridge } = makeStatefulBridge({
    onPress: (id) => {
      if (id === 'new-send') {
        recordAtSend = latestHandoffRecord(loadState(root, state.run_id))
      }
    },
  })

  const result = await runHandoffDriver({
    bridge,
    prompt: attempt.prompt,
    model: MODEL,
    effort: EFFORT,
    preSendCallback: sendingRecordCallback(root, state.run_id, attempt),
  })

  assert.equal(
    result.status,
    'sent',
    `${result.code ?? ''} ${result.error ?? ''}`,
  )
  const record = recordAtSend as SupervisorHandoffRecord | null
  assert.ok(record, 'the sending record exists when Send is pressed')
  assert.equal(record.status, 'sending')
  assert.equal(record.id, attempt.handoffId)
  assert.equal(record.from_session_generation, attempt.fromSessionGeneration)
  assert.equal(record.prompt, attempt.prompt)
  assert.equal(record.model, MODEL)
  assert.equal(record.effort, EFFORT)
  assert.equal(record.verified_label, `${MODEL} ${EFFORT}`)
  assert.equal(typeof record.initiated_at, 'string')
  assert.equal(record.evidence_path, attempt.evidencePath)
  assert.equal(record.note_path, attempt.notePath)
})

test('C-2: a second concurrent handoff refuses at its pre-Send write and never presses Send', async () => {
  const root = createFixture()
  const state = runningRun(root)
  const first = preparedAttempt(root, state.run_id)
  const second = preparedAttempt(root, state.run_id)

  const firstOutcome = await sendingRecordCallback(
    root,
    state.run_id,
    first,
  )({ verifiedLabel: `${MODEL} ${EFFORT}` })
  assert.deepEqual(firstOutcome, { ok: true })

  const { bridge, pressLog } = makeStatefulBridge()
  const result = await runHandoffDriver({
    bridge,
    prompt: second.prompt,
    model: MODEL,
    effort: EFFORT,
    preSendCallback: sendingRecordCallback(root, state.run_id, second),
  })

  assert.equal(result.status, 'aborted')
  assert.equal(result.code, 'HANDOFF_ALREADY_PENDING')
  assert.equal(pressLog.filter((id) => id === 'new-send').length, 0)
  const records = loadState(root, state.run_id).supervisor_handoffs ?? []
  assert.deepEqual(
    records.map((r) => [r.id, r.status]),
    [[first.handoffId, 'sending']],
  )
})

// ---------------------------------------------------------------------------
// AC-14: fence on submit, on a card-less run, and acceptance by attestation
// ---------------------------------------------------------------------------

function sentHandoff(root: string, state: RunState): void {
  appendSendingRecord(root, state.run_id, {
    id: 'fence-id',
    from_session_generation: state.supervisor_card?.session_generation ?? 0,
    prompt: `/pan-resume ${state.run_id}`,
    model: MODEL,
    effort: EFFORT,
    initiated_at: new Date().toISOString(),
  })
  markHandoffSent(root, state.run_id, 'fence-id', `${MODEL} ${EFFORT}`)
}

function handedOffCode(action: () => void): string | undefined {
  try {
    action()
  } catch (err: unknown) {
    return (err as { code?: string }).code
  }

  return undefined
}

test('AC-14: submit from the handing-off session refuses with SUPERVISOR_HANDED_OFF', () => {
  const root = createFixture()
  const state = runningRun(root)

  sentHandoff(root, state)

  assert.equal(
    handedOffCode(() =>
      assertSupervisorCardAttested(
        root,
        loadState(root, state.run_id),
        'submit',
      ),
    ),
    'SUPERVISOR_HANDED_OFF',
  )
})

test('AC-14: a run without a supervisor card is fenced too', () => {
  const root = createFixture()
  const state = runningRun(root)

  delete state.supervisor_card
  persist(root, state, 'test_card_removed')
  sentHandoff(root, loadState(root, state.run_id))

  assert.equal(
    handedOffCode(() =>
      assertSupervisorCardAttested(
        root,
        loadState(root, state.run_id),
        'prepare',
      ),
    ),
    'SUPERVISOR_HANDED_OFF',
  )
})

test('AC-14: attest-supervisor from the new session accepts the handoff and lifts the fence', () => {
  const root = createFixture()
  const state = runningRun(root)
  const generation = state.supervisor_card?.session_generation ?? 0

  sentHandoff(root, state)
  attestSupervisorCard(root, state.run_id, state.supervisor_card?.sha256 ?? '')

  const fresh = loadState(root, state.run_id)
  const latest = latestHandoffRecord(fresh)

  assert.equal(latest?.status, 'accepted')
  assert.equal(latest?.accepted_session_generation, generation + 1)
  assert.notEqual(
    handedOffCode(() => assertSupervisorCardAttested(root, fresh, 'prepare')),
    'SUPERVISOR_HANDED_OFF',
  )
})

// ---------------------------------------------------------------------------
// AC-12: pan status reports the latest handoff and its note
// ---------------------------------------------------------------------------

test('AC-12: pan status names the latest supervisor handoff and its note path', () => {
  const root = createFixture()
  const state = runningRun(root)
  const prepared = prepareHandoff(root, {
    runId: state.run_id,
    prompt: `/pan-resume ${state.run_id}`,
    model: MODEL,
    effort: EFFORT,
    note: 'Resume at verify.',
  })

  appendSendingRecord(root, state.run_id, {
    id: prepared.handoffId,
    from_session_generation: prepared.fromSessionGeneration,
    prompt: `/pan-resume ${state.run_id}`,
    model: MODEL,
    effort: EFFORT,
    initiated_at: new Date().toISOString(),
    note_path: prepared.notePath ?? '',
  })

  const text = renderStatus(loadState(root, state.run_id))

  assert.ok(
    text.includes(`Supervisor handoff: sending (${prepared.handoffId})`),
    text,
  )
  assert.ok(text.includes(`Handoff note: ${prepared.notePath ?? ''}`), text)
})

// ---------------------------------------------------------------------------
// AC-16: the shipped Swift source compiles, and a failed build has its code
// ---------------------------------------------------------------------------

test('AC-16: the shipped Swift helper source compiles with swiftc', (t) => {
  const swiftc = process.platform === 'darwin' ? findSwiftc() : null

  if (swiftc === null) {
    t.skip('needs macOS with swiftc')
    return
  }

  const tmpRoot = createTestTempDirectory('pancreator-helper-build-')
  mkdirSync(path.join(tmpRoot, 'src', 'native'), { recursive: true })
  copyFileSync(
    path.join(process.cwd(), SWIFT_SOURCE_RELATIVE),
    path.join(tmpRoot, SWIFT_SOURCE_RELATIVE),
  )

  const built = ensureHelper(tmpRoot, { swiftcPath: swiftc })

  assert.equal(built.compiled, true)
  assert.ok(existsSync(built.binaryPath))
})

test('AC-16: a failing swiftc refuses with HANDOFF_HELPER_BUILD_FAILED', (t) => {
  if (process.platform !== 'darwin') {
    t.skip('ensureHelper refuses off macOS before any build')
    return
  }

  const tmpRoot = createTestTempDirectory('pancreator-helper-fail-')
  mkdirSync(path.join(tmpRoot, 'src', 'native'), { recursive: true })
  writeFileSync(path.join(tmpRoot, SWIFT_SOURCE_RELATIVE), '// test\n')

  assert.throws(
    () => ensureHelper(tmpRoot, { swiftcPath: '/usr/bin/false' }),
    (err: unknown) =>
      err instanceof PanError && err.code === 'HANDOFF_HELPER_BUILD_FAILED',
  )
})
