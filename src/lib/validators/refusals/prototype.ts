/** Refusal tables of the prototype workflow's stage validators. */

import type { StageRefusal } from './shapes.js'

/** Raised by the prototype dispatcher before it reaches a stage handler. */
const PROTOTYPE_SHAPE: StageRefusal = {
  code: 'prototype.shape',
  paths: [],
  unowned_reason:
    'The stage output is not an object, so no field inside it exists to declare.',
}

/**
 * Refusals `validatePrototypeOutput` can raise for the prototype intake
 * stage.
 *
 * The handler raises one code from three branches — a missing id, missing
 * question text, and a repeated id — so the declaration carries the code once
 * and names both item fields the three branches block on.
 */
export const PROTOTYPE_INTAKE_REFUSALS: readonly StageRefusal[] = [
  PROTOTYPE_SHAPE,
  {
    code: 'prototype.question_id',
    paths: [
      'data.prototype_brief.technical_questions[].id',
      'data.prototype_brief.technical_questions[].question',
    ],
  },
]

/**
 * Refusals `validatePrototypeOutput` can raise for the approach stage.
 *
 * `validatePreconditionEntry` composes its codes from the collection position
 * it is checking, so the declaration carries the expression the handler
 * spells rather than one code per array index.
 */
export const APPROACH_REFUSALS: readonly StageRefusal[] = [
  PROTOTYPE_SHAPE,
  { code: 'prototype.approach_missing', paths: ['data.technical_approach'] },
  {
    code: 'prototype.preconditions_missing',
    paths: ['data.technical_approach.preconditions[]'],
  },
  {
    code: '`${prefix}.shape`',
    composed: true,
    paths: ['data.technical_approach.preconditions[]'],
  },
  {
    code: '`${prefix}.${field}`',
    composed: true,
    paths: [
      'data.technical_approach.preconditions[].id',
      'data.technical_approach.preconditions[].affected_questions[]',
      'data.technical_approach.preconditions[].check',
      'data.technical_approach.preconditions[].evidence[]',
    ],
  },
  {
    code: '`${prefix}.volatile`',
    composed: true,
    paths: ['data.technical_approach.preconditions[].volatile'],
  },
  {
    code: '`${prefix}.status`',
    composed: true,
    paths: ['data.technical_approach.preconditions[].status'],
  },
  {
    code: '`${prefix}.exclusions`',
    composed: true,
    paths: ['data.technical_approach.preconditions[].exclusions[]'],
  },
  {
    code: 'prototype.exclusion_authority',
    paths: [],
    unowned_reason:
      "The refusal relates a declared exclusion to the run's operator-decision ledger.",
  },
  {
    code: 'prototype.approach_blocked',
    paths: [],
    unowned_reason:
      'The refusal relates the declared result to the status of the preconditions.',
  },
]

/** Refusals `validatePrototypeOutput` can raise for the build stage. */
export const BUILD_REFUSALS: readonly StageRefusal[] = [
  PROTOTYPE_SHAPE,
  { code: 'prototype.spike_missing', paths: ['data.spike'] },
  {
    code: 'prototype.precondition_checks_shape',
    paths: ['data.spike.precondition_checks[]'],
  },
  {
    code: 'prototype.approach_unresolved',
    paths: [],
    unowned_reason:
      'The refusal relates build success to the readability of the approach stage output.',
  },
  {
    code: 'prototype.precondition_checks_missing',
    paths: ['data.spike.precondition_checks[]'],
  },
  {
    code: 'prototype.precondition_check_shape',
    paths: ['data.spike.precondition_checks[]'],
  },
  {
    code: 'prototype.precondition_check_id',
    paths: ['data.spike.precondition_checks[].precondition_id'],
  },
  {
    code: 'prototype.precondition_check_status',
    paths: ['data.spike.precondition_checks[].status'],
  },
  {
    code: 'prototype.precondition_check_evidence',
    paths: ['data.spike.precondition_checks[].evidence[]'],
  },
  {
    code: 'prototype.blocked_changed_files',
    paths: [],
    unowned_reason:
      'A build blocked by an unavailable precondition MUST leave the collection empty, so the refusal is the inverse of a field requirement.',
  },
  {
    code: 'prototype.volatile_check_missing',
    paths: [],
    unowned_reason:
      'The refusal relates the recorded checks to the volatile preconditions of the approach output.',
  },
  {
    code: 'prototype.volatile_check_unready',
    paths: [],
    unowned_reason:
      'The refusal relates a recorded check status to the declared changed files.',
  },
]

/** Refusals `validatePrototypeOutput` can raise for the evaluate stage. */
export const EVALUATE_REFUSALS: readonly StageRefusal[] = [
  PROTOTYPE_SHAPE,
  { code: 'prototype.evaluation_missing', paths: ['data.evaluation'] },
  {
    code: 'prototype.environment_blockers',
    paths: ['data.evaluation.environment_blockers[]'],
  },
  { code: 'prototype.verdict', paths: ['data.evaluation.verdict'] },
  {
    code: 'prototype.environment_blockers_empty',
    paths: [],
    unowned_reason:
      'The refusal relates the declared verdict to the size of the collection.',
  },
  {
    code: 'prototype.question_results',
    paths: ['data.evaluation.question_results[]'],
  },
  {
    code: 'prototype.environment_blocker_shape',
    paths: ['data.evaluation.environment_blockers[]'],
  },
  {
    code: 'prototype.environment_blocker_description',
    paths: ['data.evaluation.environment_blockers[].description'],
  },
  {
    code: 'prototype.environment_blocker_evidence',
    paths: ['data.evaluation.environment_blockers[].evidence[]'],
  },
  {
    code: 'prototype.environment_blocker_questions',
    paths: ['data.evaluation.environment_blockers[].affected_questions[]'],
  },
  {
    code: 'prototype.question_result_shape',
    paths: ['data.evaluation.question_results[]'],
  },
  {
    code: 'prototype.question_result_field',
    paths: [
      'data.evaluation.question_results[].question_id',
      'data.evaluation.question_results[].result',
      'data.evaluation.question_results[].cause',
    ],
  },
  {
    code: 'prototype.question_result_cause',
    paths: ['data.evaluation.question_results[].cause'],
  },
  {
    code: 'prototype.discard_condition_met',
    paths: ['data.evaluation.question_results[].discard_condition_met'],
  },
  {
    code: 'prototype.question_result_evidence',
    paths: ['data.evaluation.question_results[].evidence[]'],
  },
  {
    code: 'prototype.readiness_question',
    paths: ['data.evaluation.question_results[].readiness_question'],
  },
  {
    code: 'prototype.readiness_claim',
    paths: [],
    unowned_reason:
      'The refusal relates a question result cause to an environment blocker that names the same question.',
  },
  {
    code: 'prototype.verdict_precedence',
    paths: [],
    unowned_reason:
      'The refusal relates the declared verdict to a met product discard condition.',
  },
  {
    code: 'prototype.question_coverage',
    paths: [],
    unowned_reason:
      'The refusal compares reported question ids against the declared technical questions, which is a relation to another document.',
  },
]
