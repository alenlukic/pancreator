import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { validatePrototypeOutput } from '../../src/lib/validators/prototype-output.js'

// The validator reads only the stage outputs and run state it is handed, so a
// bare directory stands in for the repository root.
function scratchRoot(): string {
  return mkdtempSync(path.join(tmpdir(), 'pan-prototype-output-'))
}

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

const OPERATOR_DECISION_PATH =
  'runtime/logs/workflows/run-1/agent/decisions/operator-feedback-1.md'

function operatorFeedback(
  note: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    decision: 'approve',
    source: 'operator',
    from_stage: 'intake',
    to_stage: 'approach',
    attempt: 1,
    note,
    path: OPERATOR_DECISION_PATH,
    timestamp: '2026-08-28T00:00:00.000Z',
    ...overrides,
  }
}

function excludedPrecondition(decisionPath: string): Record<string, unknown> {
  return {
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
  }
}

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

function codesOf(result: ReturnType<typeof validatePrototypeOutput>) {
  return new Set(result.issues.map((issue) => issue.code))
}

test('prototype intake output passes without extra fields', () => {
  const root = scratchRoot()
  const target = writeOutput(root, 'intake.json', {
    data: { prototype_brief: { objective: 'test' } },
  })

  const result = validatePrototypeOutput(validatorInput(root, target, 'intake'))

  assert.equal(result.status, 'passed')
})

