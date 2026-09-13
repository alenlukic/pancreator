import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  getRunState,
  pauseRun,
  prepareInvocation,
  resumeRun,
} from '../../src/lib/engine.js'
import {
  assertArgvElementsWithinLimit,
  findOversizedArgvElement,
} from '../../src/lib/argv-limits.js'
import { PanError } from '../../src/lib/errors.js'
import { stageBySlug } from '../../src/lib/workflow.js'
import {
  createFixture,
  makeOutput,
  writeCanonicalDelegation,
  writeJson,
} from '../helpers.js'
import { createRun, submitAsSupervisor } from '../run-helpers.js'
import { checkpoint } from './delivery-helpers.js'

test('operator pause preserves supervisor gate and resume restores it', () => {
  // The delivery-candidate plan is the supervisor-gated stage.
  const {
    root,
    runId,
    state: submitted,
    invocation: planInvocation,
  } = checkpoint('delivery-candidate@plan-awaiting-supervisor')

  assert.ok(planInvocation)
  assert.equal(submitted.status, 'awaiting_supervisor')
  assert.equal(submitted.pending_action.type, 'supervisor_assessment')

  const paused = pauseRun(root, runId, 'Need to edit the repo first.')

  assert.equal(paused.status, 'paused')
  assert.equal(paused.pending_action.type, 'operator_decision')
  assert.equal(paused.pause_reason, 'Need to edit the repo first.')
  assert.ok(paused.operator_pause)
  assert.equal(paused.operator_pause?.prior_status, 'awaiting_supervisor')
  assert.equal(
    paused.operator_pause?.prior_pending_action.type,
    'supervisor_assessment',
  )
  assert.equal(paused.current_invocation?.id, planInvocation.invocation_id)

  assert.throws(
    () => resumeRun(root, runId, null, 'Attach this to the next worker.'),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('no active worker card to target'),
  )

  const resumed = resumeRun(root, runId)

  assert.equal(resumed.status, 'awaiting_supervisor')
  assert.equal(resumed.pending_action.type, 'supervisor_assessment')
  assert.equal(resumed.operator_pause, null)
  assert.equal(resumed.current_invocation?.id, planInvocation.invocation_id)
})

test('operator changes made during a pause are ratified and stale cards are replaced', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Paused operator edit fixture',
  })
  const runId = state.run_id

  const pausedBeforePrepare = pauseRun(root, runId, 'Stepping away.')

  assert.equal(pausedBeforePrepare.status, 'paused')
  assert.equal(pausedBeforePrepare.operator_pause?.prior_status, 'running')
  assert.equal(
    pausedBeforePrepare.operator_pause?.prior_pending_action.type,
    'prepare_invocation',
  )

  const resumedToPrepare = resumeRun(root, runId)

  assert.equal(resumedToPrepare.status, 'running')
  assert.equal(resumedToPrepare.pending_action.type, 'prepare_invocation')

  const prepared = prepareInvocation(root, runId)
  const firstInvocation = prepared.invocation

  assert.ok(firstInvocation)
  assert.equal(firstInvocation.attempt, 1)

  // A resume note with no stage replaces the prepared worker card.
  pauseRun(root, runId, 'Need an operator directive.')

  const notedResume = resumeRun(
    root,
    runId,
    null,
    'Preserve the compatibility boundary.',
  )

  assert.equal(notedResume.status, 'running')
  assert.equal(notedResume.pending_action.type, 'prepare_invocation')
  assert.equal(notedResume.current_invocation, null)

  const originalInvocation = prepareInvocation(root, runId).invocation

  assert.ok(originalInvocation)
  assert.notEqual(
    originalInvocation.invocation_id,
    firstInvocation.invocation_id,
  )

  const resumeFeedback = getRunState(root, runId).operator_feedback?.find(
    (item) =>
      item.decision === 'resume' &&
      item.note === 'Preserve the compatibility boundary.',
  )

  assert.ok(resumeFeedback)
  assert.ok(
    originalInvocation.inputs.references.some(
      (reference) => reference.path === resumeFeedback.path,
    ),
  )

  pauseRun(root, runId, 'Operator is applying an authorized correction.')
  writeFileSync(
    path.join(root, 'src', 'base.ts'),
    'export const base = true\nexport const operatorFix = true\n',
  )

  const resumed = resumeRun(
    root,
    runId,
    'implement',
    'Authorized operator fix.',
  )

  assert.equal(resumed.status, 'running')
  assert.equal(resumed.pending_action.type, 'prepare_invocation')
  assert.equal(resumed.current_invocation, null)
  assert.equal(resumed.attempts.implement, 0)
  assert.equal(resumed.operator_workspace_ratifications?.length, 1)
  assert.equal(
    resumed.accepted_workspace_fingerprint,
    resumed.operator_workspace_ratifications?.[0]?.workspace_fingerprint,
  )

  const replacement = prepareInvocation(root, runId).invocation

  assert.ok(replacement)
  assert.equal(replacement.attempt, 1)
  assert.notEqual(replacement.invocation_id, originalInvocation.invocation_id)
  assert.equal(
    replacement.workspace_before.fingerprint,
    resumed.accepted_workspace_fingerprint,
  )
})

