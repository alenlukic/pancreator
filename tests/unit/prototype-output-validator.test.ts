import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { validatePrototypeOutput } from '../../src/lib/validators/prototype-output.js'
import { createFixture } from '../helpers.js'

function writeOutput(
  root: string,
  relativePath: string,
  value: Record<string, unknown>,
): string {
  const absolute = path.join(root, relativePath)

  mkdirSync(path.dirname(absolute), { recursive: true })
  writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`)

  return relativePath
}

function validatorInput(
  root: string,
  targetPath: string,
  stageSlug: string,
  runState?: Record<string, unknown>,
) {
  return {
    root,
    targetPath,
    requirement: {
      policy_id: 'PROTO-001',
      requirement_id: 'prototype-output-validate',
      registry_id: 'PROTOTYPE-OUTPUT-VALIDATE-001',
      arguments: {},
    },
    stage: { slug: stageSlug },
    invocation: {
      workflow: { slug: 'prototype' },
      stage: { slug: stageSlug },
    },
    runState,
  }
}

test('prototype intake output passes without extra fields', () => {
  const root = createFixture()
  const target = writeOutput(root, 'intake.json', {
    data: { prototype_brief: { objective: 'test' } },
  })

  const result = validatePrototypeOutput(validatorInput(root, target, 'intake'))

  assert.equal(result.status, 'passed')
})

test('approach accepts canonical preconditions and rejects blocking success', () => {
  const root = createFixture()
  const target = writeOutput(root, 'approach.json', {
    result: 'success',
    data: {
      technical_approach: {
        preconditions: [
          {
            id: 'PRE-01',
            affected_questions: ['TQ-01'],
            check: 'auth probe',
            status: 'unavailable',
            evidence: ['missing auth'],
            volatile: true,
          },
        ],
      },
    },
  })

  const result = validatePrototypeOutput(
    validatorInput(root, target, 'approach'),
  )

  assert.equal(result.status, 'failed')
  assert.ok(
    result.issues.some((issue) => issue.code === 'prototype.approach_blocked'),
  )
})

test('approach allows narrowed scope with operator decision evidence', () => {
  const root = createFixture()
  const decisionPath =
    'runtime/logs/workflows/run-1/agent/decisions/operator-feedback-1.md'

  mkdirSync(path.dirname(path.join(root, decisionPath)), { recursive: true })
  writeFileSync(path.join(root, decisionPath), '# operator decision\n')

  const target = writeOutput(root, 'approach.json', {
    result: 'success',
    data: {
      technical_approach: {
        preconditions: [
          {
            id: 'PRE-01',
            affected_questions: ['TQ-01'],
            check: 'auth probe',
            status: 'unavailable',
            evidence: ['missing auth'],
            volatile: true,
            exclusions: [
              {
                excluded_questions: ['TQ-01'],
                operator_decision_path: decisionPath,
              },
            ],
          },
          {
            id: 'PRE-02',
            affected_questions: ['TQ-02'],
            check: 'fixture ready',
            status: 'ready',
            evidence: ['ready'],
            volatile: false,
          },
        ],
      },
    },
  })

  const result = validatePrototypeOutput({
    ...validatorInput(root, target, 'approach', {
      run_id: 'run-1',
    }),
  })

  assert.equal(result.status, 'passed')
})

test('approach rejects narrowing with a decision path outside run decisions', () => {
  const root = createFixture()
  writeFileSync(path.join(root, 'AGENTS.md'), '# agents\n')

  const target = writeOutput(root, 'approach.json', {
    result: 'success',
    data: {
      technical_approach: {
        preconditions: [
          {
            id: 'PRE-01',
            affected_questions: ['TQ-01'],
            check: 'auth probe',
            status: 'unavailable',
            evidence: ['missing auth'],
            volatile: true,
            exclusions: [
              {
                excluded_questions: ['TQ-01'],
                operator_decision_path: 'AGENTS.md',
              },
            ],
          },
        ],
      },
    },
  })

  const result = validatePrototypeOutput({
    ...validatorInput(root, target, 'approach', {
      run_id: 'run-1',
    }),
  })

  assert.equal(result.status, 'failed')
  assert.ok(
    result.issues.some(
      (issue) => issue.code === 'prototype.exclusion_authority',
    ),
  )
  assert.ok(
    result.issues.some((issue) => issue.code === 'prototype.approach_blocked'),
  )
})

test('build requires volatile rechecks before changed files', () => {
  const root = createFixture()
  const runId = 'run-volatile'
  const approachPath = writeOutput(
    root,
    `runtime/logs/workflows/${runId}/agent/outputs/approach-1.json`,
    {
      result: 'success',
      data: {
        technical_approach: {
          preconditions: [
            {
              id: 'PRE-01',
              affected_questions: ['TQ-01'],
              check: 'auth probe',
              status: 'ready',
              evidence: ['ready at approach'],
              volatile: true,
            },
          ],
        },
      },
    },
  )
  const target = writeOutput(
    root,
    `runtime/logs/workflows/${runId}/agent/outputs/build-1.json`,
    {
      result: 'success',
      data: {
        spike: {
          changed_files: ['src/spike.ts'],
          precondition_checks: [
            {
              precondition_id: 'PRE-01',
              status: 'unavailable',
              evidence: ['auth expired'],
            },
          ],
        },
      },
    },
  )

  const result = validatePrototypeOutput({
    ...validatorInput(root, target, 'build', {
      stage_history: [
        {
          stage: 'approach',
          outcome: 'success',
          output_path: approachPath,
        },
      ],
    }),
  })

  assert.equal(result.status, 'failed')
  assert.ok(
    result.issues.some(
      (issue) => issue.code === 'prototype.volatile_check_unready',
    ),
  )
})

test('evaluate rejects environment_blocked when discard condition met', () => {
  const root = createFixture()
  const target = writeOutput(root, 'evaluate.json', {
    result: 'success',
    data: {
      evaluation: {
        verdict: 'environment_blocked',
        environment_blockers: [{ id: 'ENV-01', detail: 'missing credential' }],
        question_results: [
          {
            question_id: 'TQ-01',
            result: 'unanswered',
            cause: 'environment',
            evidence: ['missing credential'],
            discard_condition_met: false,
          },
          {
            question_id: 'TQ-02',
            result: 'answered',
            cause: 'product',
            evidence: ['data loss'],
            discard_condition_met: true,
          },
        ],
      },
    },
  })

  const result = validatePrototypeOutput(
    validatorInput(root, target, 'evaluate'),
  )

  assert.equal(result.status, 'failed')
  assert.ok(
    result.issues.some(
      (issue) => issue.code === 'prototype.verdict_precedence',
    ),
  )
})

test('evaluate accepts invalidated when product discard condition met', () => {
  const root = createFixture()
  const target = writeOutput(root, 'evaluate.json', {
    result: 'success',
    data: {
      evaluation: {
        verdict: 'invalidated',
        environment_blockers: [{ id: 'ENV-01', detail: 'missing credential' }],
        question_results: [
          {
            question_id: 'TQ-01',
            result: 'answered',
            cause: 'product',
            evidence: ['transaction loss'],
            discard_condition_met: true,
          },
        ],
      },
    },
  })

  const result = validatePrototypeOutput(
    validatorInput(root, target, 'evaluate'),
  )

  assert.equal(result.status, 'passed')
})

test('evaluate rejects unknown verdict values', () => {
  const root = createFixture()
  const target = writeOutput(root, 'evaluate.json', {
    result: 'success',
    data: {
      evaluation: {
        verdict: 'blocked_by_env',
        environment_blockers: [],
        question_results: [
          {
            question_id: 'TQ-01',
            result: 'unanswered',
            cause: 'environment',
            evidence: ['missing'],
            discard_condition_met: false,
          },
        ],
      },
    },
  })

  const result = validatePrototypeOutput(
    validatorInput(root, target, 'evaluate'),
  )

  assert.equal(result.status, 'failed')
  assert.ok(result.issues.some((issue) => issue.code === 'prototype.verdict'))
})

test('evaluate accepts invalidated without a met discard condition', () => {
  const root = createFixture()
  const target = writeOutput(root, 'evaluate.json', {
    result: 'success',
    data: {
      evaluation: {
        verdict: 'invalidated',
        environment_blockers: [],
        question_results: [
          {
            question_id: 'TQ-01',
            result: 'answered',
            cause: 'product',
            evidence: ['approach does not work'],
            discard_condition_met: false,
          },
        ],
      },
    },
  })

  const result = validatePrototypeOutput(
    validatorInput(root, target, 'evaluate'),
  )

  assert.equal(result.status, 'passed')
})

test('evaluate accepts explicit-readiness product cause for a readiness question', () => {
  const root = createFixture()
  const target = writeOutput(root, 'evaluate.json', {
    result: 'success',
    data: {
      evaluation: {
        verdict: 'validated',
        environment_blockers: [],
        question_results: [
          {
            question_id: 'TQ-ENV-READY',
            result: 'answered',
            cause: 'product',
            evidence: ['dependency probe failed during readiness test'],
            discard_condition_met: false,
          },
        ],
      },
    },
  })

  const result = validatePrototypeOutput(
    validatorInput(root, target, 'evaluate'),
  )

  assert.equal(result.status, 'passed')
})

test('a complete build success output passes', () => {
  const root = createFixture()
  const runId = 'run-success'
  const approachPath = writeOutput(
    root,
    `runtime/logs/workflows/${runId}/agent/outputs/approach-1.json`,
    {
      result: 'success',
      data: {
        technical_approach: {
          preconditions: [
            {
              id: 'PRE-01',
              affected_questions: ['TQ-01'],
              check: 'auth probe',
              status: 'ready',
              evidence: ['ready at approach'],
              volatile: true,
            },
          ],
        },
      },
    },
  )
  const target = writeOutput(
    root,
    `runtime/logs/workflows/${runId}/agent/outputs/build-1.json`,
    {
      result: 'success',
      data: {
        spike: {
          changed_files: ['src/spike.ts'],
          precondition_checks: [
            {
              precondition_id: 'PRE-01',
              status: 'ready',
              evidence: ['auth probe passed before edits'],
            },
          ],
        },
      },
    },
  )

  const result = validatePrototypeOutput({
    ...validatorInput(root, target, 'build', {
      stage_history: [
        { stage: 'approach', outcome: 'success', output_path: approachPath },
      ],
    }),
  })

  assert.equal(result.status, 'passed')
  assert.equal(result.issues.length, 0)
})

test('a blocked build with changed files fails regardless of preconditions', () => {
  const root = createFixture()
  const target = writeOutput(root, 'build-blocked.json', {
    result: 'blocked',
    data: {
      spike: {
        changed_files: ['src/spike.ts'],
        precondition_checks: [],
      },
    },
  })

  // The rule reads unconditionally: no volatile precondition is required for
  // a blocked build to owe an empty changed-files list.
  const result = validatePrototypeOutput(validatorInput(root, target, 'build'))

  assert.equal(result.status, 'failed')
  assert.ok(
    result.issues.some(
      (issue) => issue.code === 'prototype.blocked_changed_files',
    ),
  )
})

test('a blocked build with no changed files passes', () => {
  const root = createFixture()
  const target = writeOutput(root, 'build-blocked-clean.json', {
    result: 'blocked',
    data: {
      spike: {
        changed_files: [],
        precondition_checks: [],
      },
    },
  })

  const result = validatePrototypeOutput(validatorInput(root, target, 'build'))

  assert.equal(result.status, 'passed')
})

test('environment_blocked requires at least one named blocker', () => {
  const root = createFixture()
  const target = writeOutput(root, 'evaluate-empty-blockers.json', {
    result: 'success',
    data: {
      evaluation: {
        verdict: 'environment_blocked',
        environment_blockers: [],
        question_results: [
          {
            question_id: 'TQ-01',
            result: 'unanswered',
            cause: 'environment',
            evidence: ['missing credential'],
            discard_condition_met: false,
          },
        ],
      },
    },
  })

  const result = validatePrototypeOutput(
    validatorInput(root, target, 'evaluate'),
  )

  assert.equal(result.status, 'failed')
  assert.ok(
    result.issues.some(
      (issue) => issue.code === 'prototype.environment_blockers_empty',
    ),
  )
})

test('environment_blocked with a named blocker and no discard passes', () => {
  const root = createFixture()
  const target = writeOutput(root, 'evaluate-env-blocked.json', {
    result: 'success',
    data: {
      evaluation: {
        verdict: 'environment_blocked',
        environment_blockers: [{ id: 'ENV-01', detail: 'missing credential' }],
        question_results: [
          {
            question_id: 'TQ-01',
            result: 'unanswered',
            cause: 'environment',
            evidence: ['missing credential'],
            discard_condition_met: false,
          },
        ],
      },
    },
  })

  const result = validatePrototypeOutput(
    validatorInput(root, target, 'evaluate'),
  )

  assert.equal(result.status, 'passed')
})

test('missing stage payloads fail with their shape codes', () => {
  const root = createFixture()

  const approach = validatePrototypeOutput(
    validatorInput(
      root,
      writeOutput(root, 'approach-empty.json', { result: 'success', data: {} }),
      'approach',
    ),
  )

  assert.equal(approach.status, 'failed')
  assert.ok(
    approach.issues.some(
      (issue) => issue.code === 'prototype.approach_missing',
    ),
  )

  const build = validatePrototypeOutput(
    validatorInput(
      root,
      writeOutput(root, 'build-empty.json', { result: 'success', data: {} }),
      'build',
    ),
  )

  assert.equal(build.status, 'failed')
  assert.ok(
    build.issues.some((issue) => issue.code === 'prototype.spike_missing'),
  )

  const evaluate = validatePrototypeOutput(
    validatorInput(
      root,
      writeOutput(root, 'evaluate-empty.json', { result: 'success', data: {} }),
      'evaluate',
    ),
  )

  assert.equal(evaluate.status, 'failed')
  assert.ok(
    evaluate.issues.some(
      (issue) => issue.code === 'prototype.evaluation_missing',
    ),
  )
})

test('question result field defects are each named', () => {
  const root = createFixture()
  const target = writeOutput(root, 'evaluate-bad-question.json', {
    result: 'success',
    data: {
      evaluation: {
        verdict: 'inconclusive',
        environment_blockers: [],
        question_results: [
          {
            question_id: 'TQ-01',
            result: 'unanswered',
            cause: 'weather',
            evidence: [],
            discard_condition_met: 'no',
          },
        ],
      },
    },
  })

  const result = validatePrototypeOutput(
    validatorInput(root, target, 'evaluate'),
  )
  const codes = new Set(result.issues.map((issue) => issue.code))

  assert.equal(result.status, 'failed')
  assert.ok(codes.has('prototype.question_result_cause'))
  assert.ok(codes.has('prototype.discard_condition_met'))
  assert.ok(codes.has('prototype.question_result_evidence'))
})

test('precondition check entries are validated field by field', () => {
  const root = createFixture()
  const target = writeOutput(root, 'build-bad-checks.json', {
    result: 'failure',
    data: {
      spike: {
        changed_files: [],
        precondition_checks: [
          {
            precondition_id: '',
            status: 'maybe',
            evidence: [],
          },
        ],
      },
    },
  })

  const result = validatePrototypeOutput(validatorInput(root, target, 'build'))
  const codes = new Set(result.issues.map((issue) => issue.code))

  assert.equal(result.status, 'failed')
  assert.ok(codes.has('prototype.precondition_check_id'))
  assert.ok(codes.has('prototype.precondition_check_status'))
  assert.ok(codes.has('prototype.precondition_check_evidence'))
})

test('approach blocked result without a blocking precondition fails', () => {
  const root = createFixture()
  const target = writeOutput(root, 'approach-unblocked.json', {
    result: 'blocked',
    data: {
      technical_approach: {
        preconditions: [
          {
            id: 'PRE-01',
            affected_questions: ['TQ-01'],
            check: 'fixture ready',
            status: 'ready',
            evidence: ['ready'],
          },
        ],
      },
    },
  })

  const result = validatePrototypeOutput(
    validatorInput(root, target, 'approach'),
  )

  assert.equal(result.status, 'failed')
  assert.ok(
    result.issues.some(
      (issue) => issue.code === 'prototype.approach_unblocked',
    ),
  )
})

test('build rejects success when approach output is unreadable', () => {
  const root = createFixture()
  const target = writeOutput(root, 'build-unresolved.json', {
    result: 'success',
    data: {
      spike: {
        changed_files: ['src/spike.ts'],
        precondition_checks: [],
      },
    },
  })

  const result = validatePrototypeOutput(validatorInput(root, target, 'build'))

  assert.equal(result.status, 'failed')
  assert.ok(
    result.issues.some(
      (issue) => issue.code === 'prototype.approach_unresolved',
    ),
  )
})
