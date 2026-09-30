import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
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

test('evaluate rejects a product cause on a blocker-named question without a readiness claim', () => {
  const root = scratchRoot()

  const evaluate = (readinessQuestion: boolean | undefined) =>
    validatePrototypeOutput(
      validatorInput(
        root,
        writeOutput(
          root,
          'evaluate.json',
          readinessEvaluation(readinessQuestion),
        ),
        'evaluate',
      ),
    )

  const withoutClaim = evaluate(undefined)

  assert.equal(withoutClaim.status, 'failed')
  assert.ok(codesOf(withoutClaim).has('prototype.readiness_claim'))

  assert.equal(evaluate(true).status, 'passed')
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

test('a build blocked by an unavailable precondition MUST leave changed files empty', () => {
  const root = scratchRoot()

  const validateBlockedBuild = (
    name: string,
    preconditionChecks: Array<Record<string, unknown>>,
  ) =>
    validatePrototypeOutput(
      validatorInput(
        root,
        writeOutput(root, name, {
          result: 'blocked',
          data: {
            spike: {
              changed_files: ['src/spike.ts'],
              precondition_checks: preconditionChecks,
            },
          },
        }),
        'build',
      ),
    )

  const unavailable = validateBlockedBuild('build-blocked.json', [
    {
      precondition_id: 'PRE-01',
      status: 'unavailable',
      evidence: ['auth expired'],
    },
  ])

  assert.equal(unavailable.status, 'failed')
  assert.ok(codesOf(unavailable).has('prototype.blocked_changed_files'))

  // PROTO-001 ties the empty changed-files rule to an unavailable
  // precondition, not to an operator question, so a block with no
  // precondition cause keeps the pause route.
  assert.equal(
    validateBlockedBuild('build-blocked-question.json', []).status,
    'passed',
  )
})

test('environment_blocked requires at least one named blocker', () => {
  const root = scratchRoot()

  const evaluateBlockers = (
    name: string,
    environmentBlockers: Array<Record<string, unknown>>,
  ) =>
    validatePrototypeOutput(
      validatorInput(
        root,
        writeOutput(root, name, {
          result: 'success',
          data: {
            evaluation: {
              verdict: 'environment_blocked',
              environment_blockers: environmentBlockers,
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
        }),
        'evaluate',
      ),
    )

  const empty = evaluateBlockers('evaluate-empty-blockers.json', [])

  assert.equal(empty.status, 'failed')
  assert.ok(codesOf(empty).has('prototype.environment_blockers_empty'))

  const named = evaluateBlockers('evaluate-env-blocked.json', [
    {
      id: 'ENV-01',
      description: 'missing credential',
      evidence: ['credential probe exited 1'],
      affected_questions: ['TQ-01'],
    },
  ])

  assert.equal(named.status, 'passed')
})
