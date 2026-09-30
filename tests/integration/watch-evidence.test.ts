/**
 * HR-005 of the 2026-09-29 efficiency audit: the verifier waited on a
 * supervisor timer script for the slower evidence worker, and nothing
 * returned when the last report wrote its completion marker. The
 * evidence-complete watch returns within one cadence of that marker and
 * never counts as the stage worker's own delegation evidence.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { PanError } from '../../src/lib/errors.js'
import { EVIDENCE_REPORT_COMPLETE_MARKER } from '../../src/lib/render.js'
import {
  WATCH_NO_EVIDENCE_WORKERS,
  readEvidenceReady,
  watchEvidenceCompletion,
} from '../../src/lib/watch-evidence.js'
import {
  evidenceReadyPath,
  evidenceWatchRecordPath,
  invocationEvidencePaths,
  readLaunchRecord,
  readWatchRecord,
  resolveWatchedInvocation,
  summarizeDelegationObservation,
  watchRecordPath,
} from '../../src/lib/watch.js'
import { checkpoint } from './delivery-helpers.js'
import { CADENCE_SECONDS, fakeClock } from './watch-helpers.js'

function writeReport(root: string, relative: string, body: string): void {
  const absolute = path.join(root, relative)

  mkdirSync(path.dirname(absolute), { recursive: true })
  writeFileSync(absolute, body)
}

test('the evidence watch returns on the wake after the last report writes its completion marker', async () => {
  const { root, runId } = checkpoint('delivery@verify-prepared')
  const invocation = resolveWatchedInvocation(root, runId)
  const [review, qa] = invocation.evidence_workers ?? []

  assert.ok(review && qa)

  writeReport(
    root,
    review.evidence_path,
    `# Review\n\n${EVIDENCE_REPORT_COMPLETE_MARKER}\n`,
  )
  writeReport(root, qa.evidence_path, '# QA\n\n### Case: first\n')

  const clock = fakeClock()
  let sleeps = 0
  const result = await watchEvidenceCompletion(root, runId, {
    cadenceSeconds: CADENCE_SECONDS,
    stallWakes: 5,
    now: clock.now,
    sleep: async (milliseconds) => {
      await clock.sleep(milliseconds)
      sleeps += 1

      // The QA worker finishes during the second cadence.
      if (sleeps === 2) {
        appendFileSync(
          path.join(root, qa.evidence_path),
          `\n${EVIDENCE_REPORT_COMPLETE_MARKER}\n`,
        )
      }
    },
  })

  assert.equal(result.state, 'completed')
  assert.equal(result.terminal_basis, 'evidence_complete')
  assert.equal(result.wakes, 2)
  assert.deepEqual(
    result.roles.map((role) => [role.role, role.complete]),
    [
      [review.role, true],
      [qa.role, true],
    ],
  )
  assert.equal(
    result.ready_path,
    evidenceReadyPath(root, runId, invocation.invocation_id),
  )

  const ready = readEvidenceReady(root, runId, invocation.invocation_id)

  assert.deepEqual(
    ready?.roles.map((role) => role.role),
    [review.role, qa.role],
  )
  assert.ok(
    existsSync(
      path.join(
        root,
        evidenceWatchRecordPath(root, runId, invocation.invocation_id),
      ),
    ),
  )

  // Nothing here speaks for the stage worker: no stage ledger, no launch
  // record, and no delegation observation.
  assert.equal(
    existsSync(
      path.join(root, watchRecordPath(root, runId, invocation.invocation_id)),
    ),
    false,
  )
  assert.equal(readLaunchRecord(root, runId, invocation.invocation_id), null)
  assert.equal(
    summarizeDelegationObservation(root, runId, invocation.invocation_id)
      .observed,
    false,
  )

  // The stage watch that follows does not read the evidence watch's own
  // files as worker progress.
  const watched = invocationEvidencePaths(root, runId, invocation)

  assert.ok(!watched.some((item) => item.endsWith('-evidence-watch.jsonl')))
  assert.ok(!watched.some((item) => item.endsWith('-evidence-ready.json')))
})

test('a report whose newest attempt lacks the marker keeps the evidence watch waiting until it stalls', async () => {
  const { root, runId } = checkpoint('delivery@verify-prepared')
  const invocation = resolveWatchedInvocation(root, runId)

  for (const worker of invocation.evidence_workers ?? []) {
    writeReport(root, worker.evidence_path, '# Report\n\n### Case: first\n')
  }

  const clock = fakeClock()
  const result = await watchEvidenceCompletion(root, runId, {
    cadenceSeconds: CADENCE_SECONDS,
    stallWakes: 2,
    now: clock.now,
    sleep: clock.sleep,
  })

  assert.equal(result.state, 'stalled')
  assert.equal(result.ready_path, null)
  assert.equal(readEvidenceReady(root, runId, invocation.invocation_id), null)
  assert.ok(result.roles.every((role) => role.non_empty && !role.complete))
})

test('an evidence-complete wake planted in the stage ledger never counts as the stage worker watch', () => {
  const { root, runId } = checkpoint('delivery@verify-prepared')
  const invocation = resolveWatchedInvocation(root, runId)
  const ledger = path.join(
    root,
    watchRecordPath(root, runId, invocation.invocation_id),
  )

  mkdirSync(path.dirname(ledger), { recursive: true })
  appendFileSync(
    ledger,
    `${JSON.stringify({
      schema_version: 1,
      event: 'wake',
      run_id: runId,
      invocation_id: invocation.invocation_id,
      recorded_at: new Date().toISOString(),
      cadence_seconds: 60,
      wake: 1,
      terminal_state: 'completed',
      terminal_basis: 'evidence_complete',
    })}\n`,
  )

  assert.equal(readWatchRecord(root, runId, invocation.invocation_id).length, 1)
  assert.equal(
    summarizeDelegationObservation(root, runId, invocation.invocation_id)
      .observed,
    false,
  )
})

test('the evidence watch refuses an invocation with no evidence workers', async () => {
  const { root, runId } = checkpoint('delivery@implement-prepared')

  await assert.rejects(
    watchEvidenceCompletion(root, runId, { cadenceSeconds: CADENCE_SECONDS }),
    (error: unknown) =>
      error instanceof PanError && error.code === WATCH_NO_EVIDENCE_WORKERS,
  )
})

test('the CLI refuses the evidence watch beside a flag that records the stage worker launch', () => {
  const { root, runId } = checkpoint('delivery@verify-prepared')
  const result = spawnSync(
    process.execPath,
    [
      path.join(process.cwd(), 'dist', 'src', 'cli.js'),
      'watch',
      runId,
      '--until-evidence-complete',
      '--mark-background',
      '--json',
    ],
    { cwd: root, encoding: 'utf8', timeout: 60_000 },
  )

  assert.notEqual(result.status, 0)
  assert.match(
    `${result.stdout}${result.stderr}`,
    /--until-evidence-complete is exclusive with --mark-background/u,
  )
})
