import assert from 'node:assert/strict'
import test from 'node:test'

import {
  evidenceGapOnlyFailure,
  evidenceGapRisks,
  isEvidenceGapResult,
} from '../../src/lib/evidence-gaps.js'

function output(
  acceptance: Array<Record<string, unknown>>,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    result: 'failure',
    criteria: [],
    data: { acceptance_results: acceptance },
    ...extra,
  }
}

test('a declared failure whose acceptance results are only evidence gaps is not a stage failure', () => {
  const reason = evidenceGapOnlyFailure(
    output([
      { id: 'AC-601', result: 'evidence_unavailable', evidence: ['x'] },
      { id: 'AC-602', result: 'unverified', evidence: ['y'] },
      { id: 'AC-603', result: 'pass', evidence: ['z'] },
    ]),
  )

  assert.ok(reason)
  assert.match(reason, /AC-601, AC-602/u)
})

test('a declared failure that names a defect stays a failure', () => {
  assert.equal(
    evidenceGapOnlyFailure(
      output([
        { id: 'AC-601', result: 'evidence_unavailable', evidence: ['x'] },
        { id: 'AC-602', result: 'fail', evidence: ['src/a.ts:3 wrong'] },
      ]),
    ),
    null,
  )
  assert.equal(
    evidenceGapOnlyFailure(
      output(
        [{ id: 'AC-601', result: 'evidence_unavailable', evidence: ['x'] }],
        { criteria: [{ id: 'implement.tests', result: 'fail' }] },
      ),
    ),
    null,
  )
})

test('only failures with recorded gaps qualify', () => {
  assert.equal(
    evidenceGapOnlyFailure(
      output([{ id: 'AC-1', result: 'pass', evidence: ['x'] }]),
    ),
    null,
  )
  assert.equal(
    evidenceGapOnlyFailure({
      ...output([{ id: 'AC-1', result: 'evidence_unavailable' }]),
      result: 'success',
    }),
    null,
  )
})

test('evidence gap risks name the criterion, reason, and owner', () => {
  assert.equal(isEvidenceGapResult(' Environment_Blocked '), true)
  assert.equal(isEvidenceGapResult('fail'), false)
  assert.deepEqual(
    evidenceGapRisks([
      {
        id: 'AC-901',
        result: 'evidence_unavailable',
        gap_reason: 'no independent verify of the chunk',
        gap_owner: 'operator',
      },
      { id: 'AC-1', result: 'pass' },
    ]),
    [
      'Evidence gap for AC-901: no independent verify of the chunk; ' +
        'owner: operator. Non-blocking.',
    ],
  )
})
