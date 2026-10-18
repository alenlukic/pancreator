import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  EVIDENCE_REPORT_COMPLETE_MARKER,
  evidenceDefectLine,
  evidenceVerdictLine,
  readEvidenceReportState,
} from '../../src/lib/render.js'
import { observeEvidenceReports } from '../../src/lib/watch-evidence.js'
import type { InvocationEvidenceWorker } from '../../src/lib/types.js'
import { createTestTempDirectory } from '../temp.js'

function worker(role: string, attempts: string[]): InvocationEvidenceWorker {
  return {
    persona: role,
    role,
    scope: `${role} scope`,
    agent: `pan-${role}`,
    model: 'fixture-model',
    brief_path: `briefs/${role}-1.md`,
    evidence_path: attempts[0] as string,
    attempts: attempts.map((evidence_path, index) => ({
      attempt: index + 1,
      brief_path: `briefs/${role}-${index + 1}.md`,
      evidence_path,
      recorded_at: '2026-09-29T00:00:00.000Z',
    })),
  }
}

function write(root: string, relative: string, body: string): void {
  mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
  writeFileSync(path.join(root, relative), body)
}

test('readiness needs the completion marker in every role newest declared report', () => {
  const root = createTestTempDirectory('pan-evidence-ready-')

  try {
    const complete = `# Report\n\n${EVIDENCE_REPORT_COMPLETE_MARKER}\n`

    write(root, 'e/review-1.md', complete)
    write(root, 'e/qa-1.md', complete)

    const both = observeEvidenceReports(root, {
      evidence_workers: [
        worker('review', ['e/review-1.md']),
        worker('qa', ['e/qa-1.md']),
      ],
    })

    assert.equal(both.all_complete, true)

    // A relaunched QA worker has not written yet. Its first report's marker
    // proves nothing about the report the stage worker will read.
    const relaunched = observeEvidenceReports(root, {
      evidence_workers: [
        worker('review', ['e/review-1.md']),
        worker('qa', ['e/qa-1.md', 'e/qa-2.md']),
      ],
    })

    assert.equal(relaunched.all_complete, false)
    assert.deepEqual(relaunched.roles[1], {
      role: 'qa',
      attempt: 2,
      path: 'e/qa-2.md',
      exists: false,
      non_empty: false,
      complete: false,
      verdict: null,
      defects: [],
      passes: true,
    })

    write(root, 'e/qa-2.md', '# Report\n\n### Case: first\n')

    const partial = observeEvidenceReports(root, {
      evidence_workers: [
        worker('review', ['e/review-1.md']),
        worker('qa', ['e/qa-1.md', 'e/qa-2.md']),
      ],
    })

    assert.equal(partial.all_complete, false)
    assert.equal(partial.roles[1]?.non_empty, true)
    assert.equal(partial.roles[1]?.complete, false)

    // No evidence worker at all never reads as complete.
    assert.equal(observeEvidenceReports(root, {}).all_complete, false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('only a fail verdict that cites a defect gates the verifier', () => {
  const root = createTestTempDirectory('pan-evidence-verdict-')

  try {
    const report = (
      verdict: 'pass' | 'fail' | null,
      defects: string[] = [],
    ): string =>
      `# Report\n\n${defects.map((defect) => `${evidenceDefectLine(defect)}\n`).join('')}` +
      `${verdict ? `${evidenceVerdictLine(verdict)}\n` : ''}` +
      `${EVIDENCE_REPORT_COMPLETE_MARKER}\n`
    const workers = [
      worker('review', ['e/review-1.md']),
      worker('qa', ['e/qa-1.md']),
    ]

    write(root, 'e/review-1.md', report('pass'))
    write(root, 'e/qa-1.md', report('pass'))

    const passing = observeEvidenceReports(root, { evidence_workers: workers })

    assert.equal(passing.all_complete, true)
    assert.equal(passing.all_pass, true)

    // A fail that cites a specific defect gates the verifier.
    write(
      root,
      'e/qa-1.md',
      report('fail', ['src/lib/x.ts:12 returns null for an empty list']),
    )

    const failing = observeEvidenceReports(root, { evidence_workers: workers })

    assert.equal(failing.all_complete, true)
    assert.equal(failing.all_pass, false)
    assert.deepEqual(
      failing.roles.map((role) => [role.role, role.verdict, role.passes]),
      [
        ['review', 'pass', true],
        ['qa', 'fail', false],
      ],
    )

    // VERIFY-001: a fail that cites no defect is only missing evidence, so it
    // reads as a pass with evidence gaps.
    write(root, 'e/qa-1.md', report('fail'))
    assert.equal(
      observeEvidenceReports(root, { evidence_workers: workers }).all_pass,
      true,
    )

    // A complete report that states no verdict cites no defect either.
    write(root, 'e/qa-1.md', report(null))
    assert.equal(
      observeEvidenceReports(root, { evidence_workers: workers }).all_pass,
      true,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the report reader collects each well-formed defect citation', () => {
  assert.deepEqual(readEvidenceReportState('# Report\n').defects, [])
  assert.deepEqual(
    readEvidenceReportState(
      `${evidenceDefectLine('a.ts:1 wrong')}\n  ${evidenceDefectLine('test x fails')}  \n`,
    ).defects,
    ['a.ts:1 wrong', 'test x fails'],
  )
  assert.deepEqual(
    readEvidenceReportState('<!-- evidence-defect:  -->\n').defects,
    [],
  )
})

test('the report reader takes the last well-formed verdict line and ignores malformed ones', () => {
  assert.equal(readEvidenceReportState('# Report\n').verdict, null)
  assert.equal(
    readEvidenceReportState(`${evidenceVerdictLine('pass')}\n`).verdict,
    'pass',
  )
  assert.equal(
    readEvidenceReportState(`  ${evidenceVerdictLine('fail')}  \n`).verdict,
    'fail',
  )
  assert.equal(
    readEvidenceReportState(
      `${evidenceVerdictLine('pass')}\n${evidenceVerdictLine('fail')}\n`,
    ).verdict,
    'fail',
  )
  assert.equal(
    readEvidenceReportState('<!-- evidence-verdict: maybe -->\n').verdict,
    null,
  )
})