test('harness pause resume still restarts at prepare_invocation', () => {
  // A blocked plan under the supervisor gate pauses the run without an
  // operator pause record; delivery-candidate declares that gate.
  const {
    root,
    runId,
    invocation: planInvocation,
    workflow,
  } = checkpoint('delivery-candidate@plan-prepared')

  assert.ok(planInvocation)

  const blockedOutput = makeOutput(
    root,
    planInvocation,
    stageBySlug(workflow, 'plan'),
  )

  blockedOutput.result = 'blocked'
  blockedOutput.summary = 'Need operator input before continuing.'

  writeJson(path.join(root, planInvocation.output.path), blockedOutput)
  writeCanonicalDelegation(root, planInvocation)

  const submitted = submitAsSupervisor(root, runId, planInvocation.output.path)

  assert.equal(submitted.state.status, 'paused')
  assert.equal(submitted.state.operator_pause, undefined)

  const resumed = resumeRun(root, runId, 'implement', 'Restart implementation.')

  assert.equal(resumed.status, 'running')
  assert.equal(resumed.current_stage, 'implement')
  assert.equal(resumed.pending_action.type, 'prepare_invocation')
})

test('a note too large for argv is refused, and --note-file carries it', () => {
  const { root, runId } = checkpoint(
    'delivery-candidate@plan-awaiting-supervisor',
  )
  const cli = path.join(process.cwd(), 'dist', 'src', 'cli.js')
  const run = (args: string[]) =>
    spawnSync(process.execPath, [cli, ...args], {
      cwd: root,
      encoding: 'utf8',
      timeout: 120_000,
    })

  // The kill this refusal replaces lands at exec, before anything prints, so
  // the operator saw a silent failure and an unchanged run. Proving the
  // refusal by spawning a real oversized element cannot work: the harness
  // bound is 900 bytes and the endpoint kill fires on the assembled command
  // line at a byte count that varies with the spawning environment, so the
  // same 901-byte note survives from a short working directory and is
  // SIGKILLed from a fixture path a few bytes longer. The refusal is a byte
  // check on the assembled argument list, so it is proven in process against
  // the checker `main` calls before it reads a single argument.
  const oversizedNote = 'x'.repeat(901)

  assert.throws(
    () =>
      assertArgvElementsWithinLimit(['pause', runId, '--note', oversizedNote]),
    (error: unknown) =>
      error instanceof PanError &&
      error.code === 'ARGV_ELEMENT_TOO_LARGE' &&
      // The operator needs the option, the size that refused it, and the way
      // through: a message that names none of those is a silent kill with a
      // stack trace attached.
      error.message.includes('--note') &&
      error.message.includes('901 bytes') &&
      error.message.includes('--note-file') &&
      error.message.includes('The run is unchanged.'),
  )
  assert.deepEqual(
    findOversizedArgvElement(['pause', runId, '--note', oversizedNote]),
    { option: '--note', index: 3, byteLength: 901 },
  )

  // The check is a property of the argument list alone, so it cannot depend
  // on the run resolving. An unknown run must not turn the silent kill into
  // a silent not-found, and the `shortUnknown` spawn below proves the same
  // command reaches RUN_NOT_FOUND once the note fits.
  assert.throws(
    () =>
      assertArgvElementsWithinLimit([
        'pause',
        'no-such-run',
        '--note',
        oversizedNote,
      ]),
    (error: unknown) =>
      error instanceof PanError && error.code === 'ARGV_ELEMENT_TOO_LARGE',
  )

  // A note one byte under the bound is not refused, so the bound itself is
  // pinned rather than the direction of the comparison.
  assertArgvElementsWithinLimit(['pause', runId, '--note', 'x'.repeat(899)])
  assert.equal(getRunState(root, runId).status, 'awaiting_supervisor')

  const packet = `Full decision packet.\n${'detail '.repeat(300)}`
  const notePath = path.join('runtime', 'tmp', 'operator-note.md')

  mkdirSync(path.dirname(path.join(root, notePath)), { recursive: true })
  writeFileSync(path.join(root, notePath), packet)

  const paused = run(['pause', runId, '--note-file', notePath, '--json'])

  assert.equal(paused.status, 0, paused.stderr)
  assert.equal(getRunState(root, runId).pause_reason, packet.trim())

  // The two options name one note, so supplying both is a caller error.
  const both = run([
    'pause',
    runId,
    '--note',
    'inline',
    '--note-file',
    notePath,
  ])

  assert.notEqual(both.status, 0)
  assert.match(`${both.stdout}${both.stderr}`, /--note and --note-file/u)

  const missing = run([
    'resume',
    runId,
    '--note-file',
    'runtime/tmp/absent-note.md',
  ])

  assert.notEqual(missing.status, 0)
  assert.match(
    `${missing.stdout}${missing.stderr}`,
    /NOTE_FILE_NOT_FOUND|absent-note\.md/u,
  )

  const shortUnknown = run(['pause', 'no-such-run', '--note', 'short'])

  assert.match(`${shortUnknown.stdout}${shortUnknown.stderr}`, /RUN_NOT_FOUND/u)
})

