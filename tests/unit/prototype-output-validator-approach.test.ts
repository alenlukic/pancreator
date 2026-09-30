import assert from 'node:assert/strict'
import test from 'node:test'

import { validatePrototypeOutput } from '../../src/lib/validators/prototype-output.js'
import {
  OPERATOR_DECISION_PATH,
  codesOf,
  excludedPrecondition,
  operatorFeedback,
  scratchRoot,
  validatorInput,
  writeOutput,
} from './prototype-output-validator-helpers.js'

function approachOutput(
  root: string,
  preconditions: Record<string, unknown>[],
  result = 'success',
): string {
  return writeOutput(root, 'approach.json', {
    result,
    data: { technical_approach: { preconditions } },
  })
}

test('intake contracts the question identifier every later stage keys on', () => {
  const root = scratchRoot()
  const minimal = validatePrototypeOutput(
    validatorInput(
      root,
      writeOutput(root, 'intake-minimal.json', {
        data: { prototype_brief: { objective: 'test' } },
      }),
      'intake',
    ),
  )

  assert.equal(minimal.status, 'passed')

  const bare = validatePrototypeOutput(
    validatorInput(
      root,
      writeOutput(root, 'intake-bare.json', {
        data: {
          prototype_brief: {
            objective: 'test',
            technical_questions: [
              'Can the importer stream 10k rows under 200ms?',
              { id: 'TQ-02' },
              { id: 'TQ-03', question: 'ok' },
              { id: 'TQ-03', question: 'repeated id' },
            ],
          },
        },
      }),
      'intake',
    ),
  )

  // These three shapes fail where the id is born, not at the evaluate
  // coverage gate.
  assert.equal(bare.status, 'failed')
  assert.equal(
    bare.issues.filter((item) => item.code === 'prototype.question_id').length,
    3,
  )

  const contracted = validatePrototypeOutput(
    validatorInput(
      root,
      writeOutput(root, 'intake-ok.json', {
        data: {
          prototype_brief: {
            objective: 'test',
            technical_questions: [
              { id: 'TQ-01', question: 'Does the adapter cover provider A?' },
            ],
          },
        },
      }),
      'intake',
    ),
  )

  assert.equal(contracted.status, 'passed')
})

test('approach accepts canonical preconditions and rejects blocking success', () => {
  const root = scratchRoot()
  const target = approachOutput(root, [
    {
      id: 'PRE-01',
      affected_questions: ['TQ-01'],
      check: 'auth probe',
      status: 'unavailable',
      evidence: ['missing auth'],
      volatile: true,
    },
  ])

  const result = validatePrototypeOutput(
    validatorInput(root, target, 'approach'),
  )

  assert.equal(result.status, 'failed')
  assert.ok(codesOf(result).has('prototype.approach_blocked'))
})

test('approach allows narrowed scope with a recorded operator decision', () => {
  const root = scratchRoot()
  const target = approachOutput(root, [
    excludedPrecondition(OPERATOR_DECISION_PATH),
    {
      id: 'PRE-02',
      affected_questions: ['TQ-02'],
      check: 'fixture ready',
      status: 'ready',
      evidence: ['ready'],
      volatile: false,
    },
  ])

  const result = validatePrototypeOutput(
    validatorInput(root, target, 'approach', {
      run_id: 'run-1',
      operator_feedback: [
        operatorFeedback(
          'Exclude TQ-01 from this spike; auth is out of scope.',
        ),
      ],
    }),
  )

  assert.equal(result.status, 'passed')
})

test('approach rejects narrowing cited to a harness pause record', () => {
  const root = scratchRoot()
  // The harness writes its own pause records here, so such a file is not an
  // operator directive.
  const pausePath =
    'runtime/logs/workflows/run-1/agent/decisions/2f1c9b3e-pause.json'

  writeOutput(root, pausePath, { title: 'Approach paused', status: 'paused' })

  const target = approachOutput(root, [excludedPrecondition(pausePath)])

  const result = validatePrototypeOutput(
    validatorInput(root, target, 'approach', {
      run_id: 'run-1',
      operator_feedback: [],
    }),
  )
  const codes = codesOf(result)

  assert.equal(result.status, 'failed')
  assert.ok(codes.has('prototype.exclusion_authority'))
  assert.ok(codes.has('prototype.approach_blocked'))
})

test('approach rejects narrowing when the operator note omits the question', () => {
  const root = scratchRoot()
  const target = approachOutput(root, [
    excludedPrecondition(OPERATOR_DECISION_PATH),
  ])

  const result = validatePrototypeOutput(
    validatorInput(root, target, 'approach', {
      run_id: 'run-1',
      operator_feedback: [operatorFeedback('Keep the spike small.')],
    }),
  )
  const codes = codesOf(result)

  assert.equal(result.status, 'failed')
  assert.ok(codes.has('prototype.exclusion_authority'))
  assert.ok(
    result.issues.some(
      (issue) =>
        issue.code === 'prototype.exclusion_authority' &&
        issue.message.includes('TQ-01'),
    ),
  )
})

test('approach rejects narrowing cited to an away-mode decision', () => {
  const root = scratchRoot()
  const target = approachOutput(root, [
    excludedPrecondition(OPERATOR_DECISION_PATH),
  ])

  const result = validatePrototypeOutput(
    validatorInput(root, target, 'approach', {
      run_id: 'run-1',
      operator_feedback: [
        operatorFeedback('Exclude TQ-01.', { source: 'away' }),
      ],
    }),
  )

  assert.equal(result.status, 'failed')
  assert.ok(codesOf(result).has('prototype.exclusion_authority'))
})

test('a precondition entry omitting volatile fails', () => {
  const root = scratchRoot()
  const target = approachOutput(root, [
    {
      id: 'PRE-01',
      affected_questions: ['TQ-01'],
      check: 'fixture ready',
      status: 'ready',
      evidence: ['ready'],
    },
  ])

  const result = validatePrototypeOutput(
    validatorInput(root, target, 'approach'),
  )

  assert.equal(result.status, 'failed')
  assert.ok(codesOf(result).has('technical_approach.preconditions[0].volatile'))
})

test('an approach blocked on an operator question passes validation', () => {
  const root = scratchRoot()
  const target = approachOutput(
    root,
    [
      {
        id: 'PRE-01',
        affected_questions: ['TQ-01'],
        check: 'fixture ready',
        status: 'ready',
        evidence: ['ready'],
        volatile: false,
      },
    ],
    'blocked',
  )

  // blocked is the harness pause route, so the validator must pass the
  // operator question through and must not rewrite it to a failure.
  const result = validatePrototypeOutput(
    validatorInput(root, target, 'approach'),
  )

  assert.equal(result.status, 'passed')
  assert.equal(result.issues.length, 0)
})
