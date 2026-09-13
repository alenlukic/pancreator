import assert from 'node:assert/strict'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { prepareInvocation, setRunStage } from '../../src/lib/engine.js'
import {
  EVIDENCE_REPORT_COMPLETE_MARKER,
  readEvidenceReportState,
  renderEvidenceWorkerBrief,
} from '../../src/lib/render.js'
import { createFixture } from '../helpers.js'
import { createRun } from '../run-helpers.js'

/** One case block, as the brief's contract tells a worker to append it. */
function caseBlock(id: string, result: string): string {
  return `### ${id} — ${result}\n\nObserved: ${id} ran and reported ${result}.\n\n`
}

// A QA worker executed eleven cases over forty minutes and wrote its report
// in one call at the end. The write was truncated, and every executed case
// was lost: the stage had to run the whole dimension again.
test('a report truncated part way through keeps every case recorded before it', () => {
  const root = createFixture()
  const run = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })

  setRunStage(root, run.run_id, 'verify', 'Verify the current workspace.')

  const invocation = prepareInvocation(root, run.run_id).invocation

  assert.ok(invocation)

  const worker = (invocation.evidence_workers ?? [])[0]

  assert.ok(worker)

  const report = path.join(root, worker.evidence_path)

  writeFileSync(report, `# ${worker.role} evidence\n\n`)
  appendFileSync(report, caseBlock('QA-001', 'pass'))
  appendFileSync(report, caseBlock('QA-002', 'fail'))

  // The worker dies here, part way through its third case. Nothing else is
  // written, and no completion marker ever lands.
  const survived = readEvidenceReportState(readFileSync(report, 'utf8'))

  assert.deepEqual(survived.cases, ['QA-001 — pass', 'QA-002 — fail'])
  assert.equal(survived.complete, false)

  // A relaunched worker finishing the dimension closes the same report.
  appendFileSync(report, caseBlock('QA-003', 'pass'))
  appendFileSync(report, `${EVIDENCE_REPORT_COMPLETE_MARKER}\n`)

  const finished = readEvidenceReportState(readFileSync(report, 'utf8'))

  assert.deepEqual(finished.cases, [
    'QA-001 — pass',
    'QA-002 — fail',
    'QA-003 — pass',
  ])
  assert.equal(finished.complete, true)

  // The worker learns the rule from its own brief, so the contract that
  // makes the recovery above possible is delivered rather than assumed.
  const brief = renderEvidenceWorkerBrief(invocation, worker)

  assert.ok(brief.includes(EVIDENCE_REPORT_COMPLETE_MARKER))
})

test('a report holding no completion marker reads as incomplete however long it is', () => {
  const body = ['# review evidence', '', caseBlock('R-001', 'high')].join('\n')

  assert.equal(readEvidenceReportState(body).complete, false)
  assert.deepEqual(readEvidenceReportState(body).cases, ['R-001 — high'])
  assert.deepEqual(readEvidenceReportState('').cases, [])
  assert.equal(
    readEvidenceReportState(`text\n${EVIDENCE_REPORT_COMPLETE_MARKER}\n`)
      .complete,
    true,
  )
})
