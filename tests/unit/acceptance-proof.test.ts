import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  ACCEPTANCE_PROOF_TYPES,
  acceptanceCriterionLines,
  acceptanceProofsFromMarkdown,
  liveCriteriaDecision,
} from '../../src/lib/acceptance-proof.js'

test('the proof types match the shared field contract enum', () => {
  const contract = JSON.parse(
    readFileSync(
      path.join(
        process.cwd(),
        'library/schemas/stage-output-requirements.json',
      ),
      'utf8',
    ),
  ) as {
    stages: { plan: { fields: Array<{ path: string; enum?: string[] }> } }
  }
  const field = contract.stages.plan.fields.find(
    (entry) => entry.path === 'data.acceptance_criteria[].proof',
  )

  assert.deepEqual(field?.enum, [...ACCEPTANCE_PROOF_TYPES])
})

test('criterion lines of the acceptance section carry their proof tags', () => {
  const spec = [
    '# Child specification',
    '',
    '## Acceptance criteria',
    '',
    '1. AC-001 [proof: live] The page renders the panel.',
    '2. **AC-002** [proof: Test] The parser accepts the field.',
    '- AC-003 The wording names the policy.',
    '3. AC-004 [proof: manual] An unknown tag.',
    'A line that names AC-005 without a list marker.',
    '',
    '## Validation',
    '',
    '1. AC-009 [proof: live] Outside the section.',
  ].join('\n')

  assert.deepEqual(acceptanceCriterionLines(spec), [
    { id: 'AC-001', tag: 'live' },
    { id: 'AC-002', tag: 'test' },
    { id: 'AC-003', tag: null },
    { id: 'AC-004', tag: 'manual' },
  ])
  assert.deepEqual(
    [...acceptanceProofsFromMarkdown(spec)],
    [
      ['AC-001', 'live'],
      ['AC-002', 'test'],
      ['AC-003', null],
      ['AC-004', null],
    ],
  )
})

test('QA runs for a live criterion or unknown proofs and skips otherwise', () => {
  assert.equal(liveCriteriaDecision(new Map()).run, true)
  assert.equal(
    liveCriteriaDecision(
      new Map([
        ['AC-1', 'test'],
        ['AC-2', null],
      ]),
    ).run,
    true,
  )

  const live = liveCriteriaDecision(
    new Map([
      ['AC-1', 'test'],
      ['AC-2', 'live'],
    ]),
  )

  assert.equal(live.run, true)
  assert.match(live.reason, /AC-2/u)

  const skipped = liveCriteriaDecision(
    new Map([
      ['AC-1', 'test'],
      ['AC-2', 'review'],
      ['AC-3', 'observe'],
    ]),
  )

  assert.equal(skipped.run, false)
  assert.match(skipped.reason, /1 test, 1 review, 1 observe/u)
})
