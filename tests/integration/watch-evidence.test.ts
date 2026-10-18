/**
 * HR-005 of the 2026-09-29 efficiency audit: the verifier waited on a
 * supervisor timer script for the slower evidence worker, and nothing
 * returned when the last report wrote its completion marker. The
 * evidence-complete watch returns within one cadence of that marker and
 * never counts as the stage worker's own delegation evidence.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { getRunState } from '../../src/lib/engine.js'
import { PanError } from '../../src/lib/errors.js'
import {
  EVIDENCE_REPORT_COMPLETE_MARKER,
  evidenceDefectLine,
  evidenceVerdictLine,
} from '../../src/lib/render.js'
import {
  EVIDENCE_GATE_EXIT_CODE,
  WATCH_NO_EVIDENCE_WORKERS,
  evidenceWatchExitCode,
  formatEvidenceWatchResult,
  readEvidenceReady,
  watchEvidenceCompletion,
} from '../../src/lib/watch-evidence.js'
import { evidenceGatePath } from '../../src/lib/watch/paths.js'
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

test('a fail verdict with no cited defect does not gate the verifier', async () => {
  const { root, runId } = checkpoint('delivery@verify-prepared')
  const invocation = resolveWatchedInvocation(root, runId)
  const [review, qa] = invocation.evidence_workers ?? []

  assert.ok(review && qa)

  // The real failure: every criterion "unmet" only because evidence was
  // unavailable, and no reviewer named a defect.
  writeReport(
    root,
    review.evidence_path,
    `# Review\n\n### AC-601: evidence_unavailable (collector aborted)\n\n` +
      `${evidenceVerdictLine('fail')}\n${EVIDENCE_REPORT_COMPLETE_MARKER}\n`,
  )
  writeReport(
    root,
    qa.evidence_path,
    `# QA\n\n${evidenceVerdictLine('pass')}\n${EVIDENCE_REPORT_COMPLETE_MARKER}\n`,
  )

  const clock = fakeClock()
  const result = await watchEvidenceCompletion(root, runId, {
    cadenceSeconds: CADENCE_SECONDS,
    now: clock.now,
    sleep: clock.sleep,
  })

  assert.equal(result.state, 'completed')
  assert.equal(result.all_pass, true)
  assert.equal(result.gate, null)
  assert.notEqual(getRunState(root, runId).current_stage, 'remediate')
})

test('a failing evidence verdict that cites a defect skips the verifier and routes verify to remediate', async () => {
  const { root, runId } = checkpoint('delivery@verify-prepared')
  const invocation = resolveWatchedInvocation(root, runId)
  const [review, qa] = invocation.evidence_workers ?? []

  assert.ok(review && qa)

  writeReport(
    root,
    review.evidence_path,
    `# Review\n\n### Finding: broken\n\n` +
      `${evidenceDefectLine('src/lib/a.ts:10 drops the last item')}\n` +
      `${evidenceVerdictLine('fail')}\n${EVIDENCE_REPORT_COMPLETE_MARKER}\n`,
  )
  writeReport(
    root,
    qa.evidence_path,
    `# QA\n\n${evidenceVerdictLine('pass')}\n${EVIDENCE_REPORT_COMPLETE_MARKER}\n`,
  )

  const clock = fakeClock()
  const result = await watchEvidenceCompletion(root, runId, {
    cadenceSeconds: CADENCE_SECONDS,
    now: clock.now,
    sleep: clock.sleep,
  })

  assert.equal(result.state, 'completed')
  assert.equal(result.all_pass, false)
  assert.equal(evidenceWatchExitCode(result), EVIDENCE_GATE_EXIT_CODE)
  assert.deepEqual(result.gate?.failing_roles, [review.role])
  assert.match(
    formatEvidenceWatchResult(result),
    new RegExp(`verifier gated: ${review.role} reported fail`, 'u'),
  )

  const state = getRunState(root, runId)
  const recorded = state.stage_history.at(-1)

  assert.equal(state.current_stage, 'remediate')
  assert.equal(recorded?.stage, 'verify')
  assert.equal(recorded?.outcome, 'failure')
  assert.equal(
    recorded?.output_path,
    evidenceGatePath(root, runId, invocation.invocation_id),
  )

  const record = JSON.parse(
    readFileSync(path.join(root, recorded?.output_path ?? ''), 'utf8'),
  ) as {
    result: string
    artifacts: Array<{ path: string }>
    data: { verify: { verdict: string } }
  }

  assert.equal(record.result, 'failure')
  assert.equal(record.data.verify.verdict, 'fail_remedial')
  assert.deepEqual(
    record.artifacts.map((artifact) => artifact.path),
    [review.evidence_path, qa.evidence_path],
  )
  assert.equal(
    readEvidenceReady(root, runId, invocation.invocation_id)?.all_pass,
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
