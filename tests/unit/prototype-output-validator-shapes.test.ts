import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { validatePrototypeOutput } from '../../src/lib/validators/prototype-output.js'
import {
  codesOf,
  scratchRoot,
  validatorInput,
  writeOutput,
} from './prototype-output-validator-helpers.js'

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

  const completeTarget = writeOutput(root, 'evaluate-empty-questions.json', {
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
        question_results: [],
      },
    },
  })
  const completeCodes = codesOf(
    validatePrototypeOutput(validatorInput(root, completeTarget, 'evaluate')),
  )

  assert.ok(completeCodes.has('prototype.environment_blocker_questions'))
  assert.equal(
    completeCodes.has('prototype.environment_blocker_description'),
    false,
  )
  assert.equal(
    completeCodes.has('prototype.environment_blocker_evidence'),
    false,
  )
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