/** Every durable record of one run, concatenated. */
function recordedText(runDirectory: string): string {
  return readdirSync(runDirectory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      readFileSync(path.join(entry.parentPath, entry.name), 'utf8'),
    )
    .join('\n')
}

test('every note-taking lifecycle command reads its note from a file', () => {
  const cli = path.join(process.cwd(), 'dist', 'src', 'cli.js')
  const run = (root: string, args: string[]) =>
    spawnSync(process.execPath, [cli, ...args], {
      cwd: root,
      encoding: 'utf8',
      timeout: 120_000,
    })
  const noteFile = (root: string, name: string, body: string): string => {
    const relative = path.join('runtime', 'tmp', name)

    mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
    writeFileSync(path.join(root, relative), body)

    return relative
  }
  // `pan pause` is proven above. These are the four call sites that share
  // the same option helper and that no case exercised.
  const decision = checkpoint('planning@plan-awaiting-operator')
  const decideNote = `Ratified with conditions.\n${'clause '.repeat(200)}`
  const decided = run(decision.root, [
    'decide',
    decision.runId,
    'approve',
    '--note-file',
    noteFile(decision.root, 'decide-note.md', decideNote),
    '--json',
  ])

  assert.equal(decided.status, 0, decided.stderr)
  assert.match(
    readFileSync(
      path.join(
        decision.root,
        'runtime/logs/workflows',
        decision.runId,
        'agent/events.jsonl',
      ),
      'utf8',
    ),
    /Ratified with conditions/u,
  )

  const lifecycle = checkpoint('delivery@implement-prepared')
  const paused = run(lifecycle.root, [
    'pause',
    lifecycle.runId,
    '--note',
    'Hold for the operator.',
    '--json',
  ])

  assert.equal(paused.status, 0, paused.stderr)

  const resumeNote = `Resume after the dependency landed.\n${'why '.repeat(200)}`
  const resumed = run(lifecycle.root, [
    'resume',
    lifecycle.runId,
    '--note-file',
    noteFile(lifecycle.root, 'resume-note.md', resumeNote),
    '--json',
  ])

  assert.equal(resumed.status, 0, resumed.stderr)

  const stageNote = `Reopen implementation.\n${'reason '.repeat(200)}`
  const staged = run(lifecycle.root, [
    'set-stage',
    lifecycle.runId,
    '--stage',
    'implement',
    '--note-file',
    noteFile(lifecycle.root, 'stage-note.md', stageNote),
    '--json',
  ])

  assert.equal(staged.status, 0, staged.stderr)

  const waiverNote = `Operator directive for the bounded miss.\n${'term '.repeat(200)}`
  const waived = run(lifecycle.root, [
    'waive-gate',
    lifecycle.runId,
    '--note-file',
    noteFile(lifecycle.root, 'waiver-note.md', waiverNote),
    '--json',
  ])

  assert.equal(waived.status, 0, waived.stderr)

  const records = recordedText(
    path.join(lifecycle.root, 'runtime/logs/workflows', lifecycle.runId),
  )

  for (const marker of [
    'Resume after the dependency landed',
    'Reopen implementation',
    'Operator directive for the bounded miss',
  ]) {
    assert.ok(records.includes(marker), `no record carries '${marker}'`)
  }

  const state = getRunState(lifecycle.root, lifecycle.runId)
  const waiver = state.operator_gate_waivers?.at(-1)

  assert.equal(waiver?.note, waiverNote.trim())
})