test('intake contracts the question identifier every later stage keys on', () => {
  const root = scratchRoot()
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

test('build requires volatile rechecks before changed files', () => {
  const root = scratchRoot()
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

  const result = validatePrototypeOutput(
    validatorInput(root, target, 'build', {
      stage_history: [
        {
          stage: 'approach',
          outcome: 'success',
          output_path: approachPath,
        },
      ],
    }),
  )

  assert.equal(result.status, 'failed')
  assert.ok(codesOf(result).has('prototype.volatile_check_unready'))
})

test('build success with edits passes when an excluded volatile precondition stays unavailable', () => {
  const root = scratchRoot()
  const runId = 'run-1'
  const approachPath = writeOutput(
    root,
    `runtime/logs/workflows/${runId}/agent/outputs/approach-1.json`,
    {
      result: 'success',
      data: {
        technical_approach: {
          preconditions: [
            excludedPrecondition(OPERATOR_DECISION_PATH),
            {
              id: 'PRE-02',
              affected_questions: ['TQ-02'],
              check: 'fixture ready',
              status: 'ready',
              evidence: ['ready'],
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
              precondition_id: 'PRE-02',
              status: 'ready',
              evidence: ['fixture recheck passed'],
            },
          ],
        },
      },
    },
  )

  // The operator excluded PRE-01, so the build owes it no recheck.
  const result = validatePrototypeOutput(
    validatorInput(root, target, 'build', {
      run_id: runId,
      operator_feedback: [operatorFeedback('Exclude TQ-01 from this spike.')],
      stage_history: [
        { stage: 'approach', outcome: 'success', output_path: approachPath },
      ],
    }),
  )

  assert.equal(result.status, 'passed')
  assert.equal(result.issues.length, 0)
})

test('evaluate rejects environment_blocked when discard condition met', () => {
  const root = scratchRoot()
  const target = writeOutput(root, 'evaluate.json', {
    result: 'success',
    data: {
      evaluation: {
        verdict: 'environment_blocked',
        environment_blockers: [
          {
            id: 'ENV-01',
            description: 'missing credential',
            evidence: ['credential probe exited 1'],
            affected_questions: ['TQ-01'],
          },
        ],
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
  assert.ok(codesOf(result).has('prototype.verdict_precedence'))
})

test('evaluate accepts invalidated when product discard condition met', () => {
  const root = scratchRoot()
  // A product discard keeps the verdict at invalidated despite the
  // environment gap.
  const target = writeOutput(root, 'evaluate.json', {
    result: 'success',
    data: {
      evaluation: {
        verdict: 'invalidated',
        environment_blockers: [
          {
            id: 'ENV-01',
            description: 'Missing GitHub token scope',
            evidence: ['gh api returned 403'],
            affected_questions: ['TQ-04'],
          },
          {
            id: 'ENV-02',
            description: 'Missing CURSOR_API_KEY',
            evidence: ['.env has no CURSOR_API_KEY'],
            affected_questions: ['TQ-04'],
          },
        ],
        question_results: [
          {
            question_id: 'TQ-01',
            result: 'answered',
            cause: 'product',
            evidence: ['transaction data loss after failed commit'],
            discard_condition_met: true,
          },
          {
            question_id: 'TQ-02',
            result: 'answered',
            cause: 'product',
            evidence: ['mock-only cursor judgment'],
            discard_condition_met: true,
          },
          {
            question_id: 'TQ-03',
            result: 'answered',
            cause: 'product',
            evidence: ['browser console stylesheet errors'],
            discard_condition_met: true,
          },
          {
            question_id: 'TQ-04',
            result: 'unanswered',
            cause: 'environment',
            evidence: ['GitHub HTTP 403'],
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

  const saved = JSON.parse(readFileSync(path.join(root, target), 'utf8')) as {
    data: { evaluation: { verdict: string } }
  }

  assert.equal(saved.data.evaluation.verdict, 'invalidated')
})

test('evaluate rejects unknown verdict values', () => {
  const root = scratchRoot()
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
  assert.ok(codesOf(result).has('prototype.verdict'))
})

test('evaluate accepts invalidated without a met discard condition', () => {
  const root = scratchRoot()
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

function readinessEvaluation(
  readinessQuestion: boolean | undefined,
): Record<string, unknown> {
  return {
    result: 'success',
    data: {
      evaluation: {
        verdict: 'validated',
        environment_blockers: [
          {
            id: 'ENV-01',
            description: 'dependency probe failed',
            evidence: ['npm ls exited 1'],
            affected_questions: ['TQ-ENV-READY'],
          },
        ],
        question_results: [
          {
            question_id: 'TQ-ENV-READY',
            result: 'answered',
            cause: 'product',
            evidence: ['dependency probe failed during readiness test'],
            discard_condition_met: false,
            ...(readinessQuestion === undefined
              ? {}
              : { readiness_question: readinessQuestion }),
          },
        ],
      },
    },
  }
}

test('evaluate accepts explicit-readiness product cause for a readiness question', () => {
  const root = scratchRoot()
  const target = writeOutput(root, 'evaluate.json', readinessEvaluation(true))

  const result = validatePrototypeOutput(
    validatorInput(root, target, 'evaluate'),
  )

  assert.equal(result.status, 'passed')
})

test('evaluate rejects a product cause on a blocker-named question without a readiness claim', () => {
  const root = scratchRoot()
  const target = writeOutput(
    root,
    'evaluate.json',
    readinessEvaluation(undefined),
  )

  const result = validatePrototypeOutput(
    validatorInput(root, target, 'evaluate'),
  )

  assert.equal(result.status, 'failed')
  assert.ok(codesOf(result).has('prototype.readiness_claim'))
})

test('evaluate fails question coverage when a declared question is unanswered', () => {
  const root = scratchRoot()
  const runId = 'run-coverage'
  const intakePath = writeOutput(
    root,
    `runtime/logs/workflows/${runId}/agent/outputs/intake-1.json`,
    {
      result: 'success',
      data: {
        prototype_brief: {
          technical_questions: [
            { id: 'TQ-01', question: 'Does the adapter cover provider A?' },
            { id: 'TQ-02', question: 'Does the adapter cover provider B?' },
          ],
        },
      },
    },
  )
  const target = writeOutput(
    root,
    `runtime/logs/workflows/${runId}/agent/outputs/evaluate-1.json`,
    {
      result: 'success',
      data: {
        evaluation: {
          verdict: 'validated',
          environment_blockers: [],
          question_results: [
            {
              question_id: 'TQ-01',
              result: 'answered',
              cause: 'product',
              evidence: ['provider A responded'],
              discard_condition_met: false,
            },
            {
              question_id: 'TQ-09',
              result: 'answered',
              cause: 'none',
              evidence: ['invented question'],
              discard_condition_met: false,
            },
          ],
        },
      },
    },
  )

  const result = validatePrototypeOutput(
    validatorInput(root, target, 'evaluate', {
      run_id: runId,
      stage_history: [
        { stage: 'intake', outcome: 'success', output_path: intakePath },
      ],
    }),
  )
  const coverage = result.issues.filter(
    (issue) => issue.code === 'prototype.question_coverage',
  )

  assert.equal(result.status, 'failed')
  assert.ok(coverage.some((issue) => issue.message.includes('TQ-02')))
  assert.ok(coverage.some((issue) => issue.message.includes('TQ-09')))
})

test('a complete build success output passes', () => {
  const root = scratchRoot()
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

  const result = validatePrototypeOutput(
    validatorInput(root, target, 'build', {
      stage_history: [
        { stage: 'approach', outcome: 'success', output_path: approachPath },
      ],
    }),
  )

  assert.equal(result.status, 'passed')
  assert.equal(result.issues.length, 0)
})

test('a build blocked by an unavailable precondition MUST leave changed files empty', () => {
  const root = scratchRoot()
  const target = writeOutput(root, 'build-blocked.json', {
    result: 'blocked',
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
  })

  const result = validatePrototypeOutput(validatorInput(root, target, 'build'))

  assert.equal(result.status, 'failed')
  assert.ok(codesOf(result).has('prototype.blocked_changed_files'))
})

test('a build blocked without a precondition cause keeps the pause route', () => {
  const root = scratchRoot()
  const target = writeOutput(root, 'build-blocked-question.json', {
    result: 'blocked',
    data: {
      spike: {
        changed_files: ['src/spike.ts'],
        precondition_checks: [],
      },
    },
  })

  // PROTO-001 ties the empty changed-files rule to an unavailable
  // precondition, not to an operator question.
  const result = validatePrototypeOutput(validatorInput(root, target, 'build'))

  assert.equal(result.status, 'passed')
})

test('a blocked build with no changed files passes', () => {
  const root = scratchRoot()
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
  const root = scratchRoot()
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
  assert.ok(codesOf(result).has('prototype.environment_blockers_empty'))
})

test('environment_blocked with a named blocker and no discard passes', () => {
  const root = scratchRoot()
  const target = writeOutput(root, 'evaluate-env-blocked.json', {
    result: 'success',
    data: {
      evaluation: {
        verdict: 'environment_blocked',
        environment_blockers: [
          {
            id: 'ENV-01',
            description: 'missing credential',
            evidence: ['credential probe exited 1'],
            affected_questions: ['TQ-01'],
          },
        ],
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
  const root = scratchRoot()

  const approach = validatePrototypeOutput(
    validatorInput(
      root,
      writeOutput(root, 'approach-empty.json', { result: 'success', data: {} }),
      'approach',
    ),
  )

  assert.equal(approach.status, 'failed')
  assert.ok(codesOf(approach).has('prototype.approach_missing'))

  const build = validatePrototypeOutput(
    validatorInput(
      root,
      writeOutput(root, 'build-empty.json', { result: 'success', data: {} }),
      'build',
    ),
  )

  assert.equal(build.status, 'failed')
  assert.ok(codesOf(build).has('prototype.spike_missing'))

  const evaluate = validatePrototypeOutput(
    validatorInput(
      root,
      writeOutput(root, 'evaluate-empty.json', { result: 'success', data: {} }),
      'evaluate',
    ),
  )

  assert.equal(evaluate.status, 'failed')
  assert.ok(codesOf(evaluate).has('prototype.evaluation_missing'))
})

test('question result field defects are each named', () => {
  const root = scratchRoot()
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
  const codes = codesOf(result)

  assert.equal(result.status, 'failed')
  assert.ok(codes.has('prototype.question_result_cause'))
  assert.ok(codes.has('prototype.discard_condition_met'))
  assert.ok(codes.has('prototype.question_result_evidence'))
})

test('precondition check entries are validated field by field', () => {
  const root = scratchRoot()
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
  const codes = codesOf(result)

  assert.equal(result.status, 'failed')
  assert.ok(codes.has('prototype.precondition_check_id'))
  assert.ok(codes.has('prototype.precondition_check_status'))
  assert.ok(codes.has('prototype.precondition_check_evidence'))
})

test('every remaining rejection code has a case that triggers it', () => {
  const root = scratchRoot()
  const rejects = (
    name: string,
    stage: string,
    payload: Record<string, unknown> | unknown[],
    code: string,
    runState?: Record<string, unknown>,
  ) => {
    const relative = `${name}.json`

    mkdirSync(root, { recursive: true })
    writeFileSync(
      path.join(root, relative),
      `${JSON.stringify(payload, null, 2)}\n`,
    )

    const result = validatePrototypeOutput(
      validatorInput(root, relative, stage, runState),
    )

    assert.equal(result.status, 'failed', code)
    assert.ok(codesOf(result).has(code), `${code} expected`)
  }

  rejects('shape', 'approach', ['not', 'an', 'object'], 'prototype.shape')
  rejects(
    'preconditions-missing',
    'approach',
    { result: 'success', data: { technical_approach: { hypothesis: 'x' } } },
    'prototype.preconditions_missing',
  )
  rejects(
    'checks-shape',
    'build',
    {
      result: 'success',
      data: { spike: { changed_files: [], precondition_checks: 'none' } },
    },
    'prototype.precondition_checks_shape',
  )
  rejects(
    'check-shape',
    'build',
    {
      result: 'failure',
      data: { spike: { changed_files: [], precondition_checks: ['PRE-01'] } },
    },
    'prototype.precondition_check_shape',
  )
  rejects(
    'question-results',
    'evaluate',
    {
      result: 'success',
      data: {
        evaluation: {
          verdict: 'validated',
          environment_blockers: [],
          question_results: [],
        },
      },
    },
    'prototype.question_results',
  )
  rejects(
    'question-result-shape',
    'evaluate',
    {
      result: 'success',
      data: {
        evaluation: {
          verdict: 'validated',
          environment_blockers: [],
          question_results: ['TQ-01'],
        },
      },
    },
    'prototype.question_result_shape',
  )
  rejects(
    'question-result-field',
    'evaluate',
    {
      result: 'success',
      data: {
        evaluation: {
          verdict: 'validated',
          environment_blockers: [],
          question_results: [
            {
              question_id: '',
              result: 'answered',
              cause: 'product',
              evidence: ['x'],
              discard_condition_met: false,
            },
          ],
        },
      },
    },
    'prototype.question_result_field',
  )
  rejects(
    'readiness-question',
    'evaluate',
    {
      result: 'success',
      data: {
        evaluation: {
          verdict: 'validated',
          environment_blockers: [],
          question_results: [
            {
              question_id: 'TQ-01',
              result: 'answered',
              cause: 'product',
              evidence: ['x'],
              discard_condition_met: false,
              readiness_question: 'yes',
            },
          ],
        },
      },
    },
    'prototype.readiness_question',
  )

  // The two volatile-recheck codes need an approach output on the run.
  const runId = 'run-codes'
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
  const runState = {
    run_id: runId,
    stage_history: [
      { stage: 'approach', outcome: 'success', output_path: approachPath },
    ],
  }

  rejects(
    'checks-missing',
    'build',
    {
      result: 'success',
      data: { spike: { changed_files: ['src/x.ts'], precondition_checks: [] } },
    },
    'prototype.precondition_checks_missing',
    runState,
  )
  // The recheck list names another precondition, so the volatile one has no
  // entry.
  rejects(
    'volatile-missing',
    'build',
    {
      result: 'success',
      data: {
        spike: {
          changed_files: ['src/x.ts'],
          precondition_checks: [
            { precondition_id: 'PRE-99', status: 'ready', evidence: ['x'] },
          ],
        },
      },
    },
    'prototype.volatile_check_missing',
    runState,
  )
})

test('build rejects success when approach output is unreadable', () => {
  const root = scratchRoot()
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
  assert.ok(codesOf(result).has('prototype.approach_unresolved'))
})

test('an empty environment blocker fails on every required field', () => {
  const root = scratchRoot()
  const target = writeOutput(root, 'evaluate-empty-blocker-object.json', {
    result: 'success',
    data: {
      evaluation: {
        verdict: 'environment_blocked',
        environment_blockers: [{}],
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
  const codes = codesOf(result)

  assert.equal(result.status, 'failed')
  assert.ok(codes.has('prototype.environment_blocker_description'))
  assert.ok(codes.has('prototype.environment_blocker_evidence'))
  assert.ok(codes.has('prototype.environment_blocker_questions'))
})

test('a blocker with an empty affected_questions array fails', () => {
  const root = scratchRoot()
  const target = writeOutput(root, 'evaluate-blocker-no-questions.json', {
    result: 'success',
    data: {
      evaluation: {
        verdict: 'environment_blocked',
        environment_blockers: [
          {
            id: 'ENV-01',
            description: 'missing credential',
            evidence: ['credential probe exited 1'],
            affected_questions: [],
          },
        ],
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
  const codes = codesOf(result)

  assert.equal(result.status, 'failed')
  assert.ok(codes.has('prototype.environment_blocker_questions'))
  assert.ok(!codes.has('prototype.environment_blocker_description'))
  assert.ok(!codes.has('prototype.environment_blocker_evidence'))
})

test('a blocker that names an undeclared question id fails', () => {
  const root = scratchRoot()
  const runId = 'run-blocker-undeclared'
  const intakePath = writeOutput(
    root,
    `runtime/logs/workflows/${runId}/agent/outputs/intake-1.json`,
    {
      result: 'success',
      data: {
        prototype_brief: {
          technical_questions: [
            { id: 'TQ-01', question: 'Does the adapter cover provider A?' },
          ],
        },
      },
    },
  )
  const target = writeOutput(
    root,
    `runtime/logs/workflows/${runId}/agent/outputs/evaluate-1.json`,
    {
      result: 'success',
      data: {
        evaluation: {
          verdict: 'environment_blocked',
          environment_blockers: [
            {
              id: 'ENV-01',
              description: 'missing credential',
              evidence: ['credential probe exited 1'],
              affected_questions: ['TQ-99'],
            },
          ],
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
    },
  )

  const result = validatePrototypeOutput(
    validatorInput(root, target, 'evaluate', {
      run_id: runId,
      stage_history: [
        { stage: 'intake', outcome: 'success', output_path: intakePath },
      ],
    }),
  )
  const undeclared = result.issues.filter(
    (issue) => issue.code === 'prototype.environment_blocker_questions',
  )

  assert.equal(result.status, 'failed')
  assert.ok(undeclared.some((issue) => issue.message.includes('TQ-99')))
})
